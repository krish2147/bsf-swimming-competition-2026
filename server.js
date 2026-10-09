const express=require('express');
const session=require('express-session');
const pgSession=require('connect-pg-simple')(session);
const multer=require('multer');
const QRCode=require('qrcode');
const {v4:uuidv4}=require('uuid');
const path=require('path');
const crypto=require('crypto');
const {pool,initDb,withTransaction}=require('./src/db');
const {CATEGORIES,categoryForDob,eventKey,parseEventKey}=require('./src/competition');

const {registrationEvents,registrationRow,registrationColumns}=require('./src/admin-data');
const {planHeats}=require('./src/heats');
const {heatSheetPdf,heatSheetDocx,buildHeatSheet,heatListDocx}=require('./src/heat-sheets');
const {certificatePdf,meritCertificatePdf,meritCertificatesBook,ordinal}=require('./src/certificate');
const {requiresFloaters}=require('./public/floater-policy');
const {assignHeats,heatSizes}=require('./public/heat-layout');
const timingSeconds=require('./public/timing-parse');

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
// Self-hosted QR decoder for the check-in camera scanner (works without CDN access at the venue).
app.get('/admin/vendor/jsQR.js',(req,res)=>res.sendFile(require.resolve('jsqr/dist/jsQR.js')));

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

// Convert upload/parser failures into clear registration errors instead of the generic 500 handler.
app.use((err,req,res,next)=>{
  if(err instanceof multer.MulterError){
    if(err.code==='LIMIT_FILE_SIZE')return res.status(413).json({error:'Participant photo or payment screenshot is too large. Please choose an image up to 6 MB and try again.',code:'IMAGE_TOO_LARGE'});
    return res.status(400).json({error:'The image upload could not be processed. Please choose the participant photo and payment screenshot again.',code:'IMAGE_UPLOAD_ERROR'});
  }
  if(err?.message==='Images only')return res.status(400).json({error:'Only image files are allowed for the participant photo and payment screenshot.',code:'IMAGE_TYPE_ERROR'});
  next(err);
});

app.get('/health',async(req,res)=>{
  try{await pool.query('SELECT 1');res.json({ok:true,database:'postgres'})}
  catch(e){res.status(503).json({ok:false})}
});

// Registration reopened by the organisers and closes at midnight at the end of 1 October 2026 (IST). Override with
// REGISTRATION_CLOSES_AT (an ISO date-time, e.g. 2026-10-03T00:00:00+05:30) in the environment without a code change.
const DEFAULT_REGISTRATION_CLOSES_AT='2026-10-02T00:00:00+05:30';
function registrationClosesAt(){
  const configured=new Date(process.env.REGISTRATION_CLOSES_AT||DEFAULT_REGISTRATION_CLOSES_AT);
  return Number.isNaN(configured.getTime())?new Date(DEFAULT_REGISTRATION_CLOSES_AT):configured;
}
// The competition is over: the public site shows the certificates popup and registration is closed for
// everyone (admins too), whatever REGISTRATION_CLOSES_AT says. Set TOURNAMENT=open to undo.
const tournamentOpen=()=>String(process.env.TOURNAMENT||'').toLowerCase()==='open';
const registrationOpen=()=>tournamentOpen()&&Date.now()<registrationClosesAt().getTime();
const REGISTRATION_CLOSED_MESSAGE='Registration for the competition is now closed. If you already registered, use Find My Ticket to get your ticket.';

app.get('/api/config',(req,res)=>res.json({
  registrationOpen:registrationOpen(),
  tournamentClosed:!tournamentOpen(),
  // A logged-in admin can still add late entries through the normal form after registration closes (not after the competition).
  lateEntry:tournamentOpen()&&!registrationOpen()&&!!req.session?.admin,
  registrationClosesAt:registrationClosesAt().toISOString(),
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
    // Checked after the duplicate lookup so a retry of a registration saved before closing still returns its ticket.
    const lateEntry=!registrationOpen();
    if(lateEntry&&(!req.session?.admin||!tournamentOpen()))return res.status(403).json({error:REGISTRATION_CLOSED_MESSAGE,code:'REGISTRATION_CLOSED'});
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
        eventsJson,
        amount,photo.buffer,photo.mimetype,proof.buffer,proof.mimetype,b.paymentUtr?.trim()||null
      ]);
      await cdb.query('INSERT INTO whatsapp_queue(registration_id,phone,message_type,payload_json) VALUES($1,$2,$3,$4)',[registrationId,b.phone.trim(),'ticket',{registrationId,ticketToken}]);
    });
    if(lateEntry)await audit('LATE_ENTRY','registration',registrationId,{fullName:b.fullName.trim(),category:c.name,events},req.session.operator);
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
  res.json({registrationId:r.registration_id,fullName:r.full_name,schoolName:r.school_name,category:r.age_category,gender:r.gender,events:registrationEvents(r.events_json),amount:r.amount,paymentStatus:r.payment_status,requiresFloaters:requiresFloaters(CATEGORIES.find(c=>c.name===r.age_category),registrationEvents(r.events_json)),eventLabels:CATEGORIES.find(c=>c.name===r.age_category)?.eventLabels||{},competitionDate:'4 October 2026',registrationDeadline:'1 October 2026',venue:'Vadodara, Gujarat',checkinUrl:scanUrl,...certificateInfo(r.ticket_token,registrationEvents(r.events_json),eventLabelsFor(r.age_category)),meritCertificates:meritList(r.ticket_token,meritAvailable()?(await medalsByRegistration()).get(r.registration_id):[]),qrDataUrl:await QRCode.toDataURL(scanUrl,{margin:4,width:720}),token:r.ticket_token});
});

// Participation certificates: downloadable with the ticket link from competition day (CERTIFICATES_FROM overrides, ISO date-time).
const DEFAULT_CERTIFICATES_FROM='2026-10-04T00:00:00+05:30';
function certificatesFrom(){const d=new Date(process.env.CERTIFICATES_FROM||DEFAULT_CERTIFICATES_FROM);return Number.isNaN(d.getTime())?new Date(DEFAULT_CERTIFICATES_FROM):d}
const certificatesAvailable=()=>Date.now()>=certificatesFrom().getTime();
// One participation certificate per event the swimmer entered (?event=<event>); certificateUrl stays the swimmer's link.
const certificateInfo=(token,events=[],labels={})=>{const base=`/api/certificate/${encodeURIComponent(token)}`;return {certificateUrl:base,certificateAvailable:certificatesAvailable(),certificateAvailableFrom:certificatesFrom().toISOString(),
  participationCertificates:events.map(e=>({event:labels[e]||e,url:`${base}?event=${encodeURIComponent(e)}`}))}};
const eventLabelsFor=category=>CATEGORIES.find(c=>c.name===category)?.eventLabels||{};
app.get('/api/certificate/:token',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const r=(await q('SELECT registration_id,full_name,school_name,age_category,gender,events_json FROM registrations WHERE ticket_token=$1',[req.params.token]))[0];
  if(!r)return res.status(404).json({error:'Certificate not found. Please use the link from your ticket.'});
  if(!certificatesAvailable())return res.status(403).json({error:'Participation certificates can be downloaded from 4 October 2026, the day of the competition.',code:'CERTIFICATE_NOT_YET_AVAILABLE',availableFrom:certificatesFrom().toISOString()});
  const labels=eventLabelsFor(r.age_category),entered=registrationEvents(r.events_json),slug=v=>String(v).replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'');
  // ?event=<event>: the certificate for that one event; without it, one event's certificate (or all events, for old links).
  const chosen=req.query.event?[String(req.query.event)]:entered;
  if(req.query.event&&!entered.includes(chosen[0]))return res.status(404).json({error:'This swimmer did not enter that event.',code:'EVENT_NOT_ENTERED'});
  const pdf=await certificatePdf({fullName:r.full_name,schoolName:r.school_name,category:r.age_category,gender:r.gender,events:chosen.map(e=>labels[e]||e),registrationId:r.registration_id});
  const file=`BSF-Participation-Certificate-${slug(r.full_name)||r.registration_id}${chosen.length===1&&req.query.event?'-'+slug(labels[chosen[0]]||chosen[0]):''}.pdf`;
  res.set('Content-Type','application/pdf');res.set('Content-Disposition',`attachment; filename="${file}"`);
  res.send(pdf);
});

app.post('/api/ticket-recovery',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
    const phone=typeof req.body?.phone==='string'?req.body.phone.trim():'',dob=typeof req.body?.dob==='string'?req.body.dob.trim():'';
    const digits=value=>String(value||'').replace(/\D/g,'');
    const normalizePhone=value=>{const d=digits(value);return d.length>10?d.slice(-10):d};
    if(normalizePhone(phone).length!==10||!/^\d{4}-\d{2}-\d{2}$/.test(dob))return res.status(400).json({error:'Enter the registered 10-digit phone number and participant date of birth.'});
    const rows=await q('SELECT registration_id,ticket_token,full_name,school_name,phone,age_category,events_json FROM registrations WHERE dob=$1 ORDER BY created_at DESC',[dob]);
    const medals=meritAvailable()?await medalsByRegistration():new Map();
    const matches=rows.filter(r=>normalizePhone(r.phone)===normalizePhone(phone)).slice(0,5).map(r=>({
      registrationId:r.registration_id,
      fullName:r.full_name,
      schoolName:r.school_name,
      ticketUrl:`/success.html?token=${encodeURIComponent(r.ticket_token)}`,
      ...certificateInfo(r.ticket_token,registrationEvents(r.events_json),eventLabelsFor(r.age_category)),
      meritCertificates:meritList(r.ticket_token,medals.get(r.registration_id))
    }));
    if(!matches.length)return res.status(404).json({error:'No registration matched those details. Check the phone number and participant date of birth.'});
    res.json({ok:true,matches});
  }catch(e){
    console.error('ticket recovery',e);
    res.status(500).json({error:'Ticket recovery is temporarily unavailable. Please try again.'});
  }
});

// Live results: per event, an overall ranking across all heats from saved times (provisional), and the official podium
// once the event is published from the Results desk.
// Public results and live timings are live; set PUBLIC_RESULTS=closed / PUBLIC_TIMINGS=closed in the environment to hide them.
const publicResultsOpen=()=>String(process.env.PUBLIC_RESULTS||'').toLowerCase()!=='closed';
const publicTimingsOpen=()=>String(process.env.PUBLIC_TIMINGS||'').toLowerCase()!=='closed';
app.get('/api/public/results',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!publicResultsOpen())return res.json({closed:true});
  res.json(await eventResults());
});
// Admin preview: the same results, always available to a logged-in admin, so they can be checked before going public.
app.get('/api/admin/results-preview',requireAdmin,async(req,res)=>{
  res.set('Cache-Control','no-store');
  res.json({publicOpen:publicResultsOpen(),events:await eventResults()});
});
// ---------- Relays: teams of four swimmers (legs 1-4) entered by an admin and timed as one team ----------
const isRelayKey=key=>/relay/i.test(parseEventKey(key).event||'');
// Two relay races, each combining Under-12, Under-14 and Under-17: one for boys, one for girls.
const RELAY_EVENT='4×50m Freestyle Relay',RELAY_CATEGORIES=CATEGORIES.filter(c=>c.events.includes(RELAY_EVENT)).map(c=>c.name);
const RELAY_GROUP='Under-'+RELAY_CATEGORIES.map(n=>n.replace(/^Under-/,'')).join('/');
const COMBINED_RELAYS=['Boys','Girls'].map(g=>eventKey(RELAY_GROUP,g,RELAY_EVENT));
const isCombinedRelay=key=>parseEventKey(key).category===RELAY_GROUP;
// Older relay keys (per age group, and a boys-and-girls one) stay valid so any team already saved under one can
// still be seen, timed or deleted; the desk lists them only while they hold a team.
const relayEventKeys=()=>[...COMBINED_RELAYS,eventKey(RELAY_GROUP,'Boys & Girls',RELAY_EVENT),...CATEGORIES.flatMap(c=>['Boys','Girls'].flatMap(g=>c.events.filter(e=>/relay/i.test(e)).map(e=>eventKey(c.name,g,e))))];
async function relayTeams(key){
  const teams=await q(`SELECT id,event_key,team_name,heat_no,lane_no,timing_text,status,updated_at FROM relay_teams ${key?'WHERE event_key=$1':''} ORDER BY event_key,COALESCE(heat_no,999),COALESCE(lane_no,999),id`,key?[key]:[]);
  if(!teams.length)return [];
  const members=await q('SELECT m.team_id,m.leg,r.registration_id,r.full_name,r.school_name,r.events_json FROM relay_members m JOIN registrations r ON r.registration_id=m.registration_id WHERE m.team_id=ANY($1) ORDER BY m.team_id,m.leg',[teams.map(t=>t.id)]);
  return teams.map(t=>({...t,members:members.filter(m=>String(m.team_id)===String(t.id)).map(m=>({leg:m.leg,registration_id:m.registration_id,full_name:m.full_name,school_name:m.school_name,registeredForRelay:registrationEvents(m.events_json).includes(parseEventKey(t.event_key).event)}))}));
}
const relayLabel=key=>{const m=parseEventKey(key);return {event_key:key,category:m.category,gender:m.gender,event:m.event,combined:COMBINED_RELAYS.includes(key),label:CATEGORIES.find(c=>c.name===m.category)?.eventLabels?.[m.event]||m.event}};
app.get('/api/admin/relay-events',requireAdmin,async(req,res)=>{
  const counts=new Map((await q('SELECT event_key,COUNT(*)::int n FROM relay_teams GROUP BY event_key')).map(r=>[r.event_key,r.n]));
  res.json(relayEventKeys().filter(k=>COMBINED_RELAYS.includes(k)||counts.get(k)).map(k=>({...relayLabel(k),teams:counts.get(k)||0})));
});
app.get('/api/admin/relays',requireAdmin,async(req,res)=>{
  const key=String(req.query.eventKey||'');if(!relayEventKeys().includes(key))return res.status(400).json({error:'Choose a relay event.'});
  res.json({event:relayLabel(key),teams:await relayTeams(key)});
});
// Swimmers who can swim this relay: Under-12, 14 and 17 boys for the boys' relay, girls for the girls' relay (an older
// per-age-group key keeps its own age group). Search by name, school or registration ID.
app.get('/api/admin/relay-candidates',requireAdmin,async(req,res)=>{
  const key=String(req.query.eventKey||'');if(!relayEventKeys().includes(key))return res.status(400).json({error:'Choose a relay event.'});
  const {category,gender,event}=parseEventKey(key),term=String(req.query.q||'').trim().slice(0,60),combined=isCombinedRelay(key);
  const rows=await q(`SELECT r.registration_id,r.full_name,r.school_name,r.age_category,r.gender,r.events_json,(SELECT t.team_name FROM relay_members m JOIN relay_teams t ON t.id=m.team_id WHERE m.registration_id=r.registration_id AND t.event_key=$1 LIMIT 1) team
    FROM registrations r WHERE r.age_category=ANY($2) AND ($3::text IS NULL OR r.gender=$3) AND ($4='' OR r.full_name ILIKE '%'||$4||'%' OR r.school_name ILIKE '%'||$4||'%' OR r.registration_id ILIKE '%'||$4||'%')
    ORDER BY r.school_name,r.full_name LIMIT 30`,[key,combined?RELAY_CATEGORIES:[category],['Boys','Girls'].includes(gender)?gender:null,term]);
  res.json(rows.map(r=>({registration_id:r.registration_id,full_name:r.full_name,school_name:r.school_name,category:r.age_category,gender:r.gender,registeredForRelay:registrationEvents(r.events_json).includes(event),team:r.team||null})));
});
// Create or update a team: name, heat/lane (optional) and exactly four different swimmers of the right age group and gender.
app.post('/api/admin/relays',requireAdmin,async(req,res)=>{
  const b=req.body||{},key=String(b.eventKey||''),id=b.id?Number(b.id):null;
  if(!relayEventKeys().includes(key))return res.status(400).json({error:'Choose a relay event.'});
  const teamName=String(b.teamName||'').replace(/\s+/g,' ').trim();
  if(!teamName||teamName.length>80)return res.status(400).json({error:'Enter a team name (up to 80 characters).'});
  const members=Array.isArray(b.members)?b.members.map(String):[];
  if(members.length!==4||new Set(members).size!==4)return res.status(400).json({error:'A relay team needs four different swimmers (legs 1 to 4).'});
  const num=(v,max)=>v===''||v==null?null:(Number.isInteger(Number(v))&&Number(v)>=1&&Number(v)<=max?Number(v):NaN);
  const heat=num(b.heatNo,99),lane=num(b.laneNo,10);
  if(Number.isNaN(heat)||Number.isNaN(lane))return res.status(400).json({error:'Heat must be a whole number from 1, lane from 1 to 10.'});
  const {category,gender}=parseEventKey(key);
  const regs=await q('SELECT registration_id,full_name,age_category,gender FROM registrations WHERE registration_id=ANY($1)',[members]);
  if(regs.length!==4)return res.status(400).json({error:'One of the swimmers was not found.'});
  const ages=isCombinedRelay(key)?RELAY_CATEGORIES:[category],anyGender=!['Boys','Girls'].includes(gender);
  const wrong=regs.find(r=>!ages.includes(r.age_category)||(!anyGender&&r.gender!==gender));
  if(wrong)return res.status(400).json({error:`${wrong.full_name} is ${wrong.age_category} ${wrong.gender}; this relay is for ${ages.join(', ')} ${anyGender?'swimmers':gender.toLowerCase()}.`});
  const taken=await q('SELECT r.full_name,t.team_name FROM relay_members m JOIN relay_teams t ON t.id=m.team_id JOIN registrations r ON r.registration_id=m.registration_id WHERE t.event_key=$1 AND m.registration_id=ANY($2) AND ($3::bigint IS NULL OR t.id<>$3)',[key,members,id]);
  if(taken.length)return res.status(409).json({error:`${taken[0].full_name} is already in ${taken[0].team_name}.`});
  if(id&&!(await q('SELECT 1 FROM relay_teams WHERE id=$1 AND event_key=$2',[id,key])).length)return res.status(404).json({error:'Team not found.'});
  const teamId=await withTransaction(async c=>{
    let tid=id;
    if(tid)await c.query('UPDATE relay_teams SET team_name=$2,heat_no=$3,lane_no=$4,updated_by=$5,updated_at=NOW() WHERE id=$1',[tid,teamName,heat,lane,req.session.operator||'Admin']);
    else tid=(await c.query('INSERT INTO relay_teams(event_key,team_name,heat_no,lane_no,updated_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[key,teamName,heat,lane,req.session.operator||'Admin'])).rows[0].id;
    await c.query('DELETE FROM relay_members WHERE team_id=$1',[tid]);
    for(const [i,rid] of members.entries())await c.query('INSERT INTO relay_members(team_id,leg,registration_id) VALUES($1,$2,$3)',[tid,i+1,rid]);
    return tid;
  });
  await audit(id?'UPDATE_RELAY_TEAM':'CREATE_RELAY_TEAM','relay',key,{teamId:String(teamId),teamName,members,heat,lane},req.session.operator);
  res.json({ok:true,id:String(teamId)});
});
app.post('/api/admin/relays/:id/timing',requireAdmin,async(req,res)=>{
  const b=req.body||{},typed=String(b.timingText||'').trim();
  // A time typed while the status still says PENDING is a finished swim.
  const status=!b.status||(b.status==='PENDING'&&typed)?'TIME':b.status;
  if(!['TIME','DNS','DQ','PENDING'].includes(status))return res.status(400).json({error:'Status must be TIME, DNS, DQ or PENDING.'});
  if(status==='TIME'&&String(b.timingText||'').trim()&&timingSeconds(b.timingText)==null)return res.status(400).json({error:`"${String(b.timingText).slice(0,20)}" is not a time — type it like 02:36.42`});
  // Heat and lane can be set or corrected from the team card along with the time (left out = unchanged).
  const num=(v,max)=>v===''||v==null?null:(Number.isInteger(Number(v))&&Number(v)>=1&&Number(v)<=max?Number(v):NaN);
  const heat=num(b.heatNo,99),lane=num(b.laneNo,10);
  if(Number.isNaN(heat)||Number.isNaN(lane))return res.status(400).json({error:'Heat must be a whole number from 1, lane from 1 to 10.'});
  const r=await q('UPDATE relay_teams SET timing_text=$2,status=$3,updated_by=$4,updated_at=NOW(),heat_no=CASE WHEN $5 THEN $6::int ELSE heat_no END,lane_no=CASE WHEN $7 THEN $8::int ELSE lane_no END WHERE id=$1 RETURNING event_key,team_name',[Number(req.params.id)||0,String(b.timingText||'').trim()||null,status,req.session.operator||'Admin','heatNo' in b,heat,'laneNo' in b,lane]);
  if(!r.length)return res.status(404).json({error:'Team not found.'});
  await audit('SAVE_RELAY_TIMING','relay',r[0].event_key,{teamId:req.params.id,team:r[0].team_name,timingText:b.timingText,status,heat:b.heatNo,lane:b.laneNo},req.session.operator);
  res.json({ok:true});
});
app.delete('/api/admin/relays/:id',requireAdmin,async(req,res)=>{
  const r=await q('DELETE FROM relay_teams WHERE id=$1 RETURNING event_key,team_name',[Number(req.params.id)||0]);
  if(!r.length)return res.status(404).json({error:'Team not found.'});
  await audit('DELETE_RELAY_TEAM','relay',r[0].event_key,{teamId:req.params.id,team:r[0].team_name},req.session.operator);
  res.json({ok:true});
});

async function eventResults({withIds=false}={}){
  // Built from the heat list: every swimmer placed in a heat is listed (with heat and lane), plus any timed swimmer not in it.
  const timings=await q(`SELECT COALESCE(he.event_key,te.event_key) event_key,COALESCE(he.heat_no,te.heat_no) heat_no,he.lane_no,te.timing_text,te.status,r.registration_id,r.full_name,r.school_name
    FROM race_entries he FULL JOIN (SELECT * FROM timing_entries WHERE status IN ('TIME','DNS','DQ')) te ON te.event_key=he.event_key AND te.registration_id=he.registration_id
    JOIN registrations r ON r.registration_id=COALESCE(he.registration_id,te.registration_id) ORDER BY 2,3`);
  const podium=await q(`SELECT re.event_key,re.position,r.registration_id,r.full_name,r.school_name FROM result_entries re JOIN registrations r ON r.registration_id=re.registration_id JOIN event_publication ep ON ep.event_key=re.event_key AND ep.published=TRUE ORDER BY re.event_key,re.position`);
  const published=new Set((await q('SELECT event_key FROM event_publication WHERE published=TRUE')).map(r=>r.event_key));
  const order=new Map();let n=0;for(const c of CATEGORIES)for(const gender of ['Boys','Girls'])for(const event of c.events)order.set(eventKey(c.name,gender,event),n++);
  const events=new Map(),eventFor=key=>{if(!events.has(key)){const meta=parseEventKey(key);events.set(key,{event_key:key,meta:{...meta,label:CATEGORIES.find(c=>c.name===meta.category)?.eventLabels?.[meta.event]||meta.event},order:order.get(key)??9999,published:published.has(key),official:[],standings:[],notFinished:[],awaiting:[]})}return events.get(key)};
  const timeOf=new Map(timings.map(t=>[`${t.event_key}|${t.registration_id}`,t.timing_text]));
  for(const t of timings){
    if(isRelayKey(t.event_key))continue;   // relay events are ranked by team (below), not by individual swimmers
    const e=eventFor(t.event_key),secs=t.status==='TIME'?timingSeconds(t.timing_text):null,swimmer={registration_id:t.registration_id,full_name:t.full_name,school_name:t.school_name,heat_no:t.heat_no,lane_no:t.lane_no};
    if(secs!=null)e.standings.push({...swimmer,timing_text:t.timing_text,seconds:secs});else if(t.status==='DNS'||t.status==='DQ')e.notFinished.push({...swimmer,status:t.status});else e.awaiting.push(swimmer);
  }
  // Relay teams: ranked by the team's time; every member shares the team's place.
  for(const t of await relayTeams()){
    const e=eventFor(t.event_key),names=t.members.map(m=>m.full_name),secs=t.status==='TIME'?timingSeconds(t.timing_text):null;
    const team={registration_ids:t.members.map(m=>m.registration_id),full_name:t.team_name,school_name:names.join(' · '),members:names,heat_no:t.heat_no,lane_no:t.lane_no,relay:true};
    if(secs!=null)e.standings.push({...team,timing_text:t.timing_text,seconds:secs});else if(t.status==='DNS'||t.status==='DQ')e.notFinished.push({...team,status:t.status});else e.awaiting.push(team);
  }
  for(const e of events.values()){e.standings.sort((a,b)=>a.seconds-b.seconds);e.standings.forEach((s,i)=>{s.rank=i&&s.seconds===e.standings[i-1].seconds?e.standings[i-1].rank:i+1});for(const s of e.standings)delete s.seconds}
  for(const p of podium)if(!isRelayKey(p.event_key))eventFor(p.event_key).official.push({registration_id:p.registration_id,position:p.position,full_name:p.full_name,school_name:p.school_name,timing_text:timeOf.get(`${p.event_key}|${p.registration_id}`)||null});
  const list=[...events.values()].filter(e=>e.standings.length||e.official.length||e.notFinished.length||e.awaiting.length).sort((a,b)=>a.order-b.order);
  if(!withIds)for(const e of list)for(const group of [e.official,e.standings,e.notFinished,e.awaiting])for(const x of group){delete x.registration_id;delete x.registration_ids}
  return list;
}
// Medal positions (1st–3rd) per registration, decided exactly as the Results page shows them: the official podium once
// an event is published from the Results desk, otherwise the live standings across all heats (tied times share a place).
async function medalsByRegistration(){
  const medals=new Map(),add=(id,e,position,time)=>{if(!medals.has(id))medals.set(id,[]);medals.get(id).push({eventKey:e.event_key,event:e.meta.label,category:e.meta.category,position,time:time||null,relay:isRelayKey(e.event_key)})};
  for(const e of await eventResults({withIds:true})){
    if(e.published&&e.official.length)for(const p of e.official){if(p.position>=1&&p.position<=3)add(p.registration_id,e,p.position,p.timing_text)}
    else for(const st of e.standings)if(st.rank<=3)for(const id of st.registration_ids||[st.registration_id])add(id,e,st.rank,st.timing_text);
  }
  return medals;
}
// Best swimmers: individual champions per age group and gender, from the same medal placings as Results.
// Points: 1st = 5, 2nd = 3, 3rd = 2; ties on points go to more golds, then more silvers; still level = shared rank.
const MEDAL_POINTS={1:5,2:3,3:2};
async function bestSwimmers({withIds=false}={}){
  // Individual championship: relay medals are team results and do not count here.
  const medals=new Map([...(await medalsByRegistration())].map(([id,l])=>[id,l.filter(m=>!m.relay)]).filter(([,l])=>l.length));if(!medals.size)return [];
  const regs=await q('SELECT registration_id,full_name,school_name,age_category,gender,(participant_photo IS NOT NULL AND length(participant_photo)>0) has_photo FROM registrations WHERE registration_id=ANY($1)',[[...medals.keys()]]);
  const groups=new Map(),order=new Map();let n=0;for(const c of CATEGORIES)for(const g of ['Boys','Girls'])order.set(`${c.name}|${g}`,n++);
  for(const r of regs){
    const list=medals.get(r.registration_id),count=p=>list.filter(m=>m.position===p).length;
    const swimmer={registration_id:r.registration_id,has_photo:r.has_photo,full_name:r.full_name,school_name:r.school_name,gold:count(1),silver:count(2),bronze:count(3),points:list.reduce((t,m)=>t+(MEDAL_POINTS[m.position]||0),0),
      medals:list.map(m=>({event:m.event,position:m.position,time:m.time})).sort((a,b)=>a.position-b.position||a.event.localeCompare(b.event))};
    const key=`${r.age_category}|${r.gender}`;if(!groups.has(key))groups.set(key,{category:r.age_category,gender:r.gender,order:order.get(key)??9999,swimmers:[]});groups.get(key).swimmers.push(swimmer);
  }
  const cmp=(a,b)=>b.points-a.points||b.gold-a.gold||b.silver-a.silver;
  for(const g of groups.values()){g.swimmers.sort((a,b)=>cmp(a,b)||a.full_name.localeCompare(b.full_name));g.swimmers.forEach((s,i)=>{s.rank=i&&!cmp(s,g.swimmers[i-1])?g.swimmers[i-1].rank:i+1})}
  // Champions (rank 1) show their registration photo through an unguessable link; nothing else about the photo is public.
  for(const g of groups.values())for(const sw of g.swimmers){if(sw.rank===1&&sw.has_photo)sw.photo=`/api/public/champion-photo/${championPhotoRef(sw.registration_id)}`;delete sw.has_photo;if(!withIds)delete sw.registration_id}
  return [...groups.values()].sort((a,b)=>a.order-b.order);
}
const championPhotoRef=id=>crypto.createHmac('sha256',String(process.env.SESSION_SECRET||'bsf-champion-photo')).update('champion-photo:'+id).digest('hex').slice(0,32);
app.get('/api/public/champion-photo/:ref',async(req,res)=>{
  if(!publicResultsOpen()&&!req.session?.admin)return res.status(404).end();
  const champ=(await bestSwimmers({withIds:true})).flatMap(g=>g.swimmers).find(s=>s.rank===1&&s.photo&&championPhotoRef(s.registration_id)===req.params.ref);
  if(!champ)return res.status(404).end();
  const r=(await q('SELECT participant_photo data,participant_photo_mime mime FROM registrations WHERE registration_id=$1',[champ.registration_id]))[0];
  if(!r?.data?.length||typeof r.mime!=='string'||!/^image\/[a-z0-9.+-]+$/i.test(r.mime))return res.status(404).end();
  res.set({'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});
  res.type(r.mime).send(Buffer.from(r.data));
});
app.get('/api/public/best-swimmers',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!publicResultsOpen()&&!req.session?.admin)return res.json({closed:true});
  res.json(await bestSwimmers());
});
// Merit certificates are offered only while results are public and certificates are available.
const meritAvailable=()=>certificatesAvailable()&&publicResultsOpen();
const meritList=(token,list=[])=>meritAvailable()?list.map(m=>({event:m.event,category:m.category,position:m.position,positionLabel:ordinal(m.position),url:`/api/merit-certificate/${encodeURIComponent(token)}?event=${encodeURIComponent(m.eventKey)}`})):[];
app.get('/api/merit-certificate/:token',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const r=(await q('SELECT registration_id,full_name,school_name,age_category FROM registrations WHERE ticket_token=$1',[req.params.token]))[0];
  if(!r)return res.status(404).json({error:'Certificate not found. Please use the link from your ticket.'});
  if(!meritAvailable())return res.status(403).json({error:'Merit certificates are not available yet.',code:'MERIT_NOT_YET_AVAILABLE'});
  const medal=((await medalsByRegistration()).get(r.registration_id)||[]).find(m=>m.eventKey===req.query.event);
  if(!medal)return res.status(404).json({error:'Merit certificates are for 1st, 2nd and 3rd place in an event.',code:'NO_MEDAL'});
  const pdf=await meritCertificatePdf({fullName:r.full_name,schoolName:r.school_name,category:medal.category,event:medal.event,position:medal.position,registrationId:r.registration_id});
  const slug=v=>String(v).replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'');
  res.set('Content-Type','application/pdf');res.set('Content-Disposition',`attachment; filename="BSF-Merit-Certificate-${slug(r.full_name)||r.registration_id}-${slug(medal.event)}-${ordinal(medal.position)}.pdf"`);
  res.send(pdf);
});

// Live timings: every saved time is public straight away; events not yet published from the Results desk are marked provisional.
app.get('/api/public/timings',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!publicTimingsOpen())return res.json({closed:true});
  const rows=await q(`SELECT te.event_key,te.heat_no,te.timing_text,te.status,te.updated_at,r.full_name,r.school_name,re.lane_no,COALESCE(ep.published,FALSE) published
    FROM timing_entries te JOIN registrations r ON r.registration_id=te.registration_id
    LEFT JOIN race_entries re ON re.event_key=te.event_key AND re.registration_id=te.registration_id
    LEFT JOIN event_publication ep ON ep.event_key=te.event_key
    WHERE te.status<>'PENDING' AND (te.status<>'TIME' OR COALESCE(te.timing_text,'')<>'')`);
  const order=new Map();let n=0;
  for(const c of CATEGORIES)for(const gender of ['Boys','Girls'])for(const event of c.events)order.set(eventKey(c.name,gender,event),n++);
  const label=meta=>CATEGORIES.find(c=>c.name===meta.category)?.eventLabels?.[meta.event]||meta.event;
  const teams=(await relayTeams()).filter(t=>t.status!=='PENDING'&&(t.status!=='TIME'||String(t.timing_text||'')!==''));
  const all=[...rows.filter(x=>!isRelayKey(x.event_key)),...teams.map(t=>({event_key:t.event_key,heat_no:t.heat_no||1,lane_no:t.lane_no,timing_text:t.timing_text,status:t.status,full_name:t.team_name,school_name:t.members.map(m=>m.full_name).join(' · '),published:false,updated_at:t.updated_at}))];
  res.json(all.map(x=>{const meta=parseEventKey(x.event_key);return {event_key:x.event_key,heat_no:x.heat_no,lane_no:x.lane_no,timing_text:x.timing_text,status:x.status,full_name:x.full_name,school_name:x.school_name,published:x.published,updated_at:x.updated_at,order:order.get(x.event_key)??9999,meta:{...meta,label:label(meta)}}}));
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
  if((b.status||'TIME')==='TIME'&&String(b.timingText||'').trim()&&timingSeconds(b.timingText)==null)return res.status(400).json({error:`"${String(b.timingText).slice(0,20)}" is not a time — type it like 00:36.42 or 36.42`});
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
    const slots=assignHeats(regs.length,lanes);
    for(let i=0;i<regs.length;i++)await c.query('INSERT INTO race_entries(event_key,heat_no,lane_no,registration_id) VALUES($1,$2,$3,$4)',[ek,slots[i].heatNo,slots[i].laneNo,regs[i].registration_id]);
  });
  await audit('SEED_HEATS','event',ek,{participants:regs.length,lanes},req.session.operator);
  res.json({ok:true,participants:regs.length,heats:heatSizes(regs.length,lanes).length,heatSizes:heatSizes(regs.length,lanes)});
});

// Heat builder on the Timings desk: the event's swimmers with payment/check-in status and any saved heat/lane.
app.get('/api/admin/heat-builder',requireAdmin,async(req,res)=>{
  const ek=req.query.eventKey;
  if(!validEventKey(ek))return res.status(400).json({error:'Select a valid event first.'});
  const {category,gender,event}=parseEventKey(ek);
  const rows=(await q(`SELECT r.registration_id,r.full_name,r.school_name,r.payment_status,r.checkin_status,r.events_json,re.heat_no,re.lane_no FROM registrations r LEFT JOIN race_entries re ON re.registration_id=r.registration_id AND re.event_key=$3 WHERE r.age_category=$1 AND r.gender=$2 ORDER BY r.created_at,r.full_name`,[category,gender,ek])).filter(r=>registrationEvents(r.events_json).includes(event));
  res.json({swimmers:rows.map(r=>({registrationId:r.registration_id,fullName:r.full_name,schoolName:r.school_name,paymentStatus:r.payment_status,checkinStatus:r.checkin_status,heatNo:r.heat_no,laneNo:r.lane_no}))});
});

// Saves heats arranged on the Timings desk, replacing the event's existing assignments. Invalid plans save nothing.
app.post('/api/admin/save-heats',requireAdmin,async(req,res)=>{
  const ek=req.body?.eventKey;
  if(!validEventKey(ek))return res.status(400).json({error:'Select a valid event first.'});
  const {category,gender,event}=parseEventKey(ek);
  const eventRegistrations=(await q('SELECT registration_id,full_name,school_name,events_json FROM registrations WHERE age_category=$1 AND gender=$2 ORDER BY created_at,full_name',[category,gender])).filter(r=>registrationEvents(r.events_json).includes(event));
  const plan=planHeats(req.body.entries,{eventRegistrations});
  if(plan.errors.length)return res.status(400).json({error:'These heats have problems: '+plan.errors.join(' '),errors:plan.errors});
  await withTransaction(async c=>{
    await c.query('DELETE FROM race_entries WHERE event_key=$1',[ek]);
    for(const e of plan.entries)await c.query('INSERT INTO race_entries(event_key,heat_no,lane_no,registration_id) VALUES($1,$2,$3,$4)',[ek,e.heat_no,e.lane_no,e.reg.registration_id]);
  });
  const heats=new Set(plan.entries.map(e=>e.heat_no)).size;
  await audit('SAVE_HEATS','event',ek,{participants:plan.entries.length,heats,notPlaced:plan.missing.map(m=>m.registration_id)},req.session.operator);
  res.json({ok:true,participants:plan.entries.length,heats,notPlaced:plan.missing.length});
});

app.get('/api/admin/race-card',requireAdmin,async(req,res)=>{
  const ek=req.query.eventKey,heat=Number(req.query.heatNo||1);
  const rows=await q(`SELECT re.heat_no,re.lane_no,r.registration_id,r.full_name,r.school_name,te.timing_text,te.status,te.updated_at FROM race_entries re JOIN registrations r ON r.registration_id=re.registration_id LEFT JOIN timing_entries te ON te.event_key=re.event_key AND te.heat_no=re.heat_no AND te.registration_id=re.registration_id WHERE re.event_key=$1 AND re.heat_no=$2 ORDER BY re.lane_no`,[ek,heat]);
  const hc=(await q('SELECT COALESCE(MAX(heat_no),0)::int c FROM race_entries WHERE event_key=$1',[ek]))[0];
  res.json({rows,heatCount:hc.c});
});

// Every event that has swimmers, in programme order (category order, Boys then Girls, events in category order),
// with its registered swimmers in registration order.
async function eventsInProgrammeOrder(){
  const regs=await q('SELECT registration_id,full_name,school_name,gender,age_category,events_json FROM registrations ORDER BY created_at,full_name');
  const list=[];
  for(const c of CATEGORIES)for(const gender of ['Boys','Girls'])for(const event of c.events){
    const swimmers=regs.filter(r=>r.age_category===c.name&&r.gender===gender&&registrationEvents(r.events_json).includes(event));
    if(swimmers.length)list.push({key:eventKey(c.name,gender,event),title:`${c.name} • ${gender} • ${c.eventLabels?.[event]||event}`,swimmers});
  }
  return list;
}

// Arrange heats for every event at once (same rule as Create / Reset Heats). Events that already have heats are kept unless replaceExisting.
app.post('/api/admin/seed-all-heats',requireAdmin,async(req,res)=>{
  const lanes=Number(req.body?.lanes||6),replaceExisting=req.body?.replaceExisting===true;
  if(!Number.isInteger(lanes)||lanes<1||lanes>10)return res.status(400).json({error:'Lanes per heat must be from 1 to 10.'});
  const events=await eventsInProgrammeOrder(),existing=new Set((await q('SELECT DISTINCT event_key FROM race_entries')).map(r=>r.event_key));
  const created=[],skipped=[];
  await withTransaction(async c=>{
    for(const e of events){
      if(existing.has(e.key)&&!replaceExisting){skipped.push(e.title);continue}
      await c.query('DELETE FROM race_entries WHERE event_key=$1',[e.key]);
      const slots=assignHeats(e.swimmers.length,lanes);
      for(let i=0;i<e.swimmers.length;i++)await c.query('INSERT INTO race_entries(event_key,heat_no,lane_no,registration_id) VALUES($1,$2,$3,$4)',[e.key,slots[i].heatNo,slots[i].laneNo,e.swimmers[i].registration_id]);
      created.push({event:e.title,swimmers:e.swimmers.length,heatSizes:heatSizes(e.swimmers.length,lanes)});
    }
  });
  await audit('SEED_ALL_HEATS','event',null,{lanes,replaceExisting,created:created.length,skipped:skipped.length},req.session.operator);
  res.json({ok:true,created,skipped});
});

// One Word file with the full heat list for every event.
app.get('/api/admin/heat-list.docx',requireAdmin,async(req,res)=>{
  const events=await eventsInProgrammeOrder();
  if(!events.length)return res.status(404).json({error:'No registrations yet.'});
  const entries=await q('SELECT re.event_key,re.heat_no,re.lane_no,r.registration_id,r.full_name,r.school_name FROM race_entries re JOIN registrations r ON r.registration_id=re.registration_id ORDER BY re.event_key,re.heat_no,re.lane_no');
  const printedAt=new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const list=events.map(e=>{
    const rows=entries.filter(r=>r.event_key===e.key),placed=new Set(rows.map(r=>r.registration_id));
    return {eventTitle:e.title,heats:rows.length?buildHeatSheet(rows,e.title,printedAt).heats:[],
      notPlaced:e.swimmers.filter(s=>!placed.has(s.registration_id)).map(s=>({fullName:s.full_name,schoolName:s.school_name,registrationId:s.registration_id}))};
  });
  res.set('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.set('Content-Disposition',`attachment; filename="bsf-full-heat-list-${new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})}.docx"`);
  res.send(await heatListDocx(list,printedAt));
});

// Printable heat sheets (PDF or Word), one page per heat with blank Time columns for timekeepers.
app.get('/api/admin/heat-sheet',requireAdmin,async(req,res)=>{
  const ek=req.query.eventKey,format=req.query.format;
  if(!validEventKey(ek))return res.status(400).json({error:'Select a valid event first.'});
  if(!['pdf','docx'].includes(format))return res.status(400).json({error:'Choose PDF or Word format.'});
  const rows=await q('SELECT re.heat_no,re.lane_no,r.registration_id,r.full_name,r.school_name FROM race_entries re JOIN registrations r ON r.registration_id=re.registration_id WHERE re.event_key=$1 ORDER BY re.heat_no,re.lane_no',[ek]);
  if(!rows.length)return res.status(404).json({error:'No heats are saved for this event yet. Build and save heats first.'});
  const {category,gender,event}=parseEventKey(ek),label=CATEGORIES.find(c=>c.name===category)?.eventLabels?.[event]||event;
  const printedAt=new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const sheet=buildHeatSheet(rows,`${category} • ${gender} • ${label}`,printedAt);
  const file=`heat-sheet-${[category,gender,event].join('-').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'')}.${format}`;
  res.set('Content-Type',format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.set('Content-Disposition',`attachment; filename="${file}"`);
  res.send(format==='pdf'?await heatSheetPdf(sheet):await heatSheetDocx(sheet));
});

// Shared by the paged dashboard list and the CSV download so both always match the same filters.
const registrationFilterKeys=['search','category','gender','event','paymentStatus','checkinStatus'];
async function filteredRegistrations(filters){
  const clauses=[],values=[];
  for(const [key,column] of [['category','age_category'],['gender','gender'],['paymentStatus','payment_status'],['checkinStatus','checkin_status']]){
    if(filters[key]){values.push(filters[key]);clauses.push(`${column}=$${values.length}`)}
  }
  if(filters.search?.trim()){
    values.push(filters.search.trim());
    clauses.push(`strpos(lower(concat_ws(' ',registration_id,full_name,school_name,phone)),lower($${values.length}))>0`);
  }
  return (await q(`SELECT ${registrationColumns} FROM registrations ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY created_at DESC,registration_id`,values)).map(registrationRow).filter(r=>!filters.event||r.events_json.includes(filters.event));
}
function invalidRegistrationFilters(filters,allowed){
  if(Object.keys(filters).some(key=>!allowed.includes(key)))return 'Unknown registration filter.';
  if(allowed.some(key=>filters[key]!==undefined&&typeof filters[key]!=='string'))return 'Invalid registration filter.';
}
app.get('/api/admin/registrations',requireAdmin,async(req,res)=>{
  const filters=req.query,invalid=invalidRegistrationFilters(filters,[...registrationFilterKeys,'page','limit']);
  if(invalid)return res.status(400).json({error:invalid});
  const page=Number(filters.page||1),limit=Number(filters.limit||50);
  if(!Number.isSafeInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100)return res.status(400).json({error:'Invalid page or limit.'});
  const rows=await filteredRegistrations(filters);
  res.json({rows:rows.slice((page-1)*limit,page*limit),total:rows.length,page,limit});
});

// Spreadsheet export of the filtered list (e.g. one category/gender/event) for building heats.
const csvCell=value=>{
  let cell=String(value??'');
  if(/^[=+\-@\t\r]/.test(cell))cell="'"+cell; // keep spreadsheet apps from running cell text as a formula
  return /[",\r\n]/.test(cell)?`"${cell.replaceAll('"','""')}"`:cell;
};
// Schools taking part. Names are typed by parents, so spellings that differ only in case, spacing or
// punctuation ("St. Xavier's" / "st xaviers") count as one school, shown with its most-used spelling.
const schoolKey=name=>String(name||'').toLowerCase().replace(/['’`]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\bschool\b|\bthe\b/g,' ').replace(/\s+/g,' ').trim();
async function schoolSummary(){
  const rows=await q("SELECT school_name,COUNT(*)::int participants,COUNT(*) FILTER(WHERE checkin_status='Approved')::int checked_in FROM registrations GROUP BY school_name");
  const groups=new Map();
  for(const r of rows){
    const key=schoolKey(r.school_name)||String(r.school_name||'').trim().toLowerCase();
    if(!groups.has(key))groups.set(key,{participants:0,checkedIn:0,spellings:[]});
    const g=groups.get(key);g.participants+=r.participants;g.checkedIn+=r.checked_in;const name=String(r.school_name||'').replace(/\s+/g,' ').trim(),old=g.spellings.find(x=>x.name===name);if(old)old.n+=r.participants;else g.spellings.push({name,n:r.participants});
  }
  const schools=[...groups.values()].map(g=>{const plain=x=>x===x.toUpperCase()||x===x.toLowerCase()?1:0;g.spellings.sort((a,b)=>b.n-a.n||plain(a.name)-plain(b.name)||a.name.localeCompare(b.name));return {name:g.spellings[0].name,participants:g.participants,checkedIn:g.checkedIn,otherSpellings:g.spellings.slice(1).map(s=>s.name)}})
    .sort((a,b)=>b.participants-a.participants||a.name.localeCompare(b.name));
  return {count:schools.length,participants:schools.reduce((n,s)=>n+s.participants,0),schools};
}
app.get('/api/admin/schools',requireAdmin,async(req,res)=>res.json(await schoolSummary()));
// Every merit certificate (1st, 2nd, 3rd) in one printable PDF for the admin. Ordered school by school (so each
// school's pile prints together) or by event (?sort=event). ?school=<name> prints one school only.
app.get('/api/admin/merit-certificates.pdf',requireAdmin,async(req,res)=>{
  const sort=req.query.sort==='event'?'event':'school',onlySchool=req.query.school?schoolKey(req.query.school):null;
  const medals=await medalsByRegistration();
  const regs=medals.size?await q('SELECT registration_id,full_name,school_name FROM registrations WHERE registration_id=ANY($1)',[[...medals.keys()]]):[];
  const order=new Map();let n=0;for(const c of CATEGORIES)for(const g of ['Boys','Girls'])for(const ev of c.events)order.set(eventKey(c.name,g,ev),n++);
  let list=regs.flatMap(r=>medals.get(r.registration_id).map(m=>({fullName:r.full_name,schoolName:String(r.school_name||'').trim(),school:schoolKey(r.school_name),category:m.category,event:m.event,position:m.position,order:order.get(m.eventKey)??9999})));
  if(onlySchool)list=list.filter(c=>c.school===onlySchool);
  const byEvent=(a,b)=>a.order-b.order||a.position-b.position||a.fullName.localeCompare(b.fullName);
  list.sort(sort==='school'?(a,b)=>a.school.localeCompare(b.school)||byEvent(a,b):byEvent);
  if(!list.length)return res.status(404).json({error:'No merit certificates yet: no swimmer has a 1st, 2nd or 3rd place.'});
  const pdf=await meritCertificatesBook(list,{title:`Merit Certificates — ${list.length} certificates`});
  await audit('export','merit-certificates',null,{count:list.length,sort,school:req.query.school||null},req.session.operator);
  const stamp=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  res.set('Content-Type','application/pdf');res.set('Content-Disposition',`attachment; filename="bsf-merit-certificates-by-${sort}-${stamp}.pdf"`);
  res.set('X-Certificate-Count',String(list.length));
  res.send(pdf);
});
app.get('/api/admin/schools.csv',requireAdmin,async(req,res)=>{
  const {schools}=await schoolSummary();
  const lines=[['Sr No','School','Participants','Checked in','Other spellings'],...schools.map((s,i)=>[i+1,s.name,s.participants,s.checkedIn,s.otherSpellings.join('; ')])].map(line=>line.map(csvCell).join(','));
  await audit('export','schools',null,{count:schools.length},req.session.operator);
  res.set('Content-Type','text/csv; charset=utf-8');
  res.set('Content-Disposition',`attachment; filename="bsf-schools-${new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})}.csv"`);
  res.send('﻿'+lines.join('\r\n')+'\r\n');
});
app.get('/api/admin/registrations.csv',requireAdmin,async(req,res)=>{
  const filters=req.query,invalid=invalidRegistrationFilters(filters,registrationFilterKeys);
  if(invalid)return res.status(400).json({error:invalid});
  const rows=await filteredRegistrations(filters);
  const header=['Sr No','Registration ID','Participant','School','Gender','DOB','Age category','Events','Contact','Payment status','Check-in status'];
  const lines=[header,...rows.map((r,i)=>[i+1,r.registration_id,r.full_name,r.school_name,r.gender,r.dob,r.age_category,r.events_json.join('; '),r.phone,r.payment_status,r.checkin_status])].map(line=>line.map(csvCell).join(','));
  const label=[filters.category,filters.gender,filters.event,filters.paymentStatus,filters.checkinStatus==='Approved'?'Checked-in':filters.checkinStatus].filter(Boolean).join('-').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'')||'all';
  const stamp=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  await audit('export','registrations',null,{filters:Object.fromEntries(registrationFilterKeys.filter(k=>filters[k]).map(k=>[k,filters[k]])),count:rows.length},req.session.operator);
  res.set('Content-Type','text/csv; charset=utf-8');
  res.set('Content-Disposition',`attachment; filename="bsf-registrations-${label}-${stamp}.csv"`);
  res.send('\uFEFF'+lines.join('\r\n')+'\r\n');
});

app.get('/api/admin/registrations/:registrationId',requireAdmin,async(req,res)=>{
  const row=(await q(`SELECT ${registrationColumns},ticket_token FROM registrations WHERE registration_id=$1`,[req.params.registrationId]))[0];
  if(!row)return res.status(404).json({error:'Registration not found'});
  const registration=registrationRow(row);
  const ticketUrl=row.ticket_token?`/success.html?token=${encodeURIComponent(row.ticket_token)}`:null;
  const qrDataUrl=row.ticket_token?await QRCode.toDataURL(`${BASE_URL}/admin/checkin.html?token=${encodeURIComponent(row.ticket_token)}`,{margin:1,width:360}):null;
  res.json({...registration,ticketUrl,qrDataUrl});
});

// Admin manual entry: add a swimmer from the dashboard (phone/email/photo/payment screenshot optional). Category and fee
// follow the DOB; if heats already exist for an event the swimmer gets the first free lane of the last heat.
async function placeInExistingHeats(cdb,key,registrationId){
  const rows=(await cdb.query('SELECT heat_no,lane_no FROM race_entries WHERE event_key=$1',[key])).rows;
  if(!rows.length)return null;
  const lanes=Math.max(...rows.map(r=>r.lane_no)),lastHeat=Math.max(...rows.map(r=>r.heat_no)),used=new Set(rows.filter(r=>r.heat_no===lastHeat).map(r=>r.lane_no));
  let heatNo=lastHeat,laneNo=Array.from({length:lanes},(_,i)=>i+1).find(l=>!used.has(l));
  if(!laneNo){heatNo=lastHeat+1;laneNo=1}
  await cdb.query('INSERT INTO race_entries(event_key,heat_no,lane_no,registration_id) VALUES($1,$2,$3,$4)',[key,heatNo,laneNo,registrationId]);
  return {heatNo,laneNo};
}
app.post('/api/admin/registrations',requireAdmin,upload.fields([{name:'participantPhoto',maxCount:1},{name:'paymentProof',maxCount:1}]),async(req,res)=>{
  const b=req.body||{},clean=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
  const fullName=clean(b.fullName),schoolName=clean(b.schoolName),phone=clean(b.phone),email=clean(b.email),note=clean(b.paymentNote);
  if(!fullName||!schoolName)return res.status(400).json({error:'Participant name and school are required.'});
  if(fullName.length>120||schoolName.length>120||note.length>120)return res.status(400).json({error:'Name, school and payment note must be 120 characters or fewer.'});
  if(!['Boys','Girls'].includes(b.gender))return res.status(400).json({error:'Choose Boys or Girls.'});
  const date=new Date(b.dob);
  if(typeof b.dob!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.dob)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==b.dob||date>new Date())return res.status(400).json({error:'Enter a valid date of birth.'});
  const c=categoryForDob(b.dob);
  if(!c)return res.status(400).json({error:'This date of birth is not eligible for any age category.'});
  let events;try{events=JSON.parse(b.events||'[]')}catch{events=null}
  if(!Array.isArray(events)||!events.length||events.some(e=>typeof e!=='string'||!c.events.includes(e))||new Set(events).size!==events.length)return res.status(400).json({error:`Choose at least one ${c.name} event.`});
  const individuals=events.filter(e=>e!=='4×50m Freestyle Relay'),relay=events.includes('4×50m Freestyle Relay');
  if(individuals.length>4)return res.status(400).json({error:'Maximum 4 individual events allowed.'});
  if(phone&&phone.replace(/\D/g,'').length<10)return res.status(400).json({error:'Enter a 10-digit phone number or leave it empty.'});
  if(email&&(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))return res.status(400).json({error:'Enter a valid email or leave it empty.'});
  const paymentStatus=b.paymentStatus==='Verified'?'Verified':'Pending';
  const photo=req.files?.participantPhoto?.[0],proof=req.files?.paymentProof?.[0];
  if(b.allowDuplicate!=='true'){
    const existing=(await q('SELECT registration_id FROM registrations WHERE lower(full_name)=lower($1) AND dob=$2',[fullName,b.dob]))[0];
    if(existing)return res.status(409).json({code:'POSSIBLE_DUPLICATE',registrationId:existing.registration_id,error:`${fullName} (born ${b.dob}) is already registered as ${existing.registration_id}.`});
  }
  const amount=individuals.length*300+(relay?800:0),registrationId=`BSF26-${Date.now().toString().slice(-7)}-${Math.floor(100+Math.random()*900)}`,ticketToken=uuidv4();
  const placements=[];
  await withTransaction(async cdb=>{
    await cdb.query(`INSERT INTO registrations(registration_id,ticket_token,idempotency_key,full_name,school_name,gender,dob,age_category,phone,email,events_json,amount,
      participant_photo,participant_photo_mime,payment_proof,payment_proof_mime,payment_utr,payment_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18)`,
      [registrationId,ticketToken,'admin-'+uuidv4(),fullName,schoolName,b.gender,b.dob,c.name,phone,email||null,JSON.stringify(events),amount,photo?.buffer||null,photo?.mimetype||null,proof?.buffer||null,proof?.mimetype||null,note||null,paymentStatus]);
    for(const event of events){const slot=await placeInExistingHeats(cdb,eventKey(c.name,b.gender,event),registrationId);placements.push({event,...(slot||{notPlaced:true})})}
  });
  await audit('MANUAL_ENTRY','registration',registrationId,{fullName,category:c.name,events,amount,paymentStatus,placements},req.session.operator);
  res.json({ok:true,registrationId,ticketToken,ticketUrl:`/success.html?token=${encodeURIComponent(ticketToken)}`,category:c.name,events,amount,paymentStatus,placements});
});

// Correct a participant's name or school (e.g. a parent's typo). Ticket, check-in, heats and results read these live.
app.post('/api/admin/registrations/:registrationId/details',requireAdmin,async(req,res)=>{
  const registrationId=String(req.params.registrationId||'').trim(),{fullName,schoolName}=req.body||{};
  const clean=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
  const next={full_name:clean(fullName),school_name:clean(schoolName)};
  if(!next.full_name||!next.school_name)return res.status(400).json({error:'Participant name and school are required.'});
  if(next.full_name.length>120||next.school_name.length>120)return res.status(400).json({error:'Name and school must be 120 characters or fewer.'});
  const existing=(await q('SELECT full_name,school_name FROM registrations WHERE registration_id=$1',[registrationId]))[0];
  if(!existing)return res.status(404).json({error:'Registration not found.'});
  const changes=Object.fromEntries(Object.entries(next).filter(([key,value])=>existing[key]!==value).map(([key,value])=>[key,{from:existing[key],to:value}]));
  if(!Object.keys(changes).length)return res.json({ok:true,changed:false,fullName:next.full_name,schoolName:next.school_name});
  await q('UPDATE registrations SET full_name=$1,school_name=$2 WHERE registration_id=$3',[next.full_name,next.school_name,registrationId]);
  await audit('EDIT_REGISTRATION','registration',registrationId,changes,req.session.operator);
  res.json({ok:true,changed:true,fullName:next.full_name,schoolName:next.school_name});
});

// Correct a participant's date of birth. Recalculates the age category and fee; when the current events don't exist in the
// new category the admin must choose new ones (409 EVENTS_NEED_UPDATE; a preview answers 200 with needsEvents). Heat/timing/result rows for events the swimmer is no
// longer entered in are removed. ?preview=1 returns the outcome without saving.
app.post('/api/admin/registrations/:registrationId/dob',requireAdmin,async(req,res)=>{
  const registrationId=String(req.params.registrationId||'').trim(),{dob,events}=req.body||{},preview=req.query.preview==='1';
  const date=new Date(dob);
  if(typeof dob!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(dob)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==dob||date>new Date())return res.status(400).json({error:'Enter a valid date of birth.'});
  const c=categoryForDob(dob);
  if(!c)return res.status(400).json({error:'This date of birth is not eligible for any age category.'});
  const existing=(await q(`SELECT to_char(dob,'YYYY-MM-DD') dob,age_category,gender,events_json,amount FROM registrations WHERE registration_id=$1`,[registrationId]))[0];
  if(!existing)return res.status(404).json({error:'Registration not found.'});
  const current=registrationEvents(existing.events_json),keep=current.filter(e=>c.events.includes(e));
  const summary={category:c.name,previousCategory:existing.age_category,previousDob:existing.dob,validEvents:c.events,eventLabels:c.eventLabels||{},previousAmount:existing.amount};
  let chosen;
  if(events!==undefined){
    if(!Array.isArray(events)||!events.length||events.some(e=>typeof e!=='string'||!c.events.includes(e))||new Set(events).size!==events.length)return res.status(400).json({error:`Choose at least one ${c.name} event; duplicates are not allowed.`});
    chosen=events;
  }else if(current.length&&keep.length===current.length)chosen=current;
  else{const need={...summary,code:'EVENTS_NEED_UPDATE',needsEvents:true,keep,error:`Some events are not part of ${c.name}. Choose the ${c.name} events for this swimmer.`};return preview?res.json({ok:true,preview,...need}):res.status(409).json(need)}
  const individuals=chosen.filter(e=>e!=='4×50m Freestyle Relay'),relay=chosen.includes('4×50m Freestyle Relay');
  if(individuals.length>4)return res.status(400).json({error:'Maximum 4 individual events allowed.'});
  const amount=individuals.length*300+(relay?800:0),validKeys=chosen.map(e=>eventKey(c.name,existing.gender,e));
  const result={...summary,dob,events:chosen,amount};
  const unchanged=existing.dob===dob&&existing.age_category===c.name&&JSON.stringify(current)===JSON.stringify(chosen)&&existing.amount===amount;
  if(preview||unchanged)return res.json({ok:true,preview,changed:false,...result});
  let removedHeatEntries=0;
  await withTransaction(async cdb=>{
    await cdb.query('UPDATE registrations SET dob=$1,age_category=$2,events_json=$3::jsonb,amount=$4 WHERE registration_id=$5',[dob,c.name,JSON.stringify(chosen),amount,registrationId]);
    removedHeatEntries=(await cdb.query('DELETE FROM race_entries WHERE registration_id=$1 AND NOT (event_key = ANY($2::text[]))',[registrationId,validKeys])).rowCount;
    await cdb.query('DELETE FROM timing_entries WHERE registration_id=$1 AND NOT (event_key = ANY($2::text[]))',[registrationId,validKeys]);
    await cdb.query('DELETE FROM result_entries WHERE registration_id=$1 AND NOT (event_key = ANY($2::text[]))',[registrationId,validKeys]);
  });
  await audit('EDIT_DOB','registration',registrationId,{dob:{from:existing.dob,to:dob},category:{from:existing.age_category,to:c.name},events:{from:current,to:chosen},amount:{from:existing.amount,to:amount},removedHeatEntries},req.session.operator);
  res.json({ok:true,changed:true,...result,removedHeatEntries});
});

app.delete('/api/admin/registrations/:registrationId',requireAdmin,async(req,res)=>{
  const registrationId=String(req.params.registrationId||'').trim();
  if(!registrationId)return res.status(400).json({error:'Registration ID is required.'});
  const existing=(await q('SELECT registration_id,full_name FROM registrations WHERE registration_id=$1',[registrationId]))[0];
  if(!existing)return res.status(404).json({error:'Registration not found.'});
  await withTransaction(async c=>{
    await c.query('DELETE FROM whatsapp_queue WHERE registration_id=$1',[registrationId]);
    await c.query('DELETE FROM checkin_audit WHERE registration_id=$1',[registrationId]);
    // timing_entries, result_entries and race_entries are removed by ON DELETE CASCADE.
    await c.query('DELETE FROM registrations WHERE registration_id=$1',[registrationId]);
  });
  await audit('DELETE_REGISTRATION','registration',registrationId,{participant:existing.full_name},req.session.operator);
  res.json({ok:true,registrationId});
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