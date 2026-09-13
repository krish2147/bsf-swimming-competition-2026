const {api,post,escape:esc,text,run,media}=Admin;
async function load(){
  const rows=await api('/api/admin/payments');
  document.getElementById('out').innerHTML=rows.map(r=>`<div class="card"><div class="grid"><div><h3>${text(r.full_name)}</h3><p>${text(r.school_name)}<br><button type="button" class="secondary" data-participant="${esc(r.registration_id)}">${text(r.registration_id)}</button><br>${text(r.phone)}<br>₹${text(r.amount)}</p><p>UTR: ${text(r.payment_utr)}</p><p>Status: <b data-payment-label="${esc(r.registration_id)}">${text(r.payment_status)}</b></p></div><div>${media(r.payment_proof,'Payment proof')}</div></div><div class="row">${['Verified','Pending','Issue'].map(status=>`<button type="button" class="${status==='Verified'?'good':status==='Issue'?'bad':'secondary'}" data-payment-id="${esc(r.registration_id)}" data-status="${status}">${status}</button>`).join('')}</div></div>`).join('')||'<div class="notice">No registrations yet.</div>';
}
document.getElementById('out').addEventListener('click',run(async e=>{
 const button=e.target.closest('[data-payment-id]');if(!button)return;
 button.disabled=true;
 try{await post('/api/admin/payment-status',{registrationId:button.dataset.paymentId,status:button.dataset.status});document.dispatchEvent(new CustomEvent('admin-payment-updated',{detail:{id:button.dataset.paymentId,status:button.dataset.status}}))}
 finally{button.disabled=false}
}));
document.addEventListener('admin-payment-updated',e=>{for(const label of document.querySelectorAll('[data-payment-label]'))if(label.dataset.paymentLabel===e.detail.id)label.textContent=e.detail.status});
run(async()=>{if(await Admin.authenticated())await load()})();
