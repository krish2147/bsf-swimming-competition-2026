const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {start,close}=require('../test-support/admin-harness.cjs');
after(close);

test('the ticket desk closes without taking the rest of the site down',async t=>{
 const base=await start();
 process.env.TICKET_DESK='closed';
 t.after(()=>{process.env.TICKET_DESK='open'});

 await t.test('the public pages all still open',async()=>{
  for(const page of ['/','/index.html','/events.html','/register.html','/find-ticket.html','/results.html','/best-swimmers.html','/timings.html']){
   assert.equal((await fetch(base+page)).status,200,page);
  }
 });

 await t.test('Find My Ticket lookups answer with the customer care message',async()=>{
  const r=await fetch(base+'/api/ticket-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'9876500011',dob:'2015-05-01'})});
  assert.equal(r.status,410);
  const body=await r.json();
  assert.equal(body.code,'TICKET_DESK_CLOSED');
  assert.match(body.error,/BSF customer care/);
  assert.ok(body.support.whatsappUrl);
  assert.equal(body.support.phone,'+91 93132 41071');
 });

 await t.test('the config says the ticket desk is closed',async()=>{
  const config=await (await fetch(base+'/api/config')).json();
  assert.equal(config.ticketRecoveryOpen,false);
  assert.ok(config.support.whatsappUrl);
 });

 await t.test('the find-ticket page carries the closed panel and the contact note',async()=>{
  const html=await (await fetch(base+'/find-ticket.html')).text();
  assert.match(html,/id="recoveryClosed"/);
  assert.match(html,/BSF customer care/);
 });

 await t.test('TICKET_DESK=open reopens recovery',async()=>{
  process.env.TICKET_DESK='open';
  const r=await fetch(base+'/api/ticket-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'bad',dob:'bad'})});
  assert.equal(r.status,400); // reaches the lookup itself again
  assert.equal((await (await fetch(base+'/api/config')).json()).ticketRecoveryOpen,true);
  process.env.TICKET_DESK='closed';
 });
});
