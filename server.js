const express=require('express');
const session=require('express-session');
const pgSession=require('connect-pg-simple')(session);
const multer=require('multer');
const QRCode=require('qrcode');
const {v4:uuidv4}=require('uuid');
const path=require('path');
const {pool,initDb,withTransaction}=require('./src/db');
const {CATEGORIES,categoryForDob,eventKey,parseEventKey}=require('./src/competition');

const {registrationEvents,registrationRow,registrationColumns}=require('./src/admin-data');
const {requiresFloaters}=require('./public/floater-policy');

const app=express();
const PORT=process.env.PORT||3000;
const BASE_URL=process.env.BASE_URL||`http://localhost:${PORT}`;

if(!process.env.ADMIN_PIN||!process.env.SESSION_SECRET){
  throw new Error('ADMIN_PIN and SESSION_SECRET are required');
}

const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:6*1024*1024},
  fileFilter:(_,f,cb)=>/^image\//.test(f.mimetype)?cb(null,true):cb(new Error('Images only'))
});

app.set('trust proxy',1);
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({
  store:new pgSession({pool,createTableIfMissing:true}),
  secret:process.env.SESSION_SECRET,
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:43200000}
}));
app.use(express.static(path.join(__dirname,'public')));

const requireAdmin=(req,res,next)=>req.session?.admin?next():res.status(401).json({error:'Admin login required'});
const q=async(text,params=[])=>(await pool.query(text,params)).rows;
app.use(['/api/admin','/api/media'],(req,res,next)=>{res.set('Cache-Control','private, no-store');next()});
const validEventKey=key=>{
  if(typeof key!=='string'||key.split('|||').length!==3)return false;
  const {category,gender,event}=parseEventKey(key);
  return ['Boys','Girls'].includes(gender)&&CATEGORIES.some(c=>c.name===category&&c.events.includes(event));
};

async function audit(action,type,key,details,operator){
  try{
    await pool.query(
      'INSERT INTO admin_audit(action,entity_type,entity_key,details_json,operator) VALUES($1,$2,$3,$4,$5)',
      [action,type,key||null,details||{},operator||'Admin']
    );
  }catch(e){console.error('audit',e)}
}

app.get('/health',async(req,res)=>{
  try{await pool.query('SELECT 1');res.json({ok:true,database:'postgres'})}
  catch(e){res.status(503).json({ok:false})}
});

app.get('/api/config',(req,res)=>res.json({
  categories:CATEGORIES,
  payeeName:process.env.PAYEE_NAME||'BARODA SWIM FRONT',
  upiId:process.env.UPI_ID||'',
  paymentQrUrl:process.env.PAYMENT_QR_URL||'/bsf-payment-qr.jpeg'
}));

app.post('/api/register',upload.fields([{name:'participantPhoto',maxCount:1},{name:'paymentProof',maxCount:1}]),async(req,res)=>{
  try{
    const b=req.body||{};
    for(const field of ['fullName','schoolName','dob','phone','email','idempotencyKey']){
      if(typeof b[field]!=='string'||!b[field].trim())return res.status(400).json({error:`Missing or invalid required field: ${field}.`});
    }
    for(const field of ['guardianName','paymentUtr']){
      if(b[field]!=null&&typeof b[field]!=='string')return res.status(400).json({error:`Invalid field: ${field}.`});
    }
    if(b.email.trim().length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim()))return res.status(400).json({error:'Please enter a valid email address.'});
    const date=new Date(b.dob);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(b.dob)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==b.dob||date>new Date())return res.status(400).json({error:'Invalid date of birth.'});
    const c=categoryForDob(b.dob);
    if(!c)return res.status(400).json({error:'DOB is not eligible.'});
    if(!['Boys','Girls'].includes(b.gender))return res.status(400).json({error:'Invalid gender.'});
    const rawEvents=b.events??b.events_json??[];
    let normalizedEvents;
    if(Array.isArray(rawEvents))normalizedEvents=rawEvents;
    else if(typeof rawEvents==='string'){
      try{const parsed=JSON.parse(rawEvents);normalizedEvents=Array.isArray(parsed)?parsed:[parsed]}
      catch{normalizedEvents=[rawEvents]}
    }else normalizedEvents=[];
    if(!Array.isArray(normalizedEvents)||!normalizedEvents.length||normalizedEvents.some(e=>typeof e!=='string'||!c.events.includes(e))||new Set(normalizedEvents).size!==normalizedEvents.length){
      return res.status(400).json({error:'Select at least one valid event; duplicate events are not allowed.'});
    }
    const events=normalizedEvents;
    const eventsJson=JSON.stringify(normalizedEvents);
    if(requiresFloaters(c,events)&&b.floatersAcknowledged!==true&&b.floatersAcknowledged!=='true'){
      return res.status(400).json({error:'Please acknowledge that you must bring your own floaters; BSF and the school will not provide them.',code:'FLOATERS_ACKNOWLEDGEMENT_REQUIRED'});
    }
    const individuals=events.filter(x=>x!=='4×50m Freestyle Relay');
    const relay=events.includes('4×50m Freestyle Relay');
    if(individuals.length>4)return res.status(400).json({error:'Maximum 4 individual events allowed.'});
    if(events.some(e=>!c.events.includes(e)))return res.status(400).json({error:'Invalid event selection.'});
    const photo=req.files?.participantPhoto?.[0],proof=req.files?.paymentProof?.[0];
    if(!photo||!proof)return res.status(400).json({error:'Participant photo and payment screenshot are required.'});
    if(!b.idempotencyKey)return res.status(400).json({error:'Missing submission key.'});
    const old=(await q('SELECT registration_id,ticket_token FROM registrations WHERE idempotency_key=$1',[b.idempotencyKey]))[0];
    if(old)return res.json({ok:true,registrationId:old.registration_id,ticketToken:old.ticket_token,duplicateSafe:true});
    const amount=individuals.length*300+(relay?800:0);
    const registrationId=`BSF26-${Date.now().toString().slice(-7)}-${Math.floor(100+Math.random()*900)}`;
    const ticketToken=uuidv4();
    await withTransaction(async cdb=>{
      if(process.env.REGISTRATION_EVENTS_DEBUG==='true')console.log('REGISTRATION EVENTS DEBUG',{
        rawEvents,normalizedEvents,eventsJson,type:typeof eventsJson,isArray:Array.isArray(eventsJson)
      });
      await cdb.query(`INSERT INTO registrations(
        registration_id,ticket_token,idempotency_key,full_name,school_name,gender,
        dob,age_category,phone,email,guardian_name,events_json,amount,
        participant_photo,participant_photo_mime,payment_proof,payment_proof_mime,payment_utr
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18)`,[
        registrationId,ticketToken,b.idempotencyKey,b.fullName.trim(),b.schoolName.trim(),b.gender,
        b.dob,c.name,b.phone.trim(),b.email.trim(),b.guardianName?.trim()||null,
        eventsJson, // $12: JSON text, never a JavaScript array.
        amount,photo.buffer,photo.mimetype,proof.buffer,proof.mimetype,b.paymentUtr?.trim()||null
      ]);
      await cdb.query('INSERT INTO whatsapp_queue(registration_id,phone,message_type,payload_json) VALUES($1,$2,$3,$4)',[registrationId,b.phone.trim(),'ticket',{registrationId,ticketToken}]);
    });
    res.json({ok:true,registrationId,ticketToken,amount});
  }catch(e){
    console.error(e);
    if(e.code==='23505')return res.status(409).json({error:'Duplicate registration submission. Please retry once.'});
    const invalidJson=e.code==='22P02';
    res.status(500).json({
      error:invalidJson?'Registration was NOT saved because the selected events could not be stored. Please contact BSF support.':'Registration could not be confirmed because of a database error. Please retry with the same submission; do not pay again.',
      code:invalidJson?'REGISTRATION_EVENTS_STORAGE_ERROR':'REGISTRATION_DATABASE_ERROR'
    });
  }
});

app.get('/api/media/:registrationId/:kind',requireAdmin,async(req,res)=>{
  const col=req.params.kind==='photo'?'participant_photo':req.params.kind==='proof'?'payment_proof':null;
  if(!col)return res.status(404).json({error:'Media not found'});
  const r=(await q(`SELECT ${col} data,${col}_mime mime FROM registrations WHERE registration_id=$1`,[req.params.registrationId]))[0];
  if(!r?.data?.length||typeof r.mime!=='string'||!/^image\/[a-z0-9.+-]+$/i.test(r.mime))return res.status(404).json({error:'Media not found'});
  res.set({'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});
  res.type(r.mime).send(Buffer.from(r.data));
});

app.get('/api/ticket/:token',async(req,res)=>{
  const r=(await q('SELECT registration_id,ticket_token,full_name,school_name,age_category,gender,events_json,amount,payment_status FROM registrations WHERE ticket_token=$1',[req.params.token]))[0];
  if(!r)return res.status(404).json({error:'Ticket not found'});
  const scanUrl=`${BASE_URL}/admin/checkin.html?token=${encodeURIComponent(r.ticket_token)}`;
  res.json({registrationId:r.registration_id,fullName:r.full_name,schoolName:r.school_name,category:r.age_category,gender:r.gender,events:registrationEvents(r.events_json),amount:r.amount,paymentStatus:r.payment_status,requiresFloaters:requiresFloaters(CATEGORIES.find(c=>c.name===r.age_category),registrationEvents(r.events_json)),eventLabels:CATEGORIES.find(c=>c.name===r.age_category)?.eventLabels||{},competitionDate:'4 October 2026',registrationDeadline:'30 September 2026',venue:'Vadodara, Gujarat',checkinUrl:scanUrl,qrDataUrl:await QRCode.toDataURL(scanUrl,{margin:4,width:720}),token:r.ticket_token});
});

app.get('/api/public/results',async(req,res)=>{
  const rows=await q(`SELECT re.event_key,re.position,r.full_name,r.school_name,r.registration_id,(SELECT timing_text FROM timing_entries te WHERE te.event_key=re.event_key AND te.registration_id=re.registration_id LIMIT 1) timing_text FROM result_entries re JOIN registrations r ON r.registration_id=re.registration_id JOIN event_publication ep ON ep.event_key=re.event_key AND ep.published=TRUE ORDER BY ep.published_at DESC,re.event_key,re.position`);
  const g={};for(const x of rows){g[x.event_key]??={meta:parseEventKey(x.event_key),entries:[]};g[x.event_key].entries.push(x)}
  res.json(Object.values(g));
});

app.get('/api/public/timings',async(req,res)=>{
  const rows=await q(`SELECT te.event_key,te.heat_no,te.timing_text,te.status,r.full_name,r.school_name FROM timing_entries te JOIN registrations r ON r.registration_id=te.registration_id JOIN event_publication ep ON ep.event_key=te.event_key AND ep.published=TRUE ORDER BY te.event_key,te.heat_no,r.full_name`);
  res.json(rows.map(x=>({...x,meta:parseEventKey(x.event_key)})));
});

app.post('/api/admin/login',(req,res)=>{if(req.body?.pin===process.env.ADMIN_PIN){req.session.admin=true;req.session.operator='Admin';return res.json({ok:true})}res.status(403).json({error:'Incorrect PIN'})});
app.get('/api/admin/me',(req,res)=>res.json({authenticated:!!req.session?.admin}));

app.get('/api/admin/overview',requireAdmin,async(req,res)=>{
  const r=(await q(`SELECT COUNT(*)::int registrations,COUNT(*) FILTER(WHERE checkin_status='Approved')::int "checkedIn",COUNT(*) FILTER(WHERE payment_status='Pending')::int "paymentPending",COUNT(*) FILTER(WHERE payment_status='Verified')::int "paymentVerified" FROM registrations`))[0];
  const p=(await q('SELECT COUNT(*)::int c FROM event_publication WHERE published=TRUE'))[0];
  res.json({...r,published:p.c});
});

app.get('/api/admin/events',requireAdmin,async(req,res)=>{
  const regs=await q('SELECT registration_id,gender,age_category,events_json FROM registrations'),m={};
  for(const r of regs)for(const e of registrationEvents(r.events_json)){const k=eventKey(r.age_category,r.gender,e);m[k]??={key:k,category:r.age_category,gender:r.gender,event:e,count:0};m[k].count++}
  res.json(Object.values(m));
});

app.get('/api/admin/event-participants',requireAdmin,async(req,res)=>{
  if(!validEventKey(req.query.eventKey))return res.status(400).json({error:'Select a valid category, gender and event.'});
  const {category,gender,event}=parseEventKey(req.query.eventKey);
  const rows=await q('SELECT registration_id,full_name,school_name,events_json FROM registrations WHERE age_category=$1 AND gender=$2',[category,gender]);
  res.json(rows.map(r=>({...r,events_json:registrationEvents(r.events_json)})).filter(r=>r.events_json.includes(event)).map(r=>({...r,participant_photo:`/api/media/${encodeURIComponent(r.registration_id)}/photo`})));
});

app.get('/api/admin/timings',requireAdmin,async(req,res)=>res.json(await q(`SELECT te.*,r.full_name,r.school_name FROM timing_entries te JOIN registrations r ON r.registration_id=te.registration_id WHERE te.event_key=$1 AND te.heat_no=$2 ORDER BY r.full_name`,[req.query.eventKey,Number(req.query.heatNo||1)])));

app.post('/api/admin/timing',requireAdmin,async(req,res)=>{
  const b=req.body;
  await pool.query(`INSERT INTO timing_entries(event_key,heat_no,registration_id,timing_text,status,updated_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_key,heat_no,registration_id) DO UPDATE SET timing_text=EXCLUDED.timing_text,status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,[b.eventKey,Number(b.heatNo||1),b.registrationId,b.timingText||null,b.status||'TIME',req.session.operator||'Admin']);
  await audit('SAVE_TIMING','event',b.eventKey,{heatNo:Number(b.heatNo||1),registrationId:b.registrationId,timingText:b.timingText,status:b.status},req.session.operator);
  res.json({ok:true});
});

app.get('/api/admin/results',requireAdmin,async(req,res)=>{
  const entries=await q(`SELECT re.*,r.full_name,r.school_name FROM result_entries re JOIN registrations r ON r.registration_id=re.registration_id WHERE re.event_key=$1 ORDER BY re.position`,[req.query.eventKey]);
  const p=(await q('SELECT published FROM event_publication WHERE event_key=$1',[req.query.eventKey]))[0];
  res.json({entries,published:!!p?.published});
});

app.post('/api/admin/result',requireAdmin,async(req,res)=>{
  const b=req.body;
  await pool.query(`INSERT INTO result_entries(event_key,position,registration_id,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(event_key,position) DO UPDATE SET registration_id=EXCLUDED.registration_id,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,[b.eventKey,Number(b.position),b.registrationId,req.session.operator||'Admin']);
  await audit('SAVE_RESULT','event',b.eventKey,{position:Number(b.position),registrationId:b.registrationId},req.session.operator);
  res.json({ok:true});
});

app.post('/api/admin/publish-event',requireAdmin,async(req,res)=>{
  await pool.query(`INSERT INTO event_publication(event_key,published,published_at,published_by) VALUES($1,TRUE,NOW(),$2) ON CONFLICT(event_key) DO UPDATE SET published=TRUE,published_at=NOW(),published_by=EXCLUDED.published_by`,[req.body.eventKey,req.session.operator||'Admin']);
  await audit('PUBLISH_EVENT','event',req.body.eventKey,{},req.session.operator);
  res.json({ok:true});
});

app.post('/api/admin/unpublish-event',requireAdmin,async(req,res)=>{
  await pool.query(`INSERT INTO event_publication(event_key,published,published_at,published_by) VALUES($1,FALSE,NULL,$2) ON CONFLICT(event_key) DO UPDATE SET published=FALSE,published_at=NULL,published_by=EXCLUDED.published_by`,[req.body.eventKey,req.session.operator||'Admin']);
  res.json({ok:true});
});

app.get('/api/admin/checkin/:token',requireAdmin,async(req,res)=>{
  const raw=(await q(`SELECT ${registrationColumns} FROM registrations WHERE ticket_token=$1`,[req.params.token]))[0];
  const r=raw?registrationRow(raw):null;
  if(!r)return res.status(404).json({error:'Ticket not found'});
  res.json({registrationId:r.registration_id,fullName:r.full_name,schoolName:r.school_name,gender:r.gender,dob:r.dob,category:r.age_category,photo:r.participant_photo,paymentProof:r.payment_proof,paymentStatus:r.payment_status,checkinStatus:r.checkin_status,events:registrationEvents(r.events_json)});
});

app.post('/api/admin/checkin/:token',requireAdmin,async(req,res)=>{
  const r=(await q('SELECT registration_id FROM registrations WHERE ticket_token=$1',[req.params.token]))[0];
  if(!r)return res.status(404).json({error:'Ticket not found'});
  if(!['Approved','Rejected'].includes(req.body.decision))return res.status(400).json({error:'Invalid decision'});
  await withTransaction(async c=>{
    await c.query('UPDATE registrations SET checkin_status=$1 WHERE registration_id=$2',[req.body.decision,r.registration_id]);
    await c.query('INSERT INTO checkin_audit(registration_id,decision,reason,operator) VALUES($1,$2,$3,$4)',[r.registration_id,req.body.decision,req.body.reason||null,req.session.operator||'Admin']);
  });
  await audit('CHECKIN_DECISION','registration',r.registration_id,{decision:req.body.decision,reason:req.body.reason||null},req.session.operator);
  res.json({ok:true,status:req.body.decision});
});

app.post('/api/admin/seed-heats',requireAdmin,async(req,res)=>{
  const ek=req.body.eventKey,lanes=Math.max(1,Math.min(10,Number(req.body.lanes||6)));
  if(!validEventKey(ek)||!Number.isInteger(lanes))return res.status(400).json({error:'Select a valid event and lane count.'});
  const {category,gender,event}=parseEventKey(ek);
  const regs=(await q('SELECT registration_id,full_name,school_name,events_json FROM registrations WHERE age_category=$1 AND gender=$2 ORDER BY created_at,full_name',[category,gender])).filter(r=>registrationEvents(r.events_json).includes(event));
  await withTransaction(async c=>{
    await c.query('DELETE FROM race_entries WHERE event_key=$1',[ek]);
    for(let i=0;i<regs.length;i++)await c.query('INSERT INTO race_entries(event_key,heat_no,lane_no,registration_id) VALUES($1,$2,$3,$4)',[ek,Math.floor(i/lanes)+1,(i%lanes)+1,regs[i].registration_id]);
  });
  await audit('SEED_HEATS','event',ek,{participants:regs.length,lanes},req.session.operator);
  res.json({ok:true,participants:regs.length,heats:Math.ceil(regs.length/lanes)});
});

app.get('/api/admin/race-card',requireAdmin,async(req,res)=>{
  const ek=req.query.eventKey,heat=Number(req.query.heatNo||1);
  const rows=await q(`SELECT re.heat_no,re.lane_no,r.registration_id,r.full_name,r.school_name,te.timing_text,te.status,te.updated_at FROM race_entries re JOIN registrations r ON r.registration_id=re.registration_id LEFT JOIN timing_entries te ON te.event_key=re.event_key AND te.heat_no=re.heat_no AND te.registration_id=re.registration_id WHERE re.event_key=$1 AND re.heat_no=$2 ORDER BY re.lane_no`,[ek,heat]);
  const hc=(await q('SELECT COALESCE(MAX(heat_no),0)::int c FROM race_entries WHERE event_key=$1',[ek]))[0];
  res.json({rows,heatCount:hc.c});
});

app.get('/api/admin/registrations',requireAdmin,async(req,res)=>{
  const filters=req.query;
  if(Object.keys(filters).some(key=>!['search','category','gender','event','paymentStatus','page','limit'].includes(key)))return res.status(400).json({error:'Unknown registration filter.'});
  for(const key of ['search','category','gender','event','paymentStatus','page','limit']){
    if(filters[key]!==undefined&&typeof filters[key]!=='string')return res.status(400).json({error:'Invalid registration filter.'});
  }
  const page=Number(filters.page||1),limit=Number(filters.limit||50);
  if(!Number.isSafeInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100)return res.status(400).json({error:'Invalid page or limit.'});
  const clauses=[],values=[];
  for(const [key,column] of [['category','age_category'],['gender','gender'],['paymentStatus','payment_status']]){
    if(filters[key]){values.push(filters[key]);clauses.push(`${column}=$${values.length}`)}
  }
  if(filters.search?.trim()){
    values.push(filters.search.trim());
    clauses.push(`strpos(lower(concat_ws(' ',registration_id,full_name,school_name,phone)),lower($${values.length}))>0`);
  }
  // Exclude image bytes; normalize legacy event values before event filtering and pagination.
  const rows=(await q(`SELECT ${registrationColumns} FROM registrations ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY created_at DESC,registration_id`,values)).map(registrationRow).filter(r=>!filters.event||r.events_json.includes(filters.event));
  res.json({rows:rows.slice((page-1)*limit,page*limit),total:rows.length,page,limit});
});

app.get('/api/admin/registrations/:registrationId',requireAdmin,async(req,res)=>{
  const row=(await q(`SELECT ${registrationColumns},ticket_token FROM registrations WHERE registration_id=$1`,[req.params.registrationId]))[0];
  if(!row)return res.status(404).json({error:'Registration not found'});
  const registration=registrationRow(row);
  const ticketUrl=row.ticket_token?`/success.html?token=${encodeURIComponent(row.ticket_token)}`:null;
  const qrDataUrl=row.ticket_token?await QRCode.toDataURL(`${BASE_URL}/admin/checkin.html?token=${encodeURIComponent(row.ticket_token)}`,{margin:1,width:360}):null;
  res.json({...registration,ticketUrl,qrDataUrl});
});

app.get('/api/admin/payments',requireAdmin,async(req,res)=>{
  const rows=await q(`SELECT ${registrationColumns} FROM registrations ORDER BY created_at DESC,registration_id`);
  res.json(rows.map(registrationRow));
});

app.post('/api/admin/payment-status',requireAdmin,async(req,res)=>{
  const {registrationId,status}=req.body||{};
  if(typeof registrationId!=='string'||!registrationId.trim())return res.status(400).json({error:'Registration ID is required.'});
  if(!['Pending','Verified','Issue'].includes(status))return res.status(400).json({error:'Invalid status'});
  const x=await pool.query('UPDATE registrations SET payment_status=$1 WHERE registration_id=$2',[status,registrationId]);
  if(!x.rowCount)return res.status(404).json({error:'Registration not found'});
  await audit('PAYMENT_STATUS','registration',registrationId,{status},req.session.operator);
  res.json({ok:true});
});

app.get('/api/admin/audit',requireAdmin,async(req,res)=>res.json(await q('SELECT * FROM admin_audit ORDER BY id DESC LIMIT 200')));
app.get('/api/wallet/google/:token',(req,res)=>res.status(501).json({error:'Google Wallet credentials not configured yet.'}));
app.get('/api/wallet/apple/:token',(req,res)=>res.status(501).json({error:'Apple Wallet credentials not configured yet.'}));

app.use((e,req,res,next)=>{
  console.error(e);
  if(res.headersSent)return next(e);
  const status=e.status===400?400:500;
  res.status(status).json({error:status===400?'Invalid request. Please check the submitted values.':'The request could not be completed. Please retry.'});
});

if(require.main===module)initDb().then(()=>app.listen(PORT,()=>console.log(`BSF production server running on ${BASE_URL}`,{
  commit:process.env.RAILWAY_GIT_COMMIT_SHA||'local',branch:process.env.RAILWAY_GIT_BRANCH||'unknown',entrypoint:__filename
}))).catch(e=>{console.error('Database initialization failed',e);process.exit(1)});
module.exports=app;
