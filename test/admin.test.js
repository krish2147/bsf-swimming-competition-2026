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
   assert.equal((await query('SELECT COUNT(*)::int n FROM registrations')).rows[0].n,before,'nothing saved after closing');
   const retry=await submit(key);assert.equal(retry.status,200);assert.equal(retry.body.registrationId,saved.registrationId);assert.equal(retry.body.duplicateSafe,true);
   delete process.env.REGISTRATION_CLOSES_AT;
   assert.equal((await (await fetch(base+'/api/config')).json()).registrationOpen,Date.now()<Date.parse('2026-10-02T00:00:00+05:30'),'by default open until midnight at the end of 1 October IST');
   process.env.REGISTRATION_CLOSES_AT='not a date';
   assert.equal((await (await fetch(base+'/api/config')).json()).registrationClosesAt,'2026-10-01T18:30:00.000Z','invalid setting falls back to midnight at the end of 1 October IST');
  }finally{process.env.REGISTRATION_CLOSES_AT=previous}
 });
});
