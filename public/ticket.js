(()=>{
  const params=new URLSearchParams(location.search),hasRegistrationToken=params.has('token');
  const tokenForState=params.get('token')||'',whatsappSessionKey=tokenForState?`bsf-whatsapp-opened-${tokenForState}`:'';
  if(hasRegistrationToken){
    history.replaceState({done:true},'',location.href);
    history.pushState({guard:true},'',location.href);
    addEventListener('popstate',()=>location.replace('/'));
  }
  const image=document.getElementById('ticketImage'),status=document.getElementById('ticketStatus');
  const download=document.getElementById('downloadTicket'),print=document.getElementById('printTicket'),retry=document.getElementById('retryTicket');
  const popupDownload=document.getElementById('popupDownloadTicket'),whatsappDialog=document.getElementById('whatsappDialog'),countdownEl=document.getElementById('whatsappCountdown'),joinWhatsapp=document.getElementById('joinWhatsapp'),stayOnTicket=document.getElementById('stayOnTicket');
  let ticketUrl=null,registrationId='',whatsappTimer=null,whatsappOpened=!!(whatsappSessionKey&&sessionStorage.getItem(whatsappSessionKey)==='1');
  const markWhatsappOpened=()=>{whatsappOpened=true;if(whatsappSessionKey)sessionStorage.setItem(whatsappSessionKey,'1')};
  const loadImage=src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('A ticket image could not load. Please try again.'));img.src=src});
  function startDownload(){
    if(!ticketUrl)return;
    const link=document.createElement('a');link.href=ticketUrl;link.download=`BSF-Ticket-${registrationId.replace(/[^a-zA-Z0-9_-]/g,'_')}.png`;document.body.append(link);link.click();link.remove();
    status.textContent='Your ticket download has started. Keep the saved QR ready for check-in.';
  }
  function stopWhatsappCountdown(){if(whatsappTimer){clearInterval(whatsappTimer);whatsappTimer=null}}
  function openWhatsapp(){
    if(whatsappOpened)return;markWhatsappOpened();stopWhatsappCountdown();
    if(whatsappDialog?.open)whatsappDialog.close();
    const popup=window.open(joinWhatsapp.href,'_blank','noopener,noreferrer');
    if(!popup)location.href=joinWhatsapp.href;
  }
  function showWhatsappPopup(){
    if(!hasRegistrationToken||!whatsappDialog||!joinWhatsapp||whatsappOpened)return;
    let remaining=5;countdownEl.textContent=remaining;
    if(!whatsappDialog.open)whatsappDialog.showModal();
    whatsappTimer=setInterval(()=>{remaining-=1;countdownEl.textContent=Math.max(remaining,0);if(remaining<=0)openWhatsapp()},1000);
  }
  joinWhatsapp?.addEventListener('click',()=>{markWhatsappOpened();stopWhatsappCountdown();if(whatsappDialog?.open)whatsappDialog.close()});
  stayOnTicket?.addEventListener('click',()=>{stopWhatsappCountdown();if(whatsappDialog?.open)whatsappDialog.close()});
  popupDownload?.addEventListener('click',startDownload);

  function renderTicket(data,logo,qr){
    const width=680,scale=2,margin=36,inner=width-margin*2;
    const canvas=document.createElement('canvas');let ctx=canvas.getContext('2d');
    const font=(size,weight=400)=>`${weight} ${size}px Arial, sans-serif`;
    const wrap=(value,size,maxWidth,weight=400)=>{ctx.font=font(size,weight);const lines=[];for(const paragraph of String(value??'—').split(/\r?\n/)){let line='';for(const word of paragraph.split(/\s+/)){const candidate=line?line+' '+word:word;if(ctx.measureText(candidate).width<=maxWidth){line=candidate;continue}if(line){lines.push(line);line=''}for(const char of word){if(ctx.measureText(line+char).width>maxWidth&&line){lines.push(line);line=''}line+=char}}lines.push(line||'—')}return lines};
    const name=wrap(data.fullName,42,inner,700),id=wrap(data.registrationId,29,inner-36,700),school=wrap(data.schoolName,28,inner);
    const events=(Array.isArray(data.events)?data.events:[]).map(e=>wrap(data.eventLabels?.[e]||e,27,inner-28));
    const category=wrap(data.category,28,inner/2-18,700),gender=wrap(data.gender,28,inner/2-18,700),venue=wrap(data.venue||'Venue to be announced',26,inner);
    const floaterReminder=data.requiresFloaters?wrap('Bring Your Own Floaters — BSF/School will not provide floaters for this event.',25,inner-32,700):[],floaterHeight=floaterReminder.length?floaterReminder.length*34+40:0;
    const height=floaterHeight+1149+name.length*50+id.length*36+school.length*36+Math.max(category.length,gender.length)*36+Math.max(1,events.reduce((sum,e)=>sum+e.length,0))*36+events.length*10+venue.length*34;
    canvas.width=width*scale;canvas.height=height*scale;ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.textBaseline='top';
    const navy='#102d46',blue='#167ca2',muted='#526a7c',gold='#d9b667';
    const rect=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h)},text=(value,x,y,size=26,weight=400,color=navy)=>{ctx.font=font(size,weight);ctx.fillStyle=color;ctx.fillText(value,x,y)},lines=(values,x,y,size,lineHeight,weight=400,color=navy)=>{values.forEach((v,i)=>text(v,x,y+i*lineHeight,size,weight,color));return y+values.length*lineHeight},rule=y=>rect(margin,y,inner,1,'#dce6ed');
    rect(0,0,width,height,'#fff');rect(0,0,width,206,navy);rect(0,0,8,206,gold);ctx.strokeStyle='#ffffff12';ctx.lineWidth=2;for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(450+i*46,0);ctx.lineTo(610+i*46,206);ctx.stroke()}
    rect(margin,30,86,90,'#fff');const logoScale=Math.min(78/logo.width,82/logo.height);ctx.drawImage(logo,margin+(86-logo.width*logoScale)/2,30+(90-logo.height*logoScale)/2,logo.width*logoScale,logo.height*logoScale);
    text('BARODA SWIM FRONT',140,37,28,700,'#fff');text('Inter-School Swimming',140,79,24,400,'#dbe9f0');text('Competition 2026',140,110,24,400,'#dbe9f0');text('ENTRY PASS',margin,162,24,700,gold);text('Registration Successful',244,164,23,400,'#fff');
    let y=242;y=lines(name,margin,y,42,50,700)+24;rect(margin,y,inner,id.length*36+64,'#edf5fa');text('REGISTRATION ID',margin+18,y+12,20,700,muted);lines(id,margin+18,y+42,29,36,700);y+=id.length*36+88;
    text('SCHOOL',margin,y,20,700,muted);y=lines(school,margin,y+30,28,36)+20;text('AGE CATEGORY',margin,y,20,700,muted);text('GENDER',width/2+12,y,20,700,muted);y+=30;lines(category,margin,y,28,36,700);lines(gender,width/2+12,y,28,36,700);y+=Math.max(category.length,gender.length)*36+24;rule(y);y+=25;
    text('SELECTED EVENTS',margin,y,20,700,muted);y+=34;if(!events.length){text('No events recorded',margin,y,27);y+=36}for(const event of events){rect(margin,y+12,7,7,blue);y=lines(event,margin+26,y,27,36)+10}if(floaterHeight){rect(margin,y,inner,floaterHeight-12,'#fff3ce');lines(floaterReminder,margin+16,y+14,25,34,700,'#513d12');y+=floaterHeight}
    y+=18;rule(y);y+=26;text('SHOW THIS QR AT CHECK-IN',margin,y,23,700,navy);y+=38;const qrSize=300;ctx.imageSmoothingEnabled=false;ctx.drawImage(qr,(width-qrSize)/2,y,qrSize,qrSize);ctx.imageSmoothingEnabled=true;y+=qrSize+14;
    const payment='Payment review: '+({Pending:'Pending',Verified:'Verified',Issue:'Issue flagged'}[data.paymentStatus]||'Not recorded');text(payment,margin,y,23,400,muted);y+=48;rule(y);y+=26;text(data.competitionDate||'4 October 2026',margin,y,30,700);y+=42;y=lines(venue,margin,y,26,34)+28;text('Registration Deadline: '+data.registrationDeadline,margin,y,23,400,muted);y+=40;rect(0,y,width,52,navy);text('BSF  /  RACE DAY 2026',margin,y+15,20,700,'#fff');if(y+52!==height)throw Error('The complete ticket could not be rendered. Please try again.');return canvas;
  }
  function accessibleDescription(data){const description=document.getElementById('ticketDescription');description.replaceChildren();const fields=[['Status','Registration Successful'],['Participant',data.fullName],['Registration ID',data.registrationId],['School',data.schoolName],['Gender',data.gender],['Age category',data.category],['Selected events',(data.events||[]).map(e=>data.eventLabels?.[e]||e).join(', ')],['Competition date',data.competitionDate],['Registration deadline',data.registrationDeadline],['Venue',data.venue],['Payment review',data.paymentStatus]];if(data.requiresFloaters)fields.push(['Important reminder','Bring Your Own Floaters — BSF/School will not provide floaters for this event.']);const dl=document.createElement('dl');for(const [label,value] of fields){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value||'—';dl.append(dt,dd)}description.append(dl);image.alt=`BSF entry pass for ${data.fullName}, registration ${data.registrationId}, with check-in QR code`}
  async function prepare(){download.disabled=true;print.disabled=true;if(popupDownload)popupDownload.disabled=true;retry.hidden=true;status.textContent='Preparing your entry pass…';try{const token=params.get('token');if(!token)throw Error('This ticket link is missing its registration token. Please use your original confirmation link.');const response=await fetch('/api/ticket/'+encodeURIComponent(token));if(!response.ok)throw Error(response.status===404?'Ticket not found. Please check your original confirmation link.':'Your ticket could not be loaded. Please try again.');const data=await response.json();registrationId=data.registrationId;await document.fonts.ready;const [logo,qr]=await Promise.all([loadImage('/bsf-logo.jpeg'),loadImage(data.qrDataUrl)]);const canvas=renderTicket(data,logo,qr);const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Ticket image could not be prepared. Please try again.')),'image/png'));if(ticketUrl)URL.revokeObjectURL(ticketUrl);ticketUrl=URL.createObjectURL(blob);image.src=ticketUrl;await image.decode();accessibleDescription(data);document.getElementById('ticket').hidden=false;download.disabled=false;print.disabled=false;if(popupDownload)popupDownload.disabled=false;status.textContent='';}catch(error){status.textContent=error.message;retry.hidden=false}}
  download.addEventListener('click',startDownload);print.addEventListener('click',()=>window.print());retry.addEventListener('click',prepare);
  prepare();if(hasRegistrationToken&&!whatsappOpened)setTimeout(showWhatsappPopup,250);
})();
