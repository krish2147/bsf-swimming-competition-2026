const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {start,close}=require('../test-support/admin-harness.cjs');
after(close);

test('results-only mode shows just Best Swimmers, Results and Timings',async t=>{
 const base=await start();
 process.env.PUBLIC_SITE='results';
 t.after(()=>{delete process.env.PUBLIC_SITE});

 await t.test('home and closed pages go to Best Swimmers',async()=>{
  for(const page of ['/','/index.html','/events.html','/register.html','/find-ticket.html','/success.html']){
   const r=await fetch(base+page,{redirect:'manual'});
   assert.equal(r.status,302,page);
   assert.equal(r.headers.get('location'),'/best-swimmers.html',page);
  }
 });

 await t.test('registration, tickets and certificates are switched off',async()=>{
  for(const [method,url] of [['POST','/api/register'],['POST','/api/ticket-recovery'],['GET','/api/ticket/abc'],['GET','/api/wallet/google/abc'],['GET','/api/certificate/abc'],['GET','/api/merit-certificate/abc']]){
   const r=await fetch(base+url,{method});
   assert.equal(r.status,410,url);
   assert.equal((await r.json()).code,'RESULTS_ONLY',url);
  }
 });

 await t.test('the three public pages open and are marked results-only',async()=>{
  for(const page of ['/best-swimmers.html','/results.html','/timings.html']){
   const r=await fetch(base+page);
   assert.equal(r.status,200,page);
   assert.match(await r.text(),/<html[^>]*data-results-only="true"/,page);
  }
  for(const api of ['/api/public/best-swimmers','/api/public/results','/api/public/timings']){
   assert.equal((await fetch(base+api)).status,200,api);
  }
  assert.equal((await (await fetch(base+'/api/config')).json()).resultsOnly,true);
 });

 await t.test('the admin desk still works',async()=>{
  assert.equal((await fetch(base+'/admin/')).status,200);
  const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:'test-pin'})});
  assert.equal(login.status,200);
 });

 await t.test('PUBLIC_SITE=full reopens everything',async()=>{
  process.env.PUBLIC_SITE='full';
  const r=await fetch(base+'/find-ticket.html',{redirect:'manual'});
  assert.equal(r.status,200);
  assert.equal((await (await fetch(base+'/api/config')).json()).resultsOnly,false);
  process.env.PUBLIC_SITE='results';
 });
});
