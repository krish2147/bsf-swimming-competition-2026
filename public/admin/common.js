(()=>{
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=value=>escape(value==null||value===''?'—':value);
  const date=value=>value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'—';
  async function api(url,options){
    const response=await fetch(url,options);
    const data=await response.json().catch(()=>({error:'Invalid server response. Please retry.'}));
    if(!response.ok){
      if(response.status===401)location.assign('/admin/');
      throw new Error(data.error||'Request failed. Please retry.');
    }
    return data;
  }
  const post=(url,data)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  async function authenticated(){const me=await api('/api/admin/me');if(!me.authenticated){location.assign('/admin/');return false}return true}
  function error(err){document.getElementById('adminError').textContent=err.message||'Request failed. Please retry.'}
  function run(fn){return async(...args)=>{document.getElementById('adminError').textContent='';try{return await fn(...args)}catch(err){error(err)}}}
  const notice=document.createElement('p');notice.id='adminError';notice.className='notice admin-error';notice.setAttribute('role','alert');document.querySelector('main').prepend(notice);
  document.body.classList.add('admin-page');
  function modal(id,title){
    const dialog=document.createElement('dialog');dialog.id=id;dialog.className='admin-dialog';dialog.setAttribute('aria-labelledby',id+'Title');
    dialog.innerHTML=`<div class="admin-dialog-header"><h2 id="${id}Title">${title}</h2><button type="button" class="secondary admin-close" aria-label="Close ${title.toLowerCase()}" autofocus>×</button></div><div class="admin-dialog-content"></div>`;
    dialog.querySelector('button').onclick=()=>dialog.close();
    dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))dialog.close()});
    document.body.append(dialog);return dialog;
  }
  const details=modal('participantDialog','Participant details'),lightbox=modal('mediaDialog','Registration image');
  function media(url,label){return url?`<button type="button" class="admin-media-button" data-image="${escape(url)}" data-label="${escape(label)}" aria-label="Enlarge ${escape(label)}"><img src="${escape(url)}" alt="${escape(label)}" loading="lazy"></button>`:`<p class="muted">${escape(label)} unavailable</p>`}
  document.addEventListener('error',e=>{if(e.target.tagName==='IMG'&&e.target.closest('.admin-media-button')){const button=e.target.closest('button');button.disabled=true;button.textContent=e.target.alt+' unavailable'}},true);
  document.addEventListener('click',run(async e=>{
    const button=e.target.closest('[data-image]');
    if(button){
      const image=document.createElement('img');image.src=button.dataset.image;image.alt=button.dataset.label;
      image.onerror=()=>{lightbox.querySelector('.admin-dialog-content').textContent='Image unavailable. Please close and refresh the participant.'};
      lightbox.querySelector('.admin-dialog-content').replaceChildren(image);lightbox.showModal();return;
    }
    const participant=e.target.closest('[data-participant]');
    if(participant)await openParticipant(participant.dataset.participant);
  }));
  async function openParticipant(id){
    const r=await api('/api/admin/registrations/'+encodeURIComponent(id));
    const fields=[['Registration ID',r.registration_id],['Participant',r.full_name],['School',r.school_name],['Gender',r.gender],['DOB',r.dob],['Category',r.age_category],['Contact',r.phone],['Email',r.email],['Guardian',r.guardian_name],['Registered (IST)',date(r.created_at)],['Amount',r.amount==null?null:'₹'+r.amount],['UTR',r.payment_utr],['Check-in',r.checkin_status]];
    details.querySelector('.admin-dialog-content').innerHTML=`<dl class="admin-details">${fields.map(([label,value])=>`<div><dt>${label}</dt><dd>${text(value)}</dd></div>`).join('')}</dl><h3>Selected events</h3><p>${(r.events_json||[]).map(escape).join('<br>')||'No events recorded'}</p><div class="grid"><div><h3>Participant photo</h3>${media(r.participant_photo,'Participant photo')}</div><div><h3>Payment proof</h3>${media(r.payment_proof,'Payment proof')}</div></div><p>Payment status: <b id="detailPaymentStatus">${text(r.payment_status)}</b></p><div class="row">${['Verified','Pending','Issue'].map(status=>`<button type="button" data-status="${status}" class="${status==='Verified'?'good':status==='Issue'?'bad':'secondary'}">${status}</button>`).join('')}</div><p id="detailMessage" role="status"></p>${r.ticketUrl?`<h3>Ticket / QR</h3><img class="qr" src="${escape(r.qrDataUrl)}" alt="Participant check-in QR code"><p><a href="${escape(r.ticketUrl)}">Open registration ticket</a></p>`:'<p>Ticket unavailable</p>'}`;
    for(const button of details.querySelectorAll('[data-status]'))button.onclick=async()=>{
      const buttons=[...details.querySelectorAll('[data-status]')];buttons.forEach(b=>b.disabled=true);
      try{await post('/api/admin/payment-status',{registrationId:id,status:button.dataset.status});document.getElementById('detailPaymentStatus').textContent=button.dataset.status;document.getElementById('detailMessage').textContent='Payment status saved.';document.dispatchEvent(new CustomEvent('admin-payment-updated',{detail:{id,status:button.dataset.status}}))}
      catch(err){document.getElementById('detailMessage').textContent=err.message}
      finally{buttons.forEach(b=>b.disabled=false)}
    };
    if(!details.open)details.showModal();
  }
  window.Admin={escape,text,date,api,post,authenticated,run,error,media,openParticipant};
})();
