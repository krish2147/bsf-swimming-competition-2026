const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {prepareValue}=require('pg/lib/utils');
process.env.DATABASE_URL='postgres://unused:unused@localhost/unused';
process.env.ADMIN_PIN='test-pin';
process.env.SESSION_SECRET='test-only-session-secret';
process.env.REGISTRATION_EVENTS_DEBUG='true';
const db=require('../src/db');
const pg=new PGlite();
let failTable=null;
const inserts=[];
async function query(sql,values=[]){
  if(typeof sql==='object'){values=sql.values||[];sql=sql.text}
  if(failTable&&sql.startsWith(`INSERT INTO ${failTable}`))throw Object.assign(new Error('Injected failure'),{code:'22P02'});
  if(sql.startsWith('INSERT INTO registrations'))inserts.push({sql,values});
  // Apply the actual node-postgres parameter serializer before PostgreSQL receives values.
  if(!values.length&&sql.includes('CREATE TABLE')){await pg.exec(sql);return {rows:[],rowCount:0}}
  const result=await pg.query(sql,values.map(v=>prepareValue(v)));
  return {...result,rowCount:result.affectedRows??result.rows.length};
}
db.pool.query=(sql,values,callback)=>{
  if(typeof values==='function'){callback=values;values=[]}
  const result=query(sql,values);
  if(callback){result.then(r=>callback(null,r),callback);return}
  return result;
};
db.pool.connect=async()=>({query,release(){}});
const app=require('../server');
let server,base,cookie;
after(async()=>{if(server)await new Promise(r=>server.close(r));await pg.close();await db.pool.end()});
function payload(events,overrides={}){
  return {fullName:'Test Swimmer',schoolName:'Test School',gender:'Boys',dob:'2015-05-01',phone:'9999999999',email:'test@example.com',guardianName:'Parent',paymentUtr:'TEST-UTR',idempotencyKey:crypto.randomUUID(),events:JSON.stringify(events),...overrides};
}
async function submit(body){
  const data=new FormData();
  for(const [k,v] of Object.entries(body))if(v!==undefined){if(Array.isArray(v))for(const e of v)data.append(k,e);else data.set(k,v)}
  data.set('participantPhoto',new Blob(['photo'],{type:'image/png'}),'photo.png');
  data.set('paymentProof',new Blob(['proof'],{type:'image/png'}),'proof.png');
  const response=await fetch(base+'/api/register',{method:'POST',body:data});
  return {status:response.status,body:await response.json()};
}
async function count(table){return (await query(`SELECT COUNT(*)::int n FROM ${table}`)).rows[0].n}
test('registration JSONB integration',async t=>{
  await db.initDb();
  server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',err=>err?reject(err):resolve(s))});
  base=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin:'test-pin'})});
  assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  await t.test('reproduces original pg array failure',async()=>{
    assert.equal(prepareValue(['25m Freestyle']),'{"25m Freestyle"}');
    await assert.rejects(query('SELECT $1::jsonb',[['25m Freestyle']]),{code:'22P02'});
  });
  const cases=[['one',['25m Freestyle'],{}],['two',['25m Backstroke','25m Freestyle'],{}],['four',['25m Freestyle','50m Freestyle','25m Backstroke','25m Breaststroke'],{}],['Under-6 spaces',['25m Freestyle Kick with Board'],{dob:'2021-05-01'}],['relay plus four',['25m Freestyle','50m Freestyle','25m Backstroke','25m Breaststroke','4×50m Freestyle Relay'],{}],['array input',['25m Freestyle','25m Backstroke'],{events:['25m Freestyle','25m Backstroke']}],['fallback',['25m Freestyle'],{events:undefined,events_json:'["25m Freestyle"]'}],['plain string',['25m Freestyle'],{events:'25m Freestyle'}]];
  for(const [name,events,overrides] of cases)await t.test(name,async()=>{
    const body=payload(events,overrides),result=await submit(body);
    assert.equal(result.status,200,JSON.stringify(result.body));
    assert.match(result.body.registrationId,/^BSF26-/);
    const row=(await query('SELECT *, jsonb_typeof(events_json) kind FROM registrations WHERE registration_id=$1',[result.body.registrationId])).rows[0];
    assert.deepEqual(row.events_json,events);assert.equal(row.kind,'array');
    assert.equal(row.full_name,body.fullName);assert.equal(row.school_name,body.schoolName);
    assert.equal(row.phone,body.phone);assert.equal(row.email,body.email);assert.equal(row.guardian_name,body.guardianName);assert.equal(row.payment_utr,body.paymentUtr);
    assert.equal(Buffer.from(row.participant_photo).toString(),'photo');assert.equal(Buffer.from(row.payment_proof).toString(),'proof');
    assert.equal(row.participant_photo_mime,'image/png');assert.equal(row.payment_proof_mime,'image/png');
    const insert=inserts.at(-1);assert.equal(insert.values.length,18);assert.equal(typeof insert.values[11],'string');assert.equal(Array.isArray(insert.values[11]),false);assert.match(insert.sql,/\$12::jsonb/);
    assert.deepEqual(insert.values,[result.body.registrationId,result.body.ticketToken,body.idempotencyKey,body.fullName,body.schoolName,body.gender,body.dob,row.age_category,body.phone,body.email,body.guardianName,JSON.stringify(events),events.filter(e=>e!=='4×50m Freestyle Relay').length*300+(events.includes('4×50m Freestyle Relay')?800:0),Buffer.from('photo'),'image/png',Buffer.from('proof'),'image/png',body.paymentUtr]);
    assert.equal(row.gender,body.gender);assert.equal(row.idempotency_key,body.idempotencyKey);assert.equal(row.ticket_token,result.body.ticketToken);assert.equal(row.amount,insert.values[12]);
    const ticket=await (await fetch(base+'/api/ticket/'+result.body.ticketToken)).json();assert.deepEqual(ticket.events,events);
    const admin=await (await fetch(base+'/api/admin/event-participants?eventKey='+encodeURIComponent(`${row.age_category}|||Boys|||${events[0]}`),{headers:{cookie}})).json();assert.ok(admin.some(r=>r.registration_id===row.registration_id));
    const before=await count('registrations'),queued=await count('whatsapp_queue');
    const retry=await submit(body);assert.equal(retry.body.registrationId,result.body.registrationId);assert.equal(await count('registrations'),before);assert.equal(await count('whatsapp_queue'),queued);
  });
  for(const events of ['[broken','{"event":"25m Freestyle"}','null','12','[]','[null]','[["25m Freestyle"]]','["unknown"]','["25m Freestyle","25m Freestyle"]','["25m Freestyle","50m Freestyle","25m Backstroke","25m Breaststroke","25m Butterfly"]'])await t.test('reject '+events,async()=>{
    const before=await count('registrations');assert.equal((await submit(payload([],{events}))).status,400);assert.equal(await count('registrations'),before);
  });
  for(const field of ['fullName','schoolName','dob','phone','idempotencyKey'])await t.test('required '+field,async()=>{assert.equal((await submit(payload(['25m Freestyle'],{[field]:' '}))).status,400)});
  for(const table of ['registrations','whatsapp_queue'])await t.test('rollback '+table,async()=>{
    const before=await count('registrations'),queued=await count('whatsapp_queue'),body=payload(['25m Freestyle']);
    failTable=table;let failed;try{failed=await submit(body)}finally{failTable=null}
    assert.equal(failed.status,500);assert.equal(failed.body.code,'REGISTRATION_EVENTS_STORAGE_ERROR');
    assert.equal(await count('registrations'),before);assert.equal(await count('whatsapp_queue'),queued);
    assert.equal((await submit(body)).status,200);assert.equal(await count('registrations'),before+1);assert.equal(await count('whatsapp_queue'),queued+1);
  });
});
