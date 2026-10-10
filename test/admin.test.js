const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {start,close,query}=require('../test-support/admin-harness.cjs');
const {registrationEvents}=require('../src/admin-data');
const {eventKey}=require('../src/competition');
let base,cookie;
// Reads one file out of a .docx (zip) via the central directory, for checking generated Word text.
function zipEntry(zip,name){
 const end=zip.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));let at=zip.readUInt32LE(end+16);
 for(let i=0;i<zip.readUInt16LE(end+10);i++){
  const method=zip.readUInt16LE(at+10),size=zip.readUInt32LE(at+20),nameLength=zip.readUInt16LE(at+28),extra=zip.readUInt16LE(at+30),comment=zip.readUInt16LE(at+32),local=zip.readUInt32LE(at+42);
  if(zip.toString('utf8',at+46,at+46+nameLength)===name){
   const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28),data=zip.subarray(start,start+size);
   return (method===8?require('node:zlib').inflateRawSync(data):data).toString('utf8');
  }
  at+=46+nameLength+extra+comment;
 }
 throw new Error(name+' not found in zip');
}
after(close);
async function api(path,body,auth=true){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(auth?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()}}
async function register(overrides={}){
 const values={fullName:'Admin Test Swimmer',schoolName:'Test School',gender:'Boys',dob:'2015-05-01',email:'parent@example.com',phone:'9988776655',events:JSON.stringify(['25m Freestyle','25m Backstroke']),idempotencyKey:crypto.randomUUID(),...overrides};
 const body=new FormData();for(const [k,v] of Object.entries(values))body.set(k,v);
 body.set('participantPhoto',new Blob(['photo bytes'],{type:'image/png'}),'photo.png');body.set('paymentProof',new Blob(['proof bytes'],{type:'image/jpeg'}),'proof.jpg');
 const response=await fetch(base+'/api/register',{method:'POST',body});assert.equal(response.status,200);return response.json();
}
test('admin end-to-end API regression',async t=>{
 base=await start();
 const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:'test-pin'})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 const good=await register(),id=good.registrationId,token=good.ticketToken;
 const key=eventKey('Under-12','Boys','25m Freestyle');
 await register({gender:'Girls',fullName:'Other Gender'});await register({dob:'2017-05-01',fullName:'Other Category'});await register({events:'["50m Freestyle"]',fullName:'Other Event'});
 await t.test('all admin data and mutation endpoints require authentication',async()=>{
  const gets=['/api/admin/overview','/api/admin/events','/api/admin/registrations','/api/admin/registrations/'+id,'/api/admin/event-participants?eventKey='+encodeURIComponent(key),'/api/admin/payments','/api/admin/checkin/'+token,'/api/admin/timings','/api/admin/results','/api/admin/race-card','/api/admin/audit'];
  for(const url of gets)assert.equal((await api(url,null,false)).status,401,url);
  for(const url of ['/api/admin/payment-status','/api/admin/timing','/api/admin/result','/api/admin/publish-event','/api/admin/unpublish-event','/api/admin/checkin/'+token,'/api/admin/seed-heats'])assert.equal((await api(url,{},false)).status,401,url);
  assert.equal((await api('/api/admin/heat-builder?eventKey='+encodeURIComponent(key),null,false)).status,401);assert.equal((await api('/api/admin/save-heats',{eventKey:key,entries:[]},false)).status,401);
  assert.equal((await api('/api/admin/registrations/'+id+'/details',{fullName:'X',schoolName:'Y'},false)).status,401);
  assert.equal((await api('/api/admin/registrations/'+id+'/dob',{dob:'2019-05-19'},false)).status,401);
  assert.equal((await api('/api/admin/seed-all-heats',{lanes:6},false)).status,401);assert.equal((await fetch(base+'/api/admin/registrations',{method:'POST',body:new FormData()})).status,401);assert.equal((await api('/api/admin/heat-list.docx',null,false)).status,401);
  assert.equal((await api('/api/admin/heat-sheet?format=pdf&eventKey='+encodeURIComponent(key),null,false)).status,401);
  for(const kind of ['photo','proof'])assert.equal((await fetch(base+`/api/media/${id}/${kind}`)).status,401);
  assert.equal((await api('/api/admin/login',{pin:'wrong'},false)).status,403);
 });
 await t.test('successful registration appears with all fields and safe JSONB array',async()=>{
  const result=await api('/api/admin/registrations');assert.equal(result.status,200);assert.equal(result.body.total,4);
  const r=result.body.rows.find(r=>r.registration_id===id);assert.ok(r);assert.deepEqual(r.events_json,['25m Freestyle','25m Backstroke']);assert.equal(r.full_name,'Admin Test Swimmer');assert.equal(r.school_name,'Test School');assert.equal(r.phone,'9988776655');assert.equal(r.gender,'Boys');assert.equal(r.dob,'2015-05-01');assert.equal(r.age_category,'Under-12');assert.equal(r.payment_status,'Pending');assert.ok(r.created_at);assert.equal(r.ticket_token,undefined);assert.equal(typeof r.participant_photo,'string');
 });
 await t.test('event filtering matches category AND gender AND exact event',async()=>{
  const result=await api('/api/admin/event-participants?eventKey='+encodeURIComponent(key));assert.equal(result.status,200);assert.deepEqual(result.body.map(r=>r.registration_id),[id]);
  assert.equal((await api('/api/admin/event-participants')).status,400);assert.equal((await api('/api/admin/event-participants?eventKey=bad')).status,400);
 });
 await t.test('search by ID, name, school, phone; combined filters and pagination',async()=>{
  for(const search of [id,'Admin Test','Test School','9988776655']){const result=await api('/api/admin/registrations?'+new URLSearchParams({search}));assert.ok(result.body.rows.some(r=>r.registration_id===id))}
  const result=await api('/api/admin/registrations?'+new URLSearchParams({category:'Under-12',gender:'Boys',event:'25m Freestyle',paymentStatus:'Pending'}));assert.deepEqual(result.body.rows.map(r=>r.registration_id),[id]);
  const p1=(await api('/api/admin/registrations?limit=2&page=1')).body,p2=(await api('/api/admin/registrations?limit=2&page=2')).body;assert.equal(new Set([...p1.rows,...p2.rows].map(r=>r.registration_id)).size,4);
  assert.equal((await api('/api/admin/registrations?search='+encodeURIComponent("' OR 1=1 --"))).body.total,0);
  for(const suffix of ['page=0','limit=10000','search[x]=bad'])assert.equal((await api('/api/admin/registrations?'+suffix)).status,400);
 });
 await t.test('participant details include ticket QR, optional fields and protected media URLs',async()=>{
  const result=await api('/api/admin/registrations/'+id);assert.equal(result.status,200);assert.equal(result.body.registration_id,id);assert.equal(result.body.email,'parent@example.com');assert.equal(result.body.guardian_name,null);assert.ok(result.body.qrDataUrl.startsWith('data:image/png;base64,'));assert.ok(result.body.ticketUrl.includes(token));assert.deepEqual(result.body.events_json,['25m Freestyle','25m Backstroke']);assert.equal((await api('/api/admin/registrations/missing')).status,404);
  const checkin=await api('/api/admin/checkin/'+token);assert.equal(checkin.status,200);assert.deepEqual(checkin.body.events,result.body.events_json);assert.equal(checkin.body.dob,'2015-05-01');
 });
 await t.test('media returns exact original bytes and sensible missing responses',async()=>{
  for(const [kind,mime,bytes] of [['photo','image/png','photo bytes'],['proof','image/jpeg','proof bytes']]){const response=await fetch(base+`/api/media/${id}/${kind}`,{headers:{cookie}});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),mime);assert.equal(await response.text(),bytes);assert.equal(response.headers.get('cache-control'),'private, no-store')}
  for(const path of [`/api/media/${id}/payment`,`/api/media/${id}/wrong`,'/api/media/missing/photo'])assert.equal((await api(path)).status,404);
 });
 await t.test('all existing payment statuses persist and counts refresh from database',async()=>{
  for(const status of ['Verified','Issue','Pending','Verified']){
   assert.equal((await api('/api/admin/payment-status',{registrationId:id,status})).status,200);
   assert.equal((await query('SELECT payment_status FROM registrations WHERE registration_id=$1',[id])).rows[0].payment_status,status);
   assert.equal((await api('/api/admin/registrations/'+id)).body.payment_status,status);
   assert.equal((await api('/api/admin/payments')).body.find(r=>r.registration_id===id).payment_status,status);
   const counts=(await api('/api/admin/overview')).body;assert.equal(counts.registrations,4);assert.equal(counts.paymentVerified,status==='Verified'?1:0);assert.equal(counts.paymentPending,status==='Pending'?4:3);
  }
  assert.equal((await api('/api/admin/payment-status',{registrationId:id,status:'Rejected'})).status,400);
  assert.equal((await api('/api/admin/payment-status',{registrationId:'missing',status:'Verified'})).status,404);
  assert.equal((await api('/api/admin/payment-status',{status:'Verified'})).status,400);
 });
 await t.test('legacy event normalization rejects invalid shapes',()=>{
  for(const value of [null,{},42,'bad','{"event":"25m Freestyle"}'])assert.deepEqual(registrationEvents(value),[]);
  assert.deepEqual(registrationEvents('["25m Freestyle"]'),['25m Freestyle']);assert.deepEqual(registrationEvents(['25m Freestyle',null,{},'25m Freestyle']),['25m Freestyle']);
 });
 await t.test('null/malformed legacy events and missing photos never crash admin',async()=>{
  const legacy=await register({fullName:'Legacy Participant'});
  // Simulate an older nullable schema only inside the isolated test database.
  await query('ALTER TABLE registrations ALTER COLUMN events_json DROP NOT NULL');await query('ALTER TABLE registrations ALTER COLUMN participant_photo DROP NOT NULL');await query('ALTER TABLE registrations ALTER COLUMN payment_proof DROP NOT NULL');
  for(const value of [null,{},'bad','["25m Freestyle"]',[null,'25m Freestyle']]){
   await query('UPDATE registrations SET events_json=$1::jsonb,participant_photo=NULL,payment_proof=NULL WHERE registration_id=$2',[value===null?null:JSON.stringify(value),legacy.registrationId]);
   for(const url of ['/api/admin/events','/api/admin/registrations','/api/admin/event-participants?eventKey='+encodeURIComponent(key),'/api/admin/payments','/api/admin/checkin/'+legacy.ticketToken,'/api/admin/registrations/'+legacy.registrationId])assert.equal((await api(url)).status,200,url);
   const detail=(await api('/api/admin/registrations/'+legacy.registrationId)).body;assert.equal(detail.participant_photo,null);assert.equal(detail.payment_proof,null);assert.deepEqual(detail.events_json,registrationEvents(value));
   for(const kind of ['photo','proof'])assert.equal((await api(`/api/media/${legacy.registrationId}/${kind}`)).status,404);
  }
 });
 await t.test('timings, heat assignments, results and check-in still work',async()=>{
  const seed=await api('/api/admin/seed-heats',{eventKey:key,lanes:6});assert.equal(seed.status,200);
  const card=await api('/api/admin/race-card?'+new URLSearchParams({eventKey:key,heatNo:'1'}));assert.ok(card.body.rows.some(r=>r.registration_id===id));
  assert.equal((await api('/api/admin/timing',{eventKey:key,heatNo:1,registrationId:id,timingText:'00:36.42',status:'TIME'})).status,200);
  assert.equal((await api('/api/admin/result',{eventKey:key,position:1,registrationId:id})).status,200);
  assert.equal((await api('/api/admin/results?eventKey='+encodeURIComponent(key))).body.entries[0].registration_id,id);
  assert.equal((await api('/api/admin/checkin/'+token,{decision:'Approved'})).status,200);assert.equal((await api('/api/admin/overview')).body.checkedIn,1);
 });
 await t.test('heat builder: swimmers with status and saved slots; save validates and replaces heats',async()=>{
  const second=await register({fullName:'Second Freestyler'}),third=await register({fullName:'Third Freestyler'});
  const load=async()=>(await api('/api/admin/heat-builder?eventKey='+encodeURIComponent(key))).body.swimmers;
  const swimmers=await load();
  assert.deepEqual(swimmers.map(s=>s.registrationId).filter(s=>[id,second.registrationId,third.registrationId].includes(s)).length,3);
  assert.ok(swimmers.every(s=>'paymentStatus' in s&&'checkinStatus' in s));assert.ok(!swimmers.some(s=>s.fullName==='Other Event'||s.fullName==='Other Gender'));
  assert.equal(swimmers.find(s=>s.registrationId===id).heatNo,1,'shows the slot saved by seed-heats');
  const saved=await api('/api/admin/save-heats',{eventKey:key,entries:[{registrationId:third.registrationId,heatNo:1,laneNo:4},{registrationId:id,heatNo:1,laneNo:3},{registrationId:second.registrationId,heatNo:2,laneNo:3}]});
  assert.equal(saved.status,200);assert.equal(saved.body.heats,2);assert.equal(saved.body.participants,3);
  assert.deepEqual((await query('SELECT registration_id,heat_no,lane_no FROM race_entries WHERE event_key=$1 ORDER BY heat_no,lane_no',[key])).rows,[{registration_id:id,heat_no:1,lane_no:3},{registration_id:third.registrationId,heat_no:1,lane_no:4},{registration_id:second.registrationId,heat_no:2,lane_no:3}]);
  const after=await load();assert.deepEqual([after.find(s=>s.registrationId===second.registrationId).heatNo,after.find(s=>s.registrationId===second.registrationId).laneNo],[2,3]);
  const card=await api('/api/admin/race-card?'+new URLSearchParams({eventKey:key,heatNo:'1'}));assert.deepEqual(card.body.rows.map(r=>r.lane_no),[3,4]);assert.equal(card.body.heatCount,2);
  const other=(await query("SELECT registration_id FROM registrations WHERE full_name='Other Event'")).rows[0].registration_id;
  for(const entries of [[{registrationId:other,heatNo:1,laneNo:1}],[{registrationId:id,heatNo:1,laneNo:1},{registrationId:third.registrationId,heatNo:1,laneNo:1}],[],'bad']){
   const bad=await api('/api/admin/save-heats',{eventKey:key,entries});assert.equal(bad.status,400,JSON.stringify(entries));assert.ok(bad.body.errors.length);
  }
  assert.equal((await query('SELECT COUNT(*)::int n FROM race_entries WHERE event_key=$1',[key])).rows[0].n,3,'failed saves keep existing heats');
  assert.equal((await api('/api/admin/save-heats',{eventKey:'bad',entries:[]})).status,400);assert.equal((await api('/api/admin/heat-builder?eventKey=bad')).status,400);
  assert.equal((await query("SELECT COUNT(*)::int n FROM admin_audit WHERE action='SAVE_HEATS' AND entity_key=$1",[key])).rows[0].n,1);
 });
 await t.test('edit participant name and school: saved, shown on the ticket, audited, validated',async()=>{
  const edit=body=>api('/api/admin/registrations/'+encodeURIComponent(id)+'/details',body);
  const saved=await edit({fullName:'  Aarna   Sawant ',schoolName:'Test School'});
  assert.equal(saved.status,200);assert.deepEqual([saved.body.changed,saved.body.fullName,saved.body.schoolName],[true,'Aarna Sawant','Test School']);
  assert.equal((await api('/api/admin/registrations/'+id)).body.full_name,'Aarna Sawant');
  assert.equal((await (await fetch(base+'/api/ticket/'+token)).json()).fullName,'Aarna Sawant','ticket reads the new name');
  const audit=(await query("SELECT details_json FROM admin_audit WHERE action='EDIT_REGISTRATION' AND entity_key=$1",[id])).rows;
  assert.equal(audit.length,1);assert.deepEqual(audit[0].details_json,{full_name:{from:'Admin Test Swimmer',to:'Aarna Sawant'}});
  assert.equal((await edit({fullName:'Aarna Sawant',schoolName:'Test School'})).body.changed,false);
  for(const body of [{fullName:'   ',schoolName:'Test School'},{fullName:'Aarna',schoolName:''},{fullName:'x'.repeat(121),schoolName:'Test School'},{fullName:42,schoolName:'Test School'},{}])assert.equal((await edit(body)).status,400,JSON.stringify(body));
  assert.equal((await api('/api/admin/registrations/NOPE/details',{fullName:'A',schoolName:'B'})).status,404);
  assert.equal((await api('/api/admin/registrations/'+id)).body.full_name,'Aarna Sawant','rejected edits change nothing');
 });
 await t.test('heat sheets download as PDF and Word with every saved heat and the live names',async()=>{
  const sheet=format=>fetch(base+'/api/admin/heat-sheet?'+new URLSearchParams({eventKey:key,format}),{headers:{cookie}});
  const pdf=await sheet('pdf');assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');
  assert.match(pdf.headers.get('content-disposition'),/filename="heat-sheet-Under-12-Boys-25m-Freestyle\.pdf"/);
  const pdfBytes=Buffer.from(await pdf.arrayBuffer());assert.equal(pdfBytes.subarray(0,5).toString(),'%PDF-');
  assert.equal((pdfBytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,2,'one PDF page per saved heat');
  const word=await sheet('docx');assert.equal(word.status,200);assert.match(word.headers.get('content-disposition'),/heat-sheet-Under-12-Boys-25m-Freestyle\.docx/);
  const xml=zipEntry(Buffer.from(await word.arrayBuffer()),'word/document.xml');
  for(const text of ['Aarna Sawant','Second Freestyler','Third Freestyler','Heat 1 of 2','Heat 2 of 2','Time (mm:ss.hh)','— empty lane —'])assert.ok(xml.includes(text),text);
  assert.equal((await api('/api/admin/heat-sheet?format=txt&eventKey='+encodeURIComponent(key))).status,400);
  assert.equal((await api('/api/admin/heat-sheet?format=pdf&eventKey=bad')).status,400);
  assert.equal((await api('/api/admin/heat-sheet?format=pdf&eventKey='+encodeURIComponent(eventKey('Under-12','Girls','25m Freestyle')))).status,404);
 });
 await t.test('Create / Reset Heats puts 13 swimmers into heats of 6, 4, 3',async()=>{
  const butterfly=eventKey('Under-12','Girls','25m Butterfly');
  for(let i=1;i<=13;i++)await register({gender:'Girls',fullName:`Butterfly Swimmer ${i}`,events:JSON.stringify(['25m Butterfly'])});
  const seed=await api('/api/admin/seed-heats',{eventKey:butterfly,lanes:6});
  assert.equal(seed.status,200);assert.equal(seed.body.heats,3);assert.deepEqual(seed.body.heatSizes,[6,4,3]);
  const rows=(await query('SELECT heat_no,COUNT(*)::int n,MAX(lane_no)::int top FROM race_entries WHERE event_key=$1 GROUP BY heat_no ORDER BY heat_no',[butterfly])).rows;
  assert.deepEqual(rows,[{heat_no:1,n:6,top:6},{heat_no:2,n:4,top:4},{heat_no:3,n:3,top:3}]);
 });
 await t.test('registration closes automatically at the configured time; retries of saved registrations still work',async()=>{
  const previous=process.env.REGISTRATION_CLOSES_AT,key=crypto.randomUUID();
  const submit=async idempotencyKey=>{
   const body=new FormData();for(const [k,v] of Object.entries({fullName:'Late Swimmer',schoolName:'Test School',gender:'Boys',dob:'2015-05-01',email:'parent@example.com',phone:'9988776655',events:JSON.stringify(['25m Freestyle']),idempotencyKey}))body.set(k,v);
   body.set('participantPhoto',new Blob(['photo bytes'],{type:'image/png'}),'photo.png');body.set('paymentProof',new Blob(['proof bytes'],{type:'image/jpeg'}),'proof.jpg');
   const response=await fetch(base+'/api/register',{method:'POST',body});return {status:response.status,body:await response.json()};
  };
  try{
   const saved=await register({idempotencyKey:key,fullName:'Just In Time'});
   assert.equal((await (await fetch(base+'/api/config')).json()).registrationOpen,true);
   process.env.REGISTRATION_CLOSES_AT=new Date(Date.now()-1000).toISOString();
   const config=await (await fetch(base+'/api/config')).json();assert.equal(config.registrationOpen,false);
   const before=(await query('SELECT COUNT(*)::int n FROM registrations')).rows[0].n;
   const late=await submit(crypto.randomUUID());
   assert.equal(late.status,403);assert.equal(late.body.code,'REGISTRATION_CLOSED');assert.match(late.body.error,/closed/);
   assert.equal((await query('SELECT COUNT(*)::int n FROM registrations')).rows[0].n,before,'nothing saved after closing for the public');
   assert.equal(config.lateEntry,false,'public visitors get no late entry');
   assert.equal((await (await fetch(base+'/api/config',{headers:{cookie}})).json()).lateEntry,true,'logged-in admin may add late entries');
   const lateBody=new FormData();for(const [k,v] of Object.entries({fullName:'Abdullah Late Entry',schoolName:'Reliance English Medium School',gender:'Boys',dob:'2018-01-28',email:'parent@example.com',phone:'9988776655',events:JSON.stringify(['25m Freestyle','50m Freestyle']),idempotencyKey:crypto.randomUUID()}))lateBody.set(k,v);
   lateBody.set('participantPhoto',new Blob(['photo bytes'],{type:'image/png'}),'photo.png');lateBody.set('paymentProof',new Blob(['proof bytes'],{type:'image/jpeg'}),'proof.jpg');
   const admitted=await fetch(base+'/api/register',{method:'POST',body:lateBody,headers:{cookie}});assert.equal(admitted.status,200,'admin late entry accepted');
   const lateId=(await admitted.json()).registrationId;
   assert.deepEqual((await query(`SELECT age_category,events_json,amount FROM registrations WHERE registration_id=$1`,[lateId])).rows[0],{age_category:'Under-10',events_json:['25m Freestyle','50m Freestyle'],amount:600});
   assert.equal((await query("SELECT COUNT(*)::int n FROM admin_audit WHERE action='LATE_ENTRY' AND entity_key=$1",[lateId])).rows[0].n,1);
   const retry=await submit(key);assert.equal(retry.status,200);assert.equal(retry.body.registrationId,saved.registrationId);assert.equal(retry.body.duplicateSafe,true);
   delete process.env.REGISTRATION_CLOSES_AT;
   assert.equal((await (await fetch(base+'/api/config')).json()).registrationOpen,Date.now()<Date.parse('2026-10-02T00:00:00+05:30'),'by default open until midnight at the end of 1 October IST');
   process.env.REGISTRATION_CLOSES_AT='not a date';
   assert.equal((await (await fetch(base+'/api/config')).json()).registrationClosesAt,'2026-10-01T18:30:00.000Z','invalid setting falls back to midnight at the end of 1 October IST');
  }finally{process.env.REGISTRATION_CLOSES_AT=previous}
 });
 await t.test('correct date of birth: category, events, fee and heats follow; preview never saves',async()=>{
  const twin=await register({fullName:'Nihit Test',events:JSON.stringify(['25m Freestyle','50m Freestyle'])}),rid=twin.registrationId;
  const freestyle12=eventKey('Under-12','Boys','25m Freestyle');
  assert.equal((await api('/api/admin/seed-heats',{eventKey:freestyle12,lanes:6})).status,200);
  assert.ok((await query('SELECT 1 FROM race_entries WHERE registration_id=$1',[rid])).rows.length,'in an Under-12 heat before the fix');
  const dobApi=(body,preview)=>api('/api/admin/registrations/'+encodeURIComponent(rid)+'/dob'+(preview?'?preview=1':''),body);
  const row=async()=>(await query(`SELECT to_char(dob,'YYYY-MM-DD') dob,age_category,events_json,amount FROM registrations WHERE registration_id=$1`,[rid])).rows[0];
  const need=await dobApi({dob:'2019-05-19'},true);
  assert.equal(need.status,200);assert.equal(need.body.needsEvents,true);assert.equal(need.body.code,'EVENTS_NEED_UPDATE');
  assert.equal((await dobApi({dob:'2019-05-19'})).status,409,'saving without choosing events is refused');assert.equal(need.body.category,'Under-8');assert.equal(need.body.previousCategory,'Under-12');
  assert.deepEqual(need.body.keep,['25m Freestyle']);assert.ok(need.body.validEvents.includes('25m Freestyle Kick with Board'));
  const preview=await dobApi({dob:'2019-05-19',events:['25m Freestyle','25m Backstroke']},true);
  assert.equal(preview.status,200);assert.equal(preview.body.amount,600);assert.equal((await row()).dob,'2015-05-01','preview does not save');
  const saved=await dobApi({dob:'2019-05-19',events:['25m Freestyle','25m Backstroke']});
  assert.equal(saved.status,200);assert.equal(saved.body.changed,true);assert.equal(saved.body.removedHeatEntries,1);
  assert.deepEqual(await row(),{dob:'2019-05-19',age_category:'Under-8',events_json:['25m Freestyle','25m Backstroke'],amount:600});
  assert.equal((await query('SELECT COUNT(*)::int n FROM race_entries WHERE registration_id=$1',[rid])).rows[0].n,0,'old Under-12 heat entry removed');
  assert.equal((await (await fetch(base+'/api/ticket/'+twin.ticketToken)).json()).category,'Under-8','ticket shows the new category');
  const same=await dobApi({dob:'2019-06-01'});assert.equal(same.status,200,'same category keeps events without asking');assert.equal((await row()).dob,'2019-06-01');
  assert.equal((await dobApi({dob:'2019-06-01'})).body.changed,false);
  for(const [body,status] of [[{dob:'2099-01-01'},400],[{dob:'2019-02-30'},400],[{dob:'19-05-2019'},400],[{dob:'2000-01-01'},400],[{dob:'2019-05-19',events:['50m Freestyle']},400],[{dob:'2019-05-19',events:[]},400],[{},400]])assert.equal((await dobApi(body)).status,status,JSON.stringify(body));
  assert.equal((await api('/api/admin/registrations/NOPE/dob',{dob:'2019-05-19'})).status,404);
  assert.equal((await row()).dob,'2019-06-01','rejected requests change nothing');
  const audit=(await query("SELECT details_json FROM admin_audit WHERE action='EDIT_DOB' AND entity_key=$1 ORDER BY id",[rid])).rows;
  assert.equal(audit.length,2);assert.deepEqual(audit[0].details_json.category,{from:'Under-12',to:'Under-8'});assert.deepEqual(audit[0].details_json.amount,{from:600,to:600});
 });
 await t.test('all events: create heats for every event at once and download one full heat list',async()=>{
  const replaced=await api('/api/admin/seed-all-heats',{lanes:6,replaceExisting:true});assert.equal(replaced.status,200);assert.equal(replaced.body.skipped.length,0);
  const regs=(await query('SELECT registration_id,gender,age_category,events_json FROM registrations')).rows;
  const expected=new Map();for(const r of regs)for(const e of registrationEvents(r.events_json)){const k=eventKey(r.age_category,r.gender,e);expected.set(k,(expected.get(k)||0)+1)}
  assert.equal(replaced.body.created.length,expected.size,'one entry per event with swimmers');
  const placed=new Map((await query('SELECT event_key,COUNT(*)::int n,COUNT(DISTINCT registration_id)::int d FROM race_entries GROUP BY event_key')).rows.map(r=>[r.event_key,r]));
  for(const [k,n] of expected){assert.equal(placed.get(k)?.n,n,k);assert.equal(placed.get(k)?.d,n,'each swimmer once: '+k)}
  for(const e of replaced.body.created)assert.ok(e.heatSizes.every(size=>size<=6)&&e.heatSizes.reduce((a,b)=>a+b,0)===e.swimmers,e.event);
  const titles=replaced.body.created.map(e=>e.event);assert.deepEqual(titles,[...titles].sort((a,b)=>{const order=c=>['Under-6','Under-8','Under-10','Under-12','Under-14','Under-17'].indexOf(c.split(' • ')[0]);return order(a)-order(b)}),'programme order by category');
  const kept=await api('/api/admin/seed-all-heats',{lanes:6});assert.equal(kept.body.created.length,0);assert.equal(kept.body.skipped.length,expected.size);
  const late=await register({fullName:'Late Entry Swimmer',events:JSON.stringify(['25m Freestyle'])});
  const response=await fetch(base+'/api/admin/heat-list.docx',{headers:{cookie}});assert.equal(response.status,200);
  assert.match(response.headers.get('content-disposition'),/bsf-full-heat-list-\d{4}-\d{2}-\d{2}\.docx/);
  const xml=zipEntry(Buffer.from(await response.arrayBuffer()),'word/document.xml');
  for(const text of ['Full Heat List','Under-12 • Boys • 25m Freestyle','Heat 1 of','Time (mm:ss.hh)','Not in any heat (1)','Late Entry Swimmer ('+late.registrationId+')'])assert.ok(xml.includes(text),text);
  assert.equal((xml.match(/<w:sectPr/g)||[]).length,expected.size+1,'summary page + one section per event');
  assert.equal((await api('/api/admin/seed-all-heats',{lanes:11})).status,400);
  assert.equal((await query("SELECT COUNT(*)::int n FROM admin_audit WHERE action='SEED_ALL_HEATS'")).rows[0].n,2);
 });
 await t.test('participation certificate: from competition day, with the ticket link, also via Find My Ticket',async()=>{
  const previous=process.env.CERTIFICATES_FROM,kid=await register({fullName:'Certificate Swimmer',phone:'9876500011',dob:'2015-05-01'});
  const cert=()=>fetch(base+'/api/certificate/'+encodeURIComponent(kid.ticketToken));
  try{
   process.env.CERTIFICATES_FROM=new Date(Date.now()+86400000).toISOString();
   const early=await cert();assert.equal(early.status,403);assert.equal((await early.json()).code,'CERTIFICATE_NOT_YET_AVAILABLE');
   const ticketEarly=await (await fetch(base+'/api/ticket/'+kid.ticketToken)).json();assert.equal(ticketEarly.certificateAvailable,false);assert.equal(ticketEarly.certificateUrl,'/api/certificate/'+kid.ticketToken);
   process.env.CERTIFICATES_FROM=new Date(Date.now()-1000).toISOString();
   const pdf=await cert();assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');
   assert.match(pdf.headers.get('content-disposition'),/filename="BSF-Participation-Certificate-Certificate-Swimmer\.pdf"/);
   const bytes=Buffer.from(await pdf.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.equal((bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,1);
   assert.equal((await (await fetch(base+'/api/ticket/'+kid.ticketToken)).json()).certificateAvailable,true);
   // One participation certificate per event entered.
   const per=(await (await fetch(base+'/api/ticket/'+kid.ticketToken)).json()).participationCertificates;
   assert.deepEqual(per.map(c=>c.event),['25m Freestyle','25m Backstroke']);assert.equal(per[0].url,'/api/certificate/'+kid.ticketToken+'?event=25m%20Freestyle');
   const one=await fetch(base+per[1].url);assert.equal(one.status,200);assert.match(one.headers.get('content-disposition'),/filename="BSF-Participation-Certificate-Certificate-Swimmer-25m-Backstroke\.pdf"/);
   assert.equal((await fetch(base+'/api/certificate/'+kid.ticketToken+'?event=50m%20Butterfly')).status,404,'only events the swimmer entered');
   const found=await (await fetch(base+'/api/ticket-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'9876500011',dob:'2015-05-01'})})).json();
   const match=found.matches.find(m=>m.registrationId===kid.registrationId);assert.equal(match.certificateAvailable,true);assert.equal(match.participationCertificates.length,2);assert.equal(match.certificateUrl,'/api/certificate/'+kid.ticketToken);
   assert.equal((await fetch(base+'/api/certificate/not-a-real-token')).status,404);
  }finally{if(previous===undefined)delete process.env.CERTIFICATES_FROM;else process.env.CERTIFICATES_FROM=previous}
 });
 await t.test('admin manual entry: minimal details, category/fee, auto heat placement, duplicate check',async()=>{
  const add=async(fields,files={})=>{const fd=new FormData();for(const [k,v] of Object.entries(fields))fd.set(k,v);for(const [k,blob] of Object.entries(files))fd.set(k,blob,k+'.png');const r=await fetch(base+'/api/admin/registrations',{method:'POST',body:fd,headers:{cookie}});return {status:r.status,body:await r.json()}};
  const key=eventKey('Under-12','Boys','25m Freestyle');
  await api('/api/admin/seed-all-heats',{lanes:6,replaceExisting:true});
  const before=(await query('SELECT heat_no,lane_no FROM race_entries WHERE event_key=$1',[key])).rows,lanes=Math.max(...before.map(r=>r.lane_no)),last=Math.max(...before.map(r=>r.heat_no));
  const used=new Set(before.filter(r=>r.heat_no===last).map(r=>r.lane_no)),free=Array.from({length:lanes},(_,i)=>i+1).find(l=>!used.has(l));
  const expected=free?{heatNo:last,laneNo:free}:{heatNo:last+1,laneNo:1};
  const kalp={fullName:'Kalp Shah',schoolName:'Manual Entry School',gender:'Boys',dob:'2015-02-10',events:JSON.stringify(['25m Freestyle','25m Butterfly']),paymentStatus:'Verified',paymentNote:'Cash paid at desk'};
  const added=await add(kalp);
  assert.equal(added.status,200,JSON.stringify(added.body));assert.equal(added.body.category,'Under-12');assert.equal(added.body.amount,600);assert.equal(added.body.paymentStatus,'Verified');
  assert.deepEqual(added.body.placements.find(p=>p.event==='25m Freestyle'),{event:'25m Freestyle',...expected});
  const row=(await query('SELECT phone,email,participant_photo,payment_proof,payment_utr,payment_status,age_category FROM registrations WHERE registration_id=$1',[added.body.registrationId])).rows[0];
  assert.deepEqual(row,{phone:'',email:null,participant_photo:null,payment_proof:null,payment_utr:'Cash paid at desk',payment_status:'Verified',age_category:'Under-12'});
  assert.deepEqual((await query('SELECT heat_no,lane_no FROM race_entries WHERE event_key=$1 AND registration_id=$2',[key,added.body.registrationId])).rows[0],{heat_no:expected.heatNo,lane_no:expected.laneNo});
  assert.equal((await (await fetch(base+'/api/ticket/'+added.body.ticketToken)).json()).fullName,'Kalp Shah','ticket works');
  const detail=await api('/api/admin/registrations/'+added.body.registrationId);assert.equal(detail.status,200);assert.equal(detail.body.participant_photo,null);
  const dup=await add(kalp);assert.equal(dup.status,409);assert.equal(dup.body.code,'POSSIBLE_DUPLICATE');assert.equal(dup.body.registrationId,added.body.registrationId);
  const second=await add({...kalp,allowDuplicate:'true'});assert.equal(second.status,200);assert.notEqual(second.body.registrationId,added.body.registrationId);
  const withPhoto=await add({fullName:'Photo Entry',schoolName:'S',gender:'Girls',dob:'2013-01-01',events:JSON.stringify(['50m Freestyle']),phone:'9988776600'},{participantPhoto:new Blob(['img'],{type:'image/png'})});
  assert.equal(withPhoto.status,200);assert.equal(withPhoto.body.category,'Under-14');assert.equal(withPhoto.body.placements[0].notPlaced,true,'no heats yet for that event');
  for(const bad of [{...kalp,fullName:''},{...kalp,gender:'Other'},{...kalp,dob:'2099-01-01'},{...kalp,dob:'2000-01-01'},{...kalp,events:JSON.stringify(['200m Individual Medley (IM)'])},{...kalp,events:'[]'},{...kalp,phone:'123'},{...kalp,email:'nope'}])
   assert.equal((await add({...bad,allowDuplicate:'true'})).status,400,JSON.stringify(bad));
  assert.equal((await query("SELECT COUNT(*)::int n FROM admin_audit WHERE action='MANUAL_ENTRY'")).rows[0].n,3);
 });
 await t.test('filter registrations by check-in status (list and CSV)',async()=>{
  const all=(await query('SELECT registration_id,checkin_status FROM registrations')).rows,approved=all.filter(r=>r.checkin_status==='Approved').map(r=>r.registration_id).sort();
  assert.ok(approved.length>=1,'at least one swimmer checked in by earlier subtests');
  const list=await api('/api/admin/registrations?'+new URLSearchParams({checkinStatus:'Approved',limit:'100'}));
  assert.equal(list.status,200);assert.equal(list.body.total,approved.length);assert.deepEqual(list.body.rows.map(r=>r.registration_id).sort(),approved);
  assert.ok(list.body.rows.every(r=>r.checkin_status==='Approved'));
  const notIn=await api('/api/admin/registrations?'+new URLSearchParams({checkinStatus:'Not Checked In',limit:'100'}));
  assert.equal(notIn.body.total,all.filter(r=>r.checkin_status==='Not Checked In').length);
  const csv=await fetch(base+'/api/admin/registrations.csv?checkinStatus=Approved',{headers:{cookie}});
  assert.match(csv.headers.get('content-disposition'),/bsf-registrations-Checked-in-/);
  assert.equal((await csv.text()).trim().split('\r\n').length-1,approved.length,'CSV has only checked-in swimmers');
 });
 await t.test('live public timings: saved times show straight away, provisional until published',async()=>{
  const key=eventKey('Under-12','Girls','25m Freestyle');
  const a=await register({gender:'Girls',fullName:'<b>Live</b> Swimmer A',events:JSON.stringify(['25m Freestyle'])}),b=await register({gender:'Girls',fullName:'Live Swimmer B',events:JSON.stringify(['25m Freestyle'])}),c=await register({gender:'Girls',fullName:'Live Swimmer C',events:JSON.stringify(['25m Freestyle'])});
  assert.equal((await api('/api/admin/seed-heats',{eventKey:key,lanes:6})).status,200);
  const save=(id,timingText,status)=>api('/api/admin/timing',{eventKey:key,heatNo:1,registrationId:id,timingText,status});
  assert.equal((await save(a.registrationId,'00:31.20','TIME')).status,200);assert.equal((await save(b.registrationId,'','DNS')).status,200);assert.equal((await save(c.registrationId,'','PENDING')).status,200);
  const live=async()=>(await (await fetch(base+'/api/public/timings')).json()).filter(r=>r.event_key===key);
  let rows=await live();
  assert.deepEqual(rows.map(r=>[r.full_name,r.status,r.timing_text||'',r.published]).sort(),[['<b>Live</b> Swimmer A','TIME','00:31.20',false],['Live Swimmer B','DNS','',false]].sort(),'PENDING hidden, time and DNS shown live');
  assert.ok(rows.every(r=>r.meta.label==='25m Freestyle'&&r.lane_no>=1&&Number.isInteger(r.order)));
  assert.equal((await api('/api/admin/publish-event',{eventKey:key})).status,200);
  rows=await live();assert.ok(rows.length&&rows.every(r=>r.published===true),'official after publish');
 });
 await t.test('relays: teams of four from the database, timed, ranked, medals for every member, absent until timed',async()=>{
  // Two relays, each combining Under-12, Under-14 and Under-17: boys and girls race separately.
  const key=eventKey('Under-12/14/17','Boys','4×50m Freestyle Relay'),girlsKey=eventKey('Under-12/14/17','Girls','4×50m Freestyle Relay');
  const dobs=['2015-03-03','2013-03-03','2011-03-03'];   // Under-12, Under-14, Under-17
  const kids=[];for(let i=0;i<12;i++)kids.push(await register({dob:dobs[Math.floor(i/4)],gender:'Boys',fullName:'Relay Kid '+String.fromCharCode(65+i),schoolName:'Relay School',events:JSON.stringify(i<4?['25m Freestyle','4×50m Freestyle Relay']:['100m Freestyle'])}));
  const ids=kids.map(k=>k.registrationId),younger=await register({dob:'2017-01-01',fullName:'Relay Younger Kid',events:JSON.stringify(['25m Freestyle'])});
  const girl=await register({dob:'2013-03-03',gender:'Girls',fullName:'Relay Girl Kid',schoolName:'Relay School',events:JSON.stringify(['100m Freestyle'])});
  const relayEvents=(await api('/api/admin/relay-events')).body;
  assert.deepEqual(relayEvents.map(e=>[e.event_key,e.combined]),[[key,true],[girlsKey,true]],'a boys relay and a girls relay, each combining Under-12/14/17');
  const found=(await api('/api/admin/relay-candidates?eventKey='+encodeURIComponent(key)+'&q=Relay')).body;
  assert.equal(found.length,12,'boys from Under-12, 14 and 17; not the girl, not the Under-10 swimmer');
  assert.deepEqual([...new Set(found.map(r=>r.category+' '+r.gender))].sort(),['Under-12 Boys','Under-14 Boys','Under-17 Boys']);
  assert.deepEqual((await api('/api/admin/relay-candidates?eventKey='+encodeURIComponent(girlsKey)+'&q=Relay')).body.map(r=>r.full_name),['Relay Girl Kid']);assert.equal(found.find(r=>r.registration_id===ids[0]).registeredForRelay,true);assert.equal(found.find(r=>r.registration_id===ids[5]).registeredForRelay,false);
  const team=(name,members,extra={})=>api('/api/admin/relays',{eventKey:key,teamName:name,members,...extra});
  const A=await team('Relay School A',ids.slice(0,4),{heatNo:1,laneNo:3});assert.equal(A.status,200);
  const B=await team('Relay School B',[ids[4],ids[5],ids[8],ids[9]],{heatNo:1,laneNo:4});assert.equal(B.status,200,'Under-14 and Under-17 boys in one team');
  const C=await team('Relay School C',[ids[6],ids[7],ids[10],ids[11]]);assert.equal(C.status,200);
  assert.equal((await team('Too Few',ids.slice(8,11))).status,400);
  assert.equal((await team('Same Twice',[ids[8],ids[8],ids[9],ids[10]])).status,400);
  assert.match((await team('Clash',[ids[0],ids[6],ids[7],ids[10]])).body.error,/already in Relay School A/);
  assert.match((await team('Wrong Age',[younger.registrationId,ids[6],ids[7],ids[11]])).body.error,/Under-10 Boys; this relay is for Under-12, Under-14, Under-17 boys/);
  assert.match((await team('Girl In Boys',[girl.registrationId,ids[6],ids[7],ids[11]])).body.error,/Under-14 Girls; this relay is for Under-12, Under-14, Under-17 boys/);
  assert.equal((await api('/api/admin/relays/'+A.body.id+'/timing',{timingText:'two minutes',status:'TIME'})).status,400);
  assert.equal((await api('/api/admin/relays/'+A.body.id+'/timing',{timingText:'02:30.10',status:'TIME'})).status,200);
  assert.equal((await api('/api/admin/relays/'+B.body.id+'/timing',{timingText:'2:25.00',status:'PENDING'})).status,200); // a typed time counts as TIME even if the status was left on PENDING
  const relay=async()=>(await (await fetch(base+'/api/public/results')).json()).find(e=>e.event_key===key);
  let e=await relay();
  assert.deepEqual(e.standings.map(s=>[s.rank,s.full_name,s.timing_text]),[[1,'Relay School B','2:25.00'],[2,'Relay School A','02:30.10']]);
  assert.equal(e.standings[1].school_name,'Relay Kid A · Relay Kid B · Relay Kid C · Relay Kid D');assert.deepEqual(e.standings[0].lane_no,4);
  assert.deepEqual(e.awaiting.map(s=>s.full_name),['Relay School C'],'untimed team listed (shown as Absent)');
  assert.ok(!JSON.stringify(e).includes('registration_id'));
  const merit=async kid=>(await (await fetch(base+'/api/ticket/'+kid.ticketToken)).json()).meritCertificates.filter(m=>/Relay/.test(m.event)).map(m=>m.position);
  assert.deepEqual(await merit(kids[5]),[1]);assert.deepEqual(await merit(kids[2]),[2]);assert.deepEqual(await merit(kids[9]),[1]);assert.deepEqual(await merit(kids[10]),[]);
  const best=(await (await fetch(base+'/api/public/best-swimmers')).json()).flatMap(g=>g.swimmers);assert.ok(!best.some(x=>/^Relay Kid/.test(x.full_name)),'relay medals do not count for best swimmers');
  const timings=await (await fetch(base+'/api/public/timings')).json();assert.ok(timings.some(r=>r.event_key===key&&r.full_name==='Relay School B'&&r.timing_text==='2:25.00'));
  // Heat and lane set from the team card along with the time; leaving them out keeps what was saved.
  assert.equal((await api('/api/admin/relays/'+C.body.id+'/timing',{timingText:'',status:'PENDING',heatNo:'2',laneNo:'5'})).status,200);
  assert.deepEqual((({heat_no,lane_no})=>[heat_no,lane_no])((await api('/api/admin/relays?eventKey='+encodeURIComponent(key))).body.teams.find(t=>String(t.id)===String(C.body.id))),[2,5]);
  assert.equal((await api('/api/admin/relays/'+C.body.id+'/timing',{timingText:'',status:'PENDING',laneNo:'11'})).status,400);
  e=await relay();assert.deepEqual(e.awaiting.map(s=>[s.full_name,s.heat_no,s.lane_no]),[['Relay School C',2,5]]);
  // Relay-only swimmers who arrived on the day: name, school and gender only.
  const addNew=body=>api('/api/admin/relay-swimmers',body);
  assert.equal((await addNew({fullName:'',schoolName:'Late School',gender:'Boys'})).status,400);
  assert.equal((await addNew({fullName:'Late Kid',schoolName:'Late School',gender:'Other'})).status,400);
  const late=[];for(const n of ['W','X','Y','Z']){const r=await addNew({fullName:'Late Kid '+n,schoolName:'Late School',gender:'Boys'});assert.equal(r.status,200);assert.equal(r.body.category,'Under-12/14/17');late.push(r.body.registration_id)}
  assert.equal((await addNew({fullName:'late kid w',schoolName:'LATE SCHOOL',gender:'Boys'})).status,409,'same name, school and gender asks first');
  assert.equal((await addNew({fullName:'Late Kid W',schoolName:'Late School',gender:'Boys',allowDuplicate:true})).status,200);
  assert.deepEqual((await api('/api/admin/relay-candidates?eventKey='+encodeURIComponent(key)+'&q=Late%20Kid')).body.length,5,'new swimmers are found in the relay search');
  assert.equal((await api('/api/admin/relay-candidates?eventKey='+encodeURIComponent(girlsKey)+'&q=Late%20Kid')).body.length,0);
  const L=await team('Late School',late,{heatNo:2,laneNo:6});assert.equal(L.status,200,JSON.stringify(L.body));
  assert.equal((await api('/api/admin/relays/'+L.body.id+'/timing',{timingText:'2:50.00',status:'TIME'})).status,200);
  const lateRow=(await query('SELECT ticket_token,dob FROM registrations WHERE registration_id=$1',[late[0]])).rows[0];assert.equal(lateRow.dob,null);
  const lateTicket=await (await fetch(base+'/api/ticket/'+lateRow.ticket_token)).json();
  assert.equal(lateTicket.fullName,'Late Kid W');assert.deepEqual(lateTicket.meritCertificates.map(m=>m.position),[3],'relay-only swimmer gets the merit certificate');
  const lateCert=await fetch(base+lateTicket.meritCertificates[0].url);assert.equal(lateCert.status,200);assert.equal(lateCert.headers.get('content-type'),'application/pdf');
  const lateDetails=await api('/api/admin/registrations/'+late[0]);assert.equal(lateDetails.status,200);
  assert.equal((await fetch(base+'/api/admin/registrations.csv',{headers:{cookie}})).status,200);
  // Relay certificates book: 3 placed teams x 4 swimmers merit pages; participation for every team that swam (C has no time yet).
  const book=async kind=>{const r=await fetch(base+'/api/admin/relay-certificates.pdf'+(kind?'?kind='+kind:''),{headers:{cookie}});return {status:r.status,type:r.headers.get('content-type'),count:Number(r.headers.get('x-certificate-count')),bytes:(await r.arrayBuffer()).byteLength}};
  const meritBook=await book('merit');assert.equal(meritBook.status,200);assert.equal(meritBook.type,'application/pdf');assert.equal(meritBook.count,12);
  assert.equal((await book('participation')).count,12);assert.equal((await book()).count,24);
  assert.ok(meritBook.bytes<2_000_000,'designs and fonts embedded once: '+meritBook.bytes);
  assert.equal((await fetch(base+'/api/admin/relay-certificates.pdf')).status,401);
  assert.equal((await fetch(base+'/api/admin/relays/'+L.body.id,{method:'DELETE',headers:{cookie}})).status,200);
  const edited=await team('Relay School C2',[ids[6],ids[7],ids[10],ids[11]],{id:C.body.id,heatNo:2,laneNo:1});assert.equal(edited.status,200);
  assert.equal((await api('/api/admin/relays?eventKey='+encodeURIComponent(key))).body.teams.find(t=>String(t.id)===String(C.body.id)).team_name,'Relay School C2');
  assert.equal((await fetch(base+'/api/admin/relays/'+C.body.id,{method:'DELETE',headers:{cookie}})).status,200);
  e=await relay();assert.deepEqual(e.awaiting,[]);
  assert.equal((await api('/api/admin/relays?eventKey='+encodeURIComponent(key),null,false)).status,401);
 });
 await t.test('schools: count and names, spelling variants merged, CSV download',async()=>{
  for(const schoolName of ["St. Xavier's School",'st xaviers','ST. XAVIER\'S  SCHOOL','Navrachana Vidyani'])await register({schoolName,fullName:'School Count '+schoolName});
  const r=await api('/api/admin/schools');assert.equal(r.status,200);
  const xav=r.body.schools.find(s=>s.name==="St. Xavier's School");assert.ok(xav,'on a tie, the normally capitalised spelling is shown');
  assert.equal(xav.participants,3);assert.equal(xav.otherSpellings.length,2);
  assert.ok(r.body.schools.some(s=>s.name==='Navrachana Vidyani'&&s.participants===1));
  assert.equal(r.body.count,r.body.schools.length);assert.equal(r.body.participants,r.body.schools.reduce((n,s)=>n+s.participants,0));
  assert.equal((await api('/api/admin/schools',null,false)).status,401);
  const csv=await fetch(base+'/api/admin/schools.csv',{headers:{cookie}});assert.equal(csv.status,200);const body=await csv.text();
  assert.match(body,/Sr No,School,Participants,Checked in,Other spellings/);assert.ok(body.includes("St. Xavier's School,3,0,"));
 });
 await t.test('live public results: standings across heats with ties, official podium after publishing',async()=>{
  const key=eventKey('Under-14','Boys','50m Freestyle');
  const kids=[];for(const n of ['P','Q','R','S'])kids.push(await register({dob:'2013-01-01',fullName:'Results Swimmer '+n,events:JSON.stringify(['50m Freestyle'])}));
  assert.equal((await api('/api/admin/seed-heats',{eventKey:key,lanes:2})).status,200);
  const slots=(await query('SELECT registration_id,heat_no FROM race_entries WHERE event_key=$1',[key])).rows,heatOf=id=>slots.find(r=>r.registration_id===id).heat_no;
  const event=async()=>(await (await fetch(base+'/api/public/results')).json()).find(e=>e.event_key===key);
  process.env.TOURNAMENT='closed';
  try{
   const cfg=await (await fetch(base+'/api/config',{headers:{cookie}})).json();
   assert.equal(cfg.registrationOpen,false,'closed even though REGISTRATION_CLOSES_AT is in the future');assert.equal(cfg.lateEntry,false,'no admin late entry after the competition');
   const late=await fetch(base+'/api/register',{method:'POST',headers:{cookie},body:(()=>{const f=new FormData();for(const [k,v] of Object.entries({fullName:'After Close',schoolName:'S',gender:'Boys',dob:'2015-05-01',email:'parent@example.com',phone:'9988776600',events:JSON.stringify(['25m Freestyle']),idempotencyKey:crypto.randomUUID()}))f.set(k,v);f.set('participantPhoto',new Blob(['photo bytes'],{type:'image/png'}),'photo.png');f.set('paymentProof',new Blob(['proof bytes'],{type:'image/jpeg'}),'proof.jpg');return f})()});
   assert.equal(late.status,403,'admin cannot register through the public form after the competition: '+JSON.stringify(await late.clone().json()));
   assert.ok(Array.isArray(await (await fetch(base+'/api/public/timings')).json()),'timings stay live after the tournament closes');
   process.env.PUBLIC_TIMINGS='closed';assert.deepEqual(await (await fetch(base+'/api/public/timings')).json(),{closed:true},'PUBLIC_TIMINGS=closed hides timings');delete process.env.PUBLIC_TIMINGS;
   const savedResults=process.env.PUBLIC_RESULTS;delete process.env.PUBLIC_RESULTS;assert.ok(Array.isArray(await (await fetch(base+'/api/public/results')).json()),'results live by default');process.env.PUBLIC_RESULTS=savedResults;assert.equal((await (await fetch(base+'/api/config')).json()).tournamentClosed,true)}finally{process.env.TOURNAMENT='open'}
  assert.equal((await (await fetch(base+'/api/config')).json()).tournamentClosed,false);assert.ok(Array.isArray(await (await fetch(base+'/api/public/timings')).json()));
  process.env.PUBLIC_RESULTS='closed';
  try{
   assert.deepEqual(await (await fetch(base+'/api/public/results')).json(),{closed:true},'results closed: nothing public');
   const preview=await api('/api/admin/results-preview');assert.equal(preview.status,200);assert.equal(preview.body.publicOpen,false);
   assert.ok(preview.body.events.find(x=>x.event_key===key).awaiting.length===4,'admin preview shows the event while public is closed');
   assert.equal((await api('/api/admin/results-preview',null,false)).status,401,'preview is admin only');
  }finally{process.env.PUBLIC_RESULTS='open'}
  assert.equal((await api('/api/admin/results-preview')).body.publicOpen,true);
  let e=await event();
  assert.deepEqual(e.awaiting.map(s=>s.full_name).sort(),kids.map((_,i)=>'Results Swimmer '+'PQRS'[i]),'whole heat list shown before any time');assert.ok(e.awaiting.every(s=>s.heat_no>=1&&s.lane_no>=1));assert.deepEqual(e.standings,[]);
  const times=[['35.10s','TIME'],['00:33.00','TIME'],['0:33:00','TIME'],['','DQ']];
  for(const [i,[timingText,status]] of times.entries())assert.equal((await api('/api/admin/timing',{eventKey:key,heatNo:heatOf(kids[i].registrationId),registrationId:kids[i].registrationId,timingText,status})).status,200);
  const bad=await api('/api/admin/timing',{eventKey:key,heatNo:1,registrationId:kids[0].registrationId,timingText:'thirty six',status:'TIME'});
  assert.equal(bad.status,400);assert.match(bad.body.error,/not a time/);
  e=await event();assert.deepEqual(e.awaiting,[],'everyone timed, mixed formats all read');
  assert.equal(e.published,false);assert.deepEqual(e.official,[]);
  assert.deepEqual(e.standings.map(s=>s.timing_text).slice(2),['35.10s'],'shown as typed');assert.deepEqual(e.standings.slice(0,2).map(s=>s.full_name).sort(),['Results Swimmer Q','Results Swimmer R']);
  assert.deepEqual(e.standings.map(s=>s.rank),[1,1,3],'tie shares first place');assert.equal(e.standings[2].full_name,'Results Swimmer P');
  assert.ok(new Set(e.standings.map(s=>s.heat_no)).size>=1);assert.deepEqual(e.notFinished.map(s=>[s.full_name,s.status]),[['Results Swimmer S','DQ']]);
  {const pos=async kid=>(await (await fetch(base+'/api/ticket/'+kid.ticketToken)).json()).meritCertificates.map(m=>m.position);
   assert.deepEqual([await pos(kids[1]),await pos(kids[2]),await pos(kids[0]),await pos(kids[3])],[[1],[1],[3],[]],'before publishing: live standings, tie shares 1st');
   const found=await (await fetch(base+'/api/ticket-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'9988776655',dob:'2013-01-01'})})).json();
   assert.ok(found.matches.some(m=>m.meritCertificates.length===1&&m.meritCertificates[0].url.startsWith('/api/merit-certificate/')),'Find My Ticket lists merit certificates');}
  for(const [position,kid] of [[1,kids[1]],[2,kids[2]],[3,kids[0]]])assert.equal((await api('/api/admin/result',{eventKey:key,position,registrationId:kid.registrationId})).status,200);
  e=await event();assert.deepEqual(e.official,[],'podium hidden until published');
  assert.equal((await api('/api/admin/publish-event',{eventKey:key})).status,200);
  e=await event();assert.equal(e.published,true);
  assert.deepEqual(e.official.map(p=>[p.position,p.full_name,p.timing_text]),[[1,'Results Swimmer Q','00:33.00'],[2,'Results Swimmer R','0:33:00'],[3,'Results Swimmer P','35.10s']]);
  assert.ok(!JSON.stringify(await (await fetch(base+'/api/public/results')).json()).includes('registration_id'),'no registration IDs in public results');
  // Best swimmers: Under-14 Boys ranked by points (5/3/2) from the same placings.
  {const best=await (await fetch(base+'/api/public/best-swimmers')).json(),g=best.find(x=>x.category==='Under-14'&&x.gender==='Boys');
   const row=n=>g.swimmers.find(x=>x.full_name==='Results Swimmer '+n);
   assert.deepEqual(['Q','R','P'].map(n=>[row(n).points,row(n).gold,row(n).silver,row(n).bronze]),[[5,1,0,0],[3,0,1,0],[2,0,0,1]]);
   assert.ok(row('Q').rank<row('R').rank&&row('R').rank<row('P').rank);assert.equal(row('S'),undefined,'DQ swimmer has no medal');
   assert.deepEqual(row('Q').medals,[{event:'50m Freestyle',position:1,time:'00:33.00'}]);assert.ok(!JSON.stringify(best).includes('registration_id'));
   // Champion photo: only rank 1, through an unguessable link that serves the registration photo.
   assert.match(row('Q').photo,/^\/api\/public\/champion-photo\/[0-9a-f]{32}$/);assert.equal(row('R').photo,undefined,'only champions show a photo');assert.ok(!row('Q').photo.includes(kids[1].registrationId));
   const photo=await fetch(base+row('Q').photo);assert.equal(photo.status,200);assert.equal(photo.headers.get('content-type'),'image/png');assert.equal(await photo.text(),'photo bytes');
   assert.equal((await fetch(base+'/api/public/champion-photo/'+'0'.repeat(32))).status,404);
   process.env.PUBLIC_RESULTS='closed';try{assert.equal((await fetch(base+row('Q').photo)).status,404,'hidden with results')}finally{process.env.PUBLIC_RESULTS='open'}
   process.env.PUBLIC_RESULTS='closed';try{assert.deepEqual(await (await fetch(base+'/api/public/best-swimmers')).json(),{closed:true});assert.ok(Array.isArray((await api('/api/public/best-swimmers')).body),'admins still see it')}finally{process.env.PUBLIC_RESULTS='open'}}
  // All merit certificates in one printable PDF (admin only), ordered by school.
  {const {PDFDocument}=require('pdf-lib');
   const all=await fetch(base+'/api/admin/merit-certificates.pdf',{headers:{cookie}});assert.equal(all.status,200);assert.equal(all.headers.get('content-type'),'application/pdf');
   assert.match(all.headers.get('content-disposition'),/bsf-merit-certificates-by-school-\d{4}-\d{2}-\d{2}\.pdf/);
   const count=Number(all.headers.get('x-certificate-count'));assert.ok(count>=3);
   assert.equal((await PDFDocument.load(Buffer.from(await all.arrayBuffer()))).getPageCount(),count,'one page per certificate');
   const one=await fetch(base+'/api/admin/merit-certificates.pdf?school='+encodeURIComponent('test school')+'&sort=event',{headers:{cookie}});assert.equal(one.status,200);
   assert.ok(Number(one.headers.get('x-certificate-count'))>=3&&Number(one.headers.get('x-certificate-count'))<=count);
   assert.equal((await fetch(base+'/api/admin/merit-certificates.pdf?school=No%20Such%20School',{headers:{cookie}})).status,404);
   assert.equal((await fetch(base+'/api/admin/merit-certificates.pdf')).status,401,'admin only');}
  // Merit certificates: official podium Q 1st, R 2nd, P 3rd; S (DQ) none.
  const ticket=async kid=>(await (await fetch(base+'/api/ticket/'+kid.ticketToken)).json()).meritCertificates;
  assert.deepEqual((await ticket(kids[1])).map(m=>[m.position,m.positionLabel,m.event]),[[1,'1st','50m Freestyle']]);
  assert.deepEqual((await ticket(kids[2])).map(m=>m.position),[2]);assert.deepEqual((await ticket(kids[0])).map(m=>m.position),[3]);assert.deepEqual(await ticket(kids[3]),[]);
  const merit=await fetch(base+(await ticket(kids[1]))[0].url);assert.equal(merit.status,200);assert.equal(merit.headers.get('content-type'),'application/pdf');
  assert.match(merit.headers.get('content-disposition'),/BSF-Merit-Certificate-Results-Swimmer-Q-50m-Freestyle-1st\.pdf/);
  assert.equal((await fetch(base+`/api/merit-certificate/${kids[3].ticketToken}?event=${encodeURIComponent(key)}`)).status,404,'no medal, no merit certificate');
  assert.equal((await fetch(base+`/api/merit-certificate/not-a-token?event=${encodeURIComponent(key)}`)).status,404);
  process.env.PUBLIC_RESULTS='closed';try{assert.deepEqual(await ticket(kids[1]),[]);assert.equal((await fetch(base+(`/api/merit-certificate/${kids[1].ticketToken}?event=${encodeURIComponent(key)}`))).status,403)}finally{process.env.PUBLIC_RESULTS='open'}
 });
});
