const express=require('express');
const session=require('express-session');
const multer=require('multer');
const QRCode=require('qrcode');
const {v4:uuidv4}=require('uuid');
const path=require('path');
const fs=require('fs');
const db=require('./src/db');
const {CATEGORIES,categoryForDob,eventKey,parseEventKey}=require('./src/competition');
const app=express();
const PORT=process.env.PORT||3000;
const BASE_URL=process.env.BASE_URL||`http://localhost:${PORT}`;
const ADMIN_PIN=process.env.ADMIN_PIN||'2468';
const uploadDir=path.join(__dirname,'uploads');fs.mkdirSync(uploadDir,{recursive:true});
const upload=multer({dest:uploadDir,limits:{fileSize:6*1024*1024},fileFilter:(_,f,cb)=>/^image\//.test(f.mimetype)?cb(null,true):cb(new Error('Images only'))});
app.use(express.json());app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||'change-me',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',maxAge:43200000}}));
app.use('/uploads',express.static(uploadDir));
app.use(express.static(path.join(__dirname,'public')));
const requireAdmin=(req,res,next)=>req.session?.admin?next():res.status(401).json({error:'Admin login required'});

app.get('/api/config',(req,res)=>res.json({categories:CATEGORIES,payeeName:process.env.PAYEE_NAME||'AARK International School',upiId:process.env.UPI_ID||'replace@upi',paymentQrUrl:process.env.PAYMENT_QR_URL||'/payment-qr-placeholder.svg'}));

app.post('/api/register',upload.fields([{name:'participantPhoto',maxCount:1},{name:'paymentProof',maxCount:1}]),(req,res)=>{
 try{
  const b=req.body,c=categoryForDob(b.dob); if(!c)return res.status(400).json({error:'DOB is not eligible.'});
  if(!['Boys','Girls'].includes(b.gender))return res.status(400).json({error:'Invalid gender.'});
  let events=[];try{events=JSON.parse(b.events||'[]')}catch{};if(!Array.isArray(events))events=[];
  const individuals=events.filter(x=>x!=='4×50m Freestyle Relay');const relay=events.includes('4×50m Freestyle Relay');
  if(individuals.length>4)return res.status(400).json({error:'Maximum 4 individual events allowed.'});
  if(events.some(e=>!c.events.includes(e)))return res.status(400).json({error:'Invalid event selection.'});
  if(!req.files?.participantPhoto?.[0]||!req.files?.paymentProof?.[0])return res.status(400).json({error:'Participant photo and payment screenshot are required.'});
  if(!b.idempotencyKey)return res.status(400).json({error:'Missing submission key.'});
  const old=db.prepare('SELECT registration_id,ticket_token FROM registrations WHERE idempotency_key=?').get(b.idempotencyKey);
  if(old)return res.json({ok:true,registrationId:old.registration_id,ticketToken:old.ticket_token,duplicateSafe:true});
  const amount=individuals.length*300+(relay?800:0),registrationId=`AARK26-${Date.now().toString().slice(-7)}-${Math.floor(100+Math.random()*900)}`,ticketToken=uuidv4();
  db.transaction(()=>{
   db.prepare(`INSERT INTO registrations(registration_id,ticket_token,idempotency_key,full_name,school_name,gender,dob,age_category,phone,email,guardian_name,events_json,amount,participant_photo,payment_proof,payment_utr) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(registrationId,ticketToken,b.idempotencyKey,b.fullName.trim(),b.schoolName.trim(),b.gender,b.dob,c.name,b.phone.trim(),b.email?.trim()||null,b.guardianName?.trim()||null,JSON.stringify(events),amount,`/uploads/${req.files.participantPhoto[0].filename}`,`/uploads/${req.files.paymentProof[0].filename}`,b.paymentUtr?.trim()||null);
   db.prepare('INSERT INTO whatsapp_queue(registration_id,phone,message_type,payload_json) VALUES(?,?,?,?)').run(registrationId,b.phone.trim(),'ticket',JSON.stringify({registrationId,ticketToken}));
  })();
  res.json({ok:true,registrationId,ticketToken,amount});
 }catch(e){console.error(e);res.status(500).json({error:'Registration was NOT saved. Please retry.'})}
});

app.get('/api/ticket/:token',async(req,res)=>{const r=db.prepare('SELECT * FROM registrations WHERE ticket_token=?').get(req.params.token);if(!r)return res.status(404).json({error:'Ticket not found'});const scanUrl=`${BASE_URL}/admin/checkin.html?token=${encodeURIComponent(r.ticket_token)}`;res.json({registrationId:r.registration_id,fullName:r.full_name,schoolName:r.school_name,category:r.age_category,gender:r.gender,events:JSON.parse(r.events_json),amount:r.amount,qrDataUrl:await QRCode.toDataURL(scanUrl,{margin:1,width:360}),token:r.ticket_token})});

app.get('/api/public/results',(req,res)=>{const rows=db.prepare(`SELECT re.event_key,re.position,r.full_name,r.school_name,r.registration_id,(SELECT timing_text FROM timing_entries te WHERE te.event_key=re.event_key AND te.registration_id=re.registration_id LIMIT 1) timing_text FROM result_entries re JOIN registrations r ON r.registration_id=re.registration_id JOIN event_publication ep ON ep.event_key=re.event_key AND ep.published=1 ORDER BY ep.published_at DESC,re.event_key,re.position`).all();const g={};for(const x of rows){g[x.event_key]??={meta:parseEventKey(x.event_key),entries:[]};g[x.event_key].entries.push(x)}res.json(Object.values(g))});
app.get('/api/public/timings',(req,res)=>{const rows=db.prepare(`SELECT te.event_key,te.heat_no,te.timing_text,te.status,r.full_name,r.school_name FROM timing_entries te JOIN registrations r ON r.registration_id=te.registration_id JOIN event_publication ep ON ep.event_key=te.event_key AND ep.published=1 ORDER BY te.event_key,te.heat_no,r.full_name`).all();res.json(rows.map(x=>({...x,meta:parseEventKey(x.event_key)})))});

app.post('/api/admin/login',(req,res)=>{if(req.body.pin===ADMIN_PIN){req.session.admin=true;req.session.operator='Admin';return res.json({ok:true})}res.status(403).json({error:'Incorrect PIN'})});
app.get('/api/admin/me',(req,res)=>res.json({authenticated:!!req.session?.admin}));
app.get('/api/admin/overview',requireAdmin,(req,res)=>res.json({registrations:db.prepare('SELECT COUNT(*) c FROM registrations').get().c,checkedIn:db.prepare("SELECT COUNT(*) c FROM registrations WHERE checkin_status='Approved'").get().c,paymentPending:db.prepare("SELECT COUNT(*) c FROM registrations WHERE payment_status='Pending'").get().c,published:db.prepare('SELECT COUNT(*) c FROM event_publication WHERE published=1').get().c}));
app.get('/api/admin/events',requireAdmin,(req,res)=>{const regs=db.prepare('SELECT registration_id,gender,age_category,events_json FROM registrations').all(),m={};for(const r of regs)for(const e of JSON.parse(r.events_json)){const k=eventKey(r.age_category,r.gender,e);m[k]??={key:k,category:r.age_category,gender:r.gender,event:e,count:0};m[k].count++}res.json(Object.values(m))});
app.get('/api/admin/event-participants',requireAdmin,(req,res)=>{const {category,gender,event}=parseEventKey(req.query.eventKey);const rows=db.prepare('SELECT registration_id,full_name,school_name,participant_photo,events_json FROM registrations WHERE age_category=? AND gender=?').all(category,gender).filter(r=>JSON.parse(r.events_json).includes(event));res.json(rows)});
app.get('/api/admin/timings',requireAdmin,(req,res)=>res.json(db.prepare(`SELECT te.*,r.full_name,r.school_name FROM timing_entries te JOIN registrations r ON r.registration_id=te.registration_id WHERE te.event_key=? AND te.heat_no=? ORDER BY r.full_name`).all(req.query.eventKey,Number(req.query.heatNo||1))));
app.post('/api/admin/timing',requireAdmin,(req,res)=>{const b=req.body;db.prepare(`INSERT INTO timing_entries(event_key,heat_no,registration_id,timing_text,status,updated_by,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(event_key,heat_no,registration_id) DO UPDATE SET timing_text=excluded.timing_text,status=excluded.status,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).run(b.eventKey,Number(b.heatNo||1),b.registrationId,b.timingText||null,b.status||'TIME',req.session.operator||'Admin');audit('SAVE_TIMING','event',b.eventKey,{heatNo:Number(b.heatNo||1),registrationId:b.registrationId,timingText:b.timingText,status:b.status},req.session.operator);res.json({ok:true})});
app.get('/api/admin/results',requireAdmin,(req,res)=>{const entries=db.prepare(`SELECT re.*,r.full_name,r.school_name FROM result_entries re JOIN registrations r ON r.registration_id=re.registration_id WHERE re.event_key=? ORDER BY re.position`).all(req.query.eventKey);const p=db.prepare('SELECT published FROM event_publication WHERE event_key=?').get(req.query.eventKey);res.json({entries,published:!!p?.published})});
app.post('/api/admin/result',requireAdmin,(req,res)=>{const b=req.body;db.prepare(`INSERT INTO result_entries(event_key,position,registration_id,updated_by,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(event_key,position) DO UPDATE SET registration_id=excluded.registration_id,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).run(b.eventKey,Number(b.position),b.registrationId,req.session.operator||'Admin');audit('SAVE_RESULT','event',b.eventKey,{position:Number(b.position),registrationId:b.registrationId},req.session.operator);res.json({ok:true})});
app.post('/api/admin/publish-event',requireAdmin,(req,res)=>{db.prepare(`INSERT INTO event_publication(event_key,published,published_at,published_by) VALUES(?,1,CURRENT_TIMESTAMP,?) ON CONFLICT(event_key) DO UPDATE SET published=1,published_at=CURRENT_TIMESTAMP,published_by=excluded.published_by`).run(req.body.eventKey,req.session.operator||'Admin');audit('PUBLISH_EVENT','event',req.body.eventKey,{},req.session.operator);res.json({ok:true})});
app.post('/api/admin/unpublish-event',requireAdmin,(req,res)=>{db.prepare(`INSERT INTO event_publication(event_key,published,published_at,published_by) VALUES(?,0,NULL,?) ON CONFLICT(event_key) DO UPDATE SET published=0,published_at=NULL,published_by=excluded.published_by`).run(req.body.eventKey,req.session.operator||'Admin');res.json({ok:true})});
app.get('/api/admin/checkin/:token',requireAdmin,(req,res)=>{const r=db.prepare('SELECT * FROM registrations WHERE ticket_token=?').get(req.params.token);if(!r)return res.status(404).json({error:'Ticket not found'});res.json({registrationId:r.registration_id,fullName:r.full_name,schoolName:r.school_name,gender:r.gender,dob:r.dob,category:r.age_category,photo:r.participant_photo,paymentProof:r.payment_proof,paymentStatus:r.payment_status,checkinStatus:r.checkin_status,events:JSON.parse(r.events_json)})});
app.post('/api/admin/checkin/:token',requireAdmin,(req,res)=>{const r=db.prepare('SELECT * FROM registrations WHERE ticket_token=?').get(req.params.token);if(!r)return res.status(404).json({error:'Ticket not found'});if(!['Approved','Rejected'].includes(req.body.decision))return res.status(400).json({error:'Invalid decision'});db.transaction(()=>{db.prepare('UPDATE registrations SET checkin_status=? WHERE registration_id=?').run(req.body.decision,r.registration_id);db.prepare('INSERT INTO checkin_audit(registration_id,decision,reason,operator) VALUES(?,?,?,?)').run(r.registration_id,req.body.decision,req.body.reason||null,req.session.operator||'Admin')})();audit('CHECKIN_DECISION','registration',r.registration_id,{decision:req.body.decision,reason:req.body.reason||null},req.session.operator);res.json({ok:true,status:req.body.decision})});

function audit(action,entityType,entityKey,details,operator){try{db.prepare('INSERT INTO admin_audit(action,entity_type,entity_key,details_json,operator) VALUES(?,?,?,?,?)').run(action,entityType,entityKey||null,JSON.stringify(details||{}),operator||'Admin')}catch(e){console.error('audit',e)}}

app.post('/api/admin/seed-heats',requireAdmin,(req,res)=>{const ek=req.body.eventKey,lanes=Math.max(1,Math.min(10,Number(req.body.lanes||6)));if(!ek)return res.status(400).json({error:'Missing event'});const {category,gender,event}=parseEventKey(ek);const regs=db.prepare('SELECT registration_id,full_name,school_name,events_json FROM registrations WHERE age_category=? AND gender=? ORDER BY created_at,full_name').all(category,gender).filter(r=>JSON.parse(r.events_json).includes(event));db.transaction(()=>{db.prepare('DELETE FROM race_entries WHERE event_key=?').run(ek);const ins=db.prepare('INSERT INTO race_entries(event_key,heat_no,lane_no,registration_id) VALUES(?,?,?,?)');regs.forEach((r,i)=>ins.run(ek,Math.floor(i/lanes)+1,(i%lanes)+1,r.registration_id))})();audit('SEED_HEATS','event',ek,{participants:regs.length,lanes},req.session.operator);res.json({ok:true,participants:regs.length,heats:Math.ceil(regs.length/lanes)})});

app.get('/api/admin/race-card',requireAdmin,(req,res)=>{const ek=req.query.eventKey,heat=Number(req.query.heatNo||1);const rows=db.prepare(`SELECT re.heat_no,re.lane_no,r.registration_id,r.full_name,r.school_name,te.timing_text,te.status,te.updated_at FROM race_entries re JOIN registrations r ON r.registration_id=re.registration_id LEFT JOIN timing_entries te ON te.event_key=re.event_key AND te.heat_no=re.heat_no AND te.registration_id=re.registration_id WHERE re.event_key=? AND re.heat_no=? ORDER BY re.lane_no`).all(ek,heat);const heatCount=db.prepare('SELECT COALESCE(MAX(heat_no),0) c FROM race_entries WHERE event_key=?').get(ek).c;res.json({rows,heatCount})});

app.get('/api/admin/payments',requireAdmin,(req,res)=>res.json(db.prepare(`SELECT registration_id,full_name,school_name,phone,amount,payment_proof,payment_utr,payment_status,created_at FROM registrations ORDER BY created_at DESC LIMIT 500`).all()));
app.post('/api/admin/payment-status',requireAdmin,(req,res)=>{const {registrationId,status}=req.body;if(!['Pending','Verified','Issue'].includes(status))return res.status(400).json({error:'Invalid status'});const x=db.prepare('UPDATE registrations SET payment_status=? WHERE registration_id=?').run(status,registrationId);if(!x.changes)return res.status(404).json({error:'Registration not found'});audit('PAYMENT_STATUS','registration',registrationId,{status},req.session.operator);res.json({ok:true})});
app.get('/api/admin/audit',requireAdmin,(req,res)=>res.json(db.prepare('SELECT * FROM admin_audit ORDER BY id DESC LIMIT 200').all()));

app.get('/api/wallet/google/:token',(req,res)=>res.status(501).json({error:'Google Wallet credentials not configured yet.'}));
app.get('/api/wallet/apple/:token',(req,res)=>res.status(501).json({error:'Apple Wallet credentials not configured yet.'}));
app.use((e,req,res,next)=>{console.error(e);res.status(500).json({error:e.message||'Server error'})});
app.listen(PORT,()=>console.log(`Running on ${BASE_URL}`));
