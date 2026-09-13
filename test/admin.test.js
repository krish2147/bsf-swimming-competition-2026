const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {start,close,query}=require('../test-support/admin-harness.cjs');
const {registrationEvents}=require('../src/admin-data');
const {eventKey}=require('../src/competition');
let base,cookie;
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
});
