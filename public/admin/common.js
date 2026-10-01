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
  const del=url=>api(url,{method:'DELETE'});
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
  // Only photo/participant clicks run here: wrapping every click in run() would clear other errors as they appear.
  const openFromClick=run(async e=>{
    const button=e.target.closest('[data-image]');
    if(button){
      const image=document.createElement('img');image.src=button.dataset.image;image.alt=button.dataset.label;
      image.onerror=()=>{lightbox.querySelector('.admin-dialog-content').textContent='Image unavailable. Please close and refresh the participant.'};
      lightbox.querySelector('.admin-dialog-content').replaceChildren(image);lightbox.showModal();return;
    }
    const participant=e.target.closest('[data-participant]');
    if(participant)await openParticipant(participant.dataset.participant);
  });
  document.addEventListener('click',e=>{if(e.target.closest('[data-image],[data-participant]'))openFromClick(e)});
  async function openParticipant(id){
    const r=await api('/api/admin/registrations/'+encodeURIComponent(id));
    const fields=[['Registration ID',r.registration_id],['Participant',r.full_name],['School',r.school_name],['Gender',r.gender],['DOB',r.dob],['Category',r.age_category],['Contact',r.phone],['Email',r.email],['Guardian',r.guardian_name],['Registered (IST)',date(r.created_at)],['Amount',r.amount==null?null:'₹'+r.amount],['UTR',r.payment_utr],['Check-in',r.checkin_status]];
    details.querySelector('.admin-dialog-content').innerHTML=`<dl class="admin-details">${fields.map(([label,value])=>`<div><dt>${label}</dt><dd>${text(value)}</dd></div>`).join('')}</dl><h3>Selected events</h3><p>${(r.events_json||[]).map(escape).join('<br>')||'No events recorded'}</p><div class="grid"><div><h3>Participant photo</h3>${media(r.participant_photo,'Participant photo')}</div><div><h3>Payment proof</h3>${media(r.payment_proof,'Payment proof')}</div></div><p>Payment status: <b id="detailPaymentStatus">${text(r.payment_status)}</b></p><div class="row">${['Verified','Pending','Issue'].map(status=>`<button type="button" data-status="${status}" class="${status==='Verified'?'good':status==='Issue'?'bad':'secondary'}">${status}</button>`).join('')}</div><p id="detailMessage" role="status"></p>${r.ticketUrl?`<h3>Ticket / QR</h3><img class="qr" src="${escape(r.qrDataUrl)}" alt="Participant check-in QR code"><p><a href="${escape(r.ticketUrl)}">Open registration ticket</a></p>`:'<p>Ticket unavailable</p>'}<hr><h3>Edit details</h3><p class="muted">Correct spelling mistakes. The ticket, check-in, heats and results update automatically; the ticket QR stays the same.</p><label for="editFullName">Participant name</label><input id="editFullName" maxlength="120" autocomplete="off" value="${escape(r.full_name)}"><label for="editSchoolName">School</label><input id="editSchoolName" maxlength="120" autocomplete="off" value="${escape(r.school_name)}"><button type="button" id="saveDetails">Save changes</button><p id="editMessage" role="status"></p><hr><h3>Correct date of birth</h3><p class="muted">Use the date on the birth certificate. The age category and fee update automatically; if the events don't exist in the new category, choose new ones.</p><label for="editDob">Date of birth</label><input id="editDob" type="date" value="${escape(r.dob)}" max="${new Date().toISOString().slice(0,10)}"><p id="dobPreview" class="dob-preview" role="status"></p><div id="dobEvents"></div><button type="button" id="saveDob">Save date of birth</button><p id="dobMessage" role="status"></p><hr><h3>Delete registration</h3><p class="muted">Permanently removes this registration and its linked race data. This cannot be undone.</p><button type="button" id="deleteRegistration" class="bad">Delete registration</button><p id="deleteMessage" role="status"></p>`;
    for(const button of details.querySelectorAll('[data-status]'))button.onclick=async()=>{
      const buttons=[...details.querySelectorAll('[data-status]')];buttons.forEach(b=>b.disabled=true);
      try{await post('/api/admin/payment-status',{registrationId:id,status:button.dataset.status});document.getElementById('detailPaymentStatus').textContent=button.dataset.status;document.getElementById('detailMessage').textContent='Payment status saved.';document.dispatchEvent(new CustomEvent('admin-payment-updated',{detail:{id,status:button.dataset.status}}))}
      catch(err){document.getElementById('detailMessage').textContent=err.message}
      finally{buttons.forEach(b=>b.disabled=false)}
    };
    const saveDetails=document.getElementById('saveDetails');
    saveDetails.onclick=async()=>{
      const fullName=document.getElementById('editFullName').value,schoolName=document.getElementById('editSchoolName').value;
      if(!fullName.trim()||!schoolName.trim()){document.getElementById('editMessage').textContent='Participant name and school are required.';return}
      saveDetails.disabled=true;document.getElementById('editMessage').textContent='Saving…';
      try{
        const saved=await post('/api/admin/registrations/'+encodeURIComponent(id)+'/details',{fullName,schoolName});
        if(saved.changed){await openParticipant(id);document.dispatchEvent(new CustomEvent('admin-registration-updated',{detail:{id}}))}
        document.getElementById('editMessage').textContent=saved.changed?`Saved. Name: ${saved.fullName} · School: ${saved.schoolName}`:'No changes to save.';
      }catch(err){document.getElementById('editMessage').textContent=err.message}
      finally{document.getElementById('saveDetails').disabled=false}
    };
    // Date of birth correction: preview the new category/fee, pick events when the old ones don't fit, then save.
    const dobInput=document.getElementById('editDob'),dobPreview=document.getElementById('dobPreview'),dobEvents=document.getElementById('dobEvents'),saveDob=document.getElementById('saveDob');
    const chosenEvents=()=>dobEvents.querySelector('[data-dob-event]')?[...dobEvents.querySelectorAll('[data-dob-event]:checked')].map(box=>box.value):undefined;
    const dobRequest=async(previewOnly)=>{
      const response=await fetch('/api/admin/registrations/'+encodeURIComponent(id)+'/dob'+(previewOnly?'?preview=1':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dob:dobInput.value,events:chosenEvents()})});
      if(response.status===401)location.assign('/admin/');
      return {status:response.status,data:await response.json().catch(()=>({error:'Invalid server response. Please retry.'}))};
    };
    const showEventChoice=data=>{
      dobEvents.innerHTML=`<fieldset class="dob-events"><legend>${escape(data.category)} events</legend>${data.validEvents.map(e=>`<label><input type="checkbox" data-dob-event value="${escape(e)}" ${data.keep.includes(e)?'checked':''}> ${escape(data.eventLabels[e]||e)}</label>`).join('')}</fieldset>`;
      for(const box of dobEvents.querySelectorAll('[data-dob-event]'))box.onchange=previewDob;
    };
    const describe=data=>`Category: ${data.previousCategory===data.category?escape(data.category):`${escape(data.previousCategory)} → <b>${escape(data.category)}</b>`} · Events: ${data.events.map(escape).join(', ')} · Fee: ${data.previousAmount===data.amount?'₹'+data.amount:`₹${data.previousAmount} → <b>₹${data.amount}</b>`}`;
    async function previewDob(){
      document.getElementById('dobMessage').textContent='';
      if(!dobInput.value){dobPreview.textContent='';return}
      const {status,data}=await dobRequest(true);
      if(data.needsEvents){const first=!dobEvents.querySelector('[data-dob-event]');showEventChoice(data);dobPreview.innerHTML=`Category: ${escape(data.previousCategory)} → <b>${escape(data.category)}</b>. ${escape(data.error)}`;if(first&&data.keep.length)return previewDob();return}
      if(status>=400){dobPreview.textContent=data.error||'Could not check this date.';return}
      dobPreview.innerHTML=describe(data);
    }
    dobInput.onchange=()=>{dobEvents.replaceChildren();previewDob()};
    saveDob.onclick=async()=>{
      if(!dobInput.value){document.getElementById('dobMessage').textContent='Enter the date of birth.';return}
      const check=await dobRequest(true);
      if(check.data.needsEvents){showEventChoice(check.data);document.getElementById('dobMessage').textContent=check.data.error;return}
      if(check.status>=400){document.getElementById('dobMessage').textContent=check.data.error||'Could not save.';return}
      if(!check.data.changed&&check.data.dob===r.dob&&check.data.category===r.age_category&&JSON.stringify(check.data.events)===JSON.stringify(r.events_json)){document.getElementById('dobMessage').textContent='No changes to save.';return}
      if(!confirm(`Change date of birth from ${r.dob} to ${check.data.dob}?\nCategory: ${check.data.previousCategory} → ${check.data.category}\nEvents: ${check.data.events.join(', ')}\nFee: ₹${check.data.previousAmount} → ₹${check.data.amount}`))return;
      saveDob.disabled=true;document.getElementById('dobMessage').textContent='Saving…';
      try{
        const {status,data}=await dobRequest(false);
        if(status>=400)throw new Error(data.error||'Could not save the date of birth.');
        await openParticipant(id);document.dispatchEvent(new CustomEvent('admin-registration-updated',{detail:{id}}));
        const fee=data.amount===data.previousAmount?'':` Fee changed ₹${data.previousAmount} → ₹${data.amount}${data.amount>data.previousAmount?` (collect ₹${data.amount-data.previousAmount} more)`:` (₹${data.previousAmount-data.amount} less)`}.`;
        document.getElementById('dobMessage').textContent=`Saved. ${data.dob} · ${data.category} · ${data.events.join(', ')}.${fee}${data.removedHeatEntries?` Removed from ${data.removedHeatEntries} old heat(s) — re-arrange heats for ${data.category}.`:''}`;
      }catch(err){document.getElementById('dobMessage').textContent=err.message}
      finally{document.getElementById('saveDob').disabled=false}
    };
    const deleteButton=document.getElementById('deleteRegistration');
    deleteButton.onclick=async()=>{
      if(!confirm('Delete '+r.full_name+' ('+id+') permanently? This cannot be undone.'))return;
      const typed=prompt('For safety, type DELETE to confirm.');
      if(typed!=='DELETE')return;
      deleteButton.disabled=true;document.getElementById('deleteMessage').textContent='Deleting…';
      try{
        await del('/api/admin/registrations/'+encodeURIComponent(id));
        details.close();
        document.dispatchEvent(new CustomEvent('admin-registration-deleted',{detail:{id}}));
        location.reload();
      }catch(err){
        document.getElementById('deleteMessage').textContent=err.message;
        deleteButton.disabled=false;
      }
    };
    if(!details.open)details.showModal();
  }
  // Saves an admin CSV/file response, keeping API errors in the admin error bar instead of a blank page.
  async function download(url,fallbackName){
    const response=await fetch(url);
    if(!response.ok){if(response.status===401)location.assign('/admin/');throw new Error((await response.json().catch(()=>({}))).error||'Download failed. Please retry.')}
    const name=/filename="([^"]+)"/.exec(response.headers.get('Content-Disposition')||'')?.[1]||fallbackName;
    const link=Object.assign(document.createElement('a'),{href:URL.createObjectURL(await response.blob()),download:name});
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }
  window.Admin={escape,text,date,api,post,del,authenticated,run,error,media,openParticipant,download};
})();
