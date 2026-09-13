const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {requiresFloaters}=require('../public/floater-policy');
const {CATEGORIES}=require('../src/competition');
const {start,close,query}=require('../test-support/admin-harness.cjs');
const floater='25m Freestyle with Floaters',other='25m Backstroke with Floaters';
// Test fixtures do not change the production event catalogue.
CATEGORIES.find(c=>c.name==='Under-6').events.push(floater,other);
CATEGORIES.find(c=>c.name==='Under-8').events.push(floater);
after(close);
test('floater acknowledgement cannot be bypassed through registration API',async t=>{
 const base=await start();
 async function submit(events,ack,dob='2021-05-01',field='events'){
  const body=new FormData();for(const [k,v] of Object.entries({fullName:'Floater Test',schoolName:'Test School',gender:'Boys',email:'parent@example.com',phone:'9999999999',dob,idempotencyKey:crypto.randomUUID(),[field]:JSON.stringify(events)}))body.set(k,v);
  if(ack!==undefined)body.set('floatersAcknowledged',ack);
  body.set('participantPhoto',new Blob(['photo'],{type:'image/png'}),'photo.png');body.set('paymentProof',new Blob(['proof'],{type:'image/png'}),'proof.png');
  const response=await fetch(base+'/api/register',{method:'POST',body});return {status:response.status,body:await response.json()};
 }
 await t.test('only Under-6 floater selections need acknowledgement',()=>{
  assert.equal(requiresFloaters('Under-6',[floater]),true);assert.equal(requiresFloaters('Under-6',[other]),true);
  assert.equal(requiresFloaters('Under-8',[floater]),false);assert.equal(requiresFloaters('Under-6',['25m Freestyle Kick with Board']),false);assert.equal(requiresFloaters('Under-6',[]),false);assert.equal(requiresFloaters('Under-6',null),false);
 });
 for(const ack of [undefined,'false','on','1','yes',''])await t.test('reject missing/invalid acknowledgement '+String(ack),async()=>{
  const result=await submit([floater],ack);assert.equal(result.status,400);assert.equal(result.body.code,'FLOATERS_ACKNOWLEDGEMENT_REQUIRED');assert.equal((await query('SELECT COUNT(*)::int n FROM registrations')).rows[0].n,0);assert.equal((await query('SELECT COUNT(*)::int n FROM whatsapp_queue')).rows[0].n,0);
 });
 await t.test('configured Under-6 board event requires acknowledgement',async()=>{assert.equal((await submit(['25m Freestyle Kick with Board'])).status,400);const r=await submit(['25m Freestyle Kick with Board'],'true');assert.equal(r.status,200);const ticket=await (await fetch(base+'/api/ticket/'+r.body.ticketToken)).json();assert.equal(ticket.requiresFloaters,true);assert.equal(ticket.eventLabels['25m Freestyle Kick with Board'],'25m Freestyle Kick with Board / Floaters')});
 await t.test('configured Under-6 freestyle requires acknowledgement and ticket reminder',async()=>{assert.equal((await submit(['25m Freestyle'])).status,400);const r=await submit(['25m Freestyle'],'true');assert.equal(r.status,200);const ticket=await (await fetch(base+'/api/ticket/'+r.body.ticketToken)).json();assert.equal(ticket.requiresFloaters,true);assert.equal(ticket.eventLabels['25m Freestyle'],'25m Freestyle with Floaters');assert.deepEqual(ticket.events,['25m Freestyle'])});
 await t.test('events_json fallback cannot bypass the acknowledgement',async()=>{assert.equal((await submit([floater],undefined,'2021-05-01','events_json')).status,400)});
 await t.test('acknowledged floater events save and ticket exposes reminder flag',async()=>{
  const r=await submit([floater,other],'true');assert.equal(r.status,200);const ticket=await (await fetch(base+'/api/ticket/'+r.body.ticketToken)).json();assert.equal(ticket.requiresFloaters,true);assert.deepEqual(ticket.events,[floater,other]);
 });
 await t.test('no acknowledgement or ticket reminder for unrelated registrations',async()=>{
  for(const [events,dob] of [[['25m Freestyle'],'2019-05-01'],[['25m Freestyle Kick with Board'],'2019-05-01'],[[floater],'2019-05-01']]){const r=await submit(events,undefined,dob);assert.equal(r.status,200);assert.equal((await (await fetch(base+'/api/ticket/'+r.body.ticketToken)).json()).requiresFloaters,false)}
 });
});
