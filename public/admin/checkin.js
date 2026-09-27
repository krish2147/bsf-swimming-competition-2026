const {api,post,escape:esc,text,run,media}=Admin;
const $=id=>document.getElementById(id);
// Ticket QRs encode `${BASE_URL}/admin/checkin.html?token=<uuid>`; a bare token is accepted too.
const tokenFromScan=value=>{
 let token=String(value??'').trim();
 try{token=new URL(token).searchParams.get('token')||''}catch{}
 return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)?token:null;
};
window.CheckinScanner={tokenFromScan};
window.lookup=run(async()=>{
 stopScan();$('scanError').classList.add('hidden');
 const token=$('token').value.trim();if(!token)throw Error('Enter a ticket token.');
 $('card').replaceChildren();
 const d=await api('/api/admin/checkin/'+encodeURIComponent(token));
 $('card').innerHTML=`<div class="card"><button class="secondary" type="button" data-participant="${esc(d.registrationId)}">${text(d.registrationId)} — Full details</button><div class="grid"><div>${media(d.photo,'Participant photo')}<h2>${text(d.fullName)}</h2><p>${text(d.schoolName)}</p><p><b>${text(d.category)} • ${text(d.gender)}</b></p><p>DOB: ${text(d.dob)}</p><p>Current status: <b id="checkinStatus">${text(d.checkinStatus)}</b></p></div><div><h3>Payment proof</h3>${media(d.paymentProof,'Payment proof')}<p>Payment review: ${text(d.paymentStatus)}</p><h3>Events</h3><p>${d.events.map(esc).join('<br>')||'No events recorded'}</p></div></div><label for="reason">Rejection reason</label><input id="reason"><div class="row"><button class="good" id="approve">Approve</button><button class="bad" id="reject">Reject</button><button type="button" class="hidden" id="scanNext">Scan next ticket</button></div><p id="decision" role="status"></p></div>`;
 for(const [id,decision] of [['approve','Approved'],['reject','Rejected']])$(id).onclick=run(async()=>{const d=await post('/api/admin/checkin/'+encodeURIComponent(token),{decision,reason:$('reason').value});$('decision').textContent='Saved: '+d.status;$('checkinStatus').textContent=d.status;$('scanNext').classList.remove('hidden')});
 $('scanNext').onclick=startScan;
});

// Camera scanner: native BarcodeDetector where available (Android Chrome), self-hosted jsQR elsewhere (iPhone Safari, desktop).
const scanner={session:0,stream:null,timer:0};
let jsQRLoad;
const loadJsQR=()=>jsQRLoad||=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/admin/vendor/jsQR.js';s.onload=()=>resolve(window.jsQR);s.onerror=()=>{jsQRLoad=null;s.remove();reject(Error('Could not load the QR scanner. Check the connection and tap Scan QR again.'))};document.head.append(s)});
async function qrDecoder(){
 if('BarcodeDetector' in window){try{if((await BarcodeDetector.getSupportedFormats()).includes('qr_code')){const detector=new BarcodeDetector({formats:['qr_code']});return async video=>(await detector.detect(video))[0]?.rawValue}}catch{}}
 const jsQR=await loadJsQR(),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
 return video=>{
  const scale=Math.min(1,720/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
  ctx.drawImage(video,0,0,canvas.width,canvas.height);const image=ctx.getImageData(0,0,canvas.width,canvas.height);
  return jsQR(image.data,image.width,image.height,{inversionAttempts:'dontInvert'})?.data;
 };
}
function cameraError(err){
 if(!window.isSecureContext)return 'Camera scanning needs the admin site to be opened over HTTPS. Enter the ticket token instead.';
 if(!navigator.mediaDevices?.getUserMedia)return 'This browser cannot open the camera. Enter the ticket token instead.';
 if(['NotAllowedError','SecurityError'].includes(err?.name))return 'Camera permission was blocked. Allow camera access for this site in the browser settings, then tap Scan QR again.';
 if(['NotFoundError','OverconstrainedError'].includes(err?.name))return 'No camera was found on this device. Enter the ticket token instead.';
 if(err?.name==='NotReadableError')return 'The camera is busy in another app. Close that app and tap Scan QR again.';
 return err?.message||'Could not start the camera. Enter the ticket token instead.';
}
function stopScan(){
 scanner.session++;clearTimeout(scanner.timer);
 scanner.stream?.getTracks().forEach(track=>track.stop());scanner.stream=null;
 $('scanVideo').srcObject=null;$('scanner').classList.add('hidden');$('scanBtn').disabled=false;
 $('torchBtn').classList.add('hidden');$('torchBtn').setAttribute('aria-pressed','false');$('torchBtn').textContent='Flashlight';
}
const startScan=run(async()=>{
 stopScan();
 const session=scanner.session,video=$('scanVideo'),status=$('scanStatus');
 $('card').replaceChildren();$('token').value='';$('scanError').classList.add('hidden');
 $('scanBtn').disabled=true;$('scanner').classList.remove('hidden');status.textContent='Starting camera…';
 let decode;
 try{
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error();
  const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
  if(session!==scanner.session){stream.getTracks().forEach(track=>track.stop());return}
  scanner.stream=stream;video.srcObject=stream;await video.play();
  decode=await qrDecoder();
 }catch(err){if(session===scanner.session){stopScan();$('scanError').textContent=cameraError(err);$('scanError').classList.remove('hidden')}return}
 if(session!==scanner.session)return;
 if(scanner.stream.getVideoTracks()[0]?.getCapabilities?.().torch)$('torchBtn').classList.remove('hidden');
 status.textContent='Point the camera at the QR code on the ticket.';
 const tick=async()=>{
  if(session!==scanner.session)return;
  let value;try{if(video.readyState>=2)value=await decode(video)}catch{}
  if(session!==scanner.session)return;
  if(value){
   const token=tokenFromScan(value);
   if(token){navigator.vibrate?.(80);stopScan();$('token').value=token;history.replaceState(null,'','?token='+encodeURIComponent(token));return lookup()}
   status.textContent='That QR code is not a BSF ticket. Scan the QR code on the participant’s ticket.';
  }
  scanner.timer=setTimeout(tick,150);
 };
 tick();
});
$('scanBtn').onclick=startScan;
$('stopScanBtn').onclick=stopScan;
$('torchBtn').onclick=run(async()=>{
 const track=scanner.stream?.getVideoTracks()[0];if(!track)return;
 const on=$('torchBtn').getAttribute('aria-pressed')!=='true';
 await track.applyConstraints({advanced:[{torch:on}]});
 $('torchBtn').setAttribute('aria-pressed',String(on));$('torchBtn').textContent=on?'Flashlight off':'Flashlight';
});
$('token').addEventListener('keydown',e=>{if(e.key==='Enter')lookup()});
// Release the camera when the volunteer switches apps or leaves the page.
document.addEventListener('visibilitychange',()=>{if(document.hidden&&scanner.stream)stopScan()});
addEventListener('pagehide',stopScan);

run(async()=>{if(!await Admin.authenticated())return;const token=new URLSearchParams(location.search).get('token');if(token){$('token').value=token;await lookup()}})();
