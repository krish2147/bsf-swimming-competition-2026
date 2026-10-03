const {api,post,escape:esc,text,date,run}=Admin;
let page=1,requestVersion=0,competitionConfig=null;
const filters=document.getElementById('registrationFilters');
async function loadRegistrations(){
  const version=++requestVersion,params=new URLSearchParams(new FormData(filters));params.set('page',page);
  const result=await api('/api/admin/registrations?'+params);
  if(version!==requestVersion)return;
  if(!result.rows.length&&page>1){page=1;return loadRegistrations()}
  document.getElementById('registrationRows').innerHTML=result.rows.map(r=>`<tr><td><button class="secondary" type="button" data-participant="${esc(r.registration_id)}">${text(r.registration_id)}</button></td><td>${text(r.full_name)}</td><td>${text(r.school_name)}</td><td>${text(r.gender)}</td><td>${text(r.dob)}<br>${text(r.age_category)}</td><td>${r.events_json.map(esc).join('<br>')||'No events recorded'}</td><td>${text(r.phone)}</td><td>${text(r.payment_status)}</td><td>${esc(date(r.created_at))}</td></tr>`).join('')||'<tr><td colspan="9">No registrations match these filters.</td></tr>';
  document.getElementById('registrationCount').textContent=`${result.total} registration(s)`;
  document.getElementById('pageInfo').textContent=`Page ${page} of ${Math.max(1,Math.ceil(result.total/result.limit))}`;
  document.getElementById('previousPage').disabled=page<=1;
  document.getElementById('nextPage').disabled=page*result.limit>=result.total;
}
async function overview(){const data=await api('/api/admin/overview');for(const key of ['registrations','checkedIn','paymentPending','paymentVerified','published'])document.getElementById(key).textContent=data[key]}
async function load(){
  const me=await api('/api/admin/me');if(!me.authenticated)return;
  document.getElementById('loginBox').classList.add('hidden');document.getElementById('dash').classList.remove('hidden');
  const config=await api('/api/config');competitionConfig=config;
  document.getElementById('categoryFilter').innerHTML='<option value="">All categories</option>'+config.categories.map(c=>`<option>${esc(c.name)}</option>`).join('');
  document.getElementById('eventFilter').innerHTML='<option value="">All events</option>'+[...new Set(config.categories.flatMap(c=>c.events))].map(e=>`<option>${esc(e)}</option>`).join('');
  await Promise.all([overview(),loadRegistrations()]);
}
window.login=run(async()=>{await post('/api/admin/login',{pin:document.getElementById('pin').value});document.getElementById('pin').value='';await load()});
document.getElementById('pin').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
filters.addEventListener('submit',run(async e=>{e.preventDefault();page=1;await loadRegistrations()}));
filters.addEventListener('change',run(async()=>{page=1;await loadRegistrations()}));
filters.addEventListener('reset',()=>setTimeout(run(async()=>{page=1;await loadRegistrations()}),0));
// Downloads every registration matching the current filters (all pages), e.g. one event's swimmers for heats.
document.getElementById('downloadCsv').onclick=run(async()=>{
  const params=new URLSearchParams([...new FormData(filters)].filter(([,value])=>value));
  await Admin.download('/api/admin/registrations.csv?'+params,'bsf-registrations.csv');
});
document.getElementById('previousPage').onclick=run(async()=>{page--;await loadRegistrations()});
document.getElementById('nextPage').onclick=run(async()=>{page++;await loadRegistrations()});
document.addEventListener('admin-payment-updated',run(async()=>{await Promise.all([overview(),loadRegistrations()])}));
document.addEventListener('admin-registration-updated',run(loadRegistrations));
run(load)();
// Admin manual entry: add a swimmer directly (phone, email, photo and payment screenshot optional).
const addDialog=document.createElement('dialog');addDialog.className='admin-dialog';addDialog.id='addParticipantDialog';addDialog.setAttribute('aria-labelledby','addParticipantTitle');
addDialog.innerHTML=`<div class="admin-dialog-header"><h2 id="addParticipantTitle">Add participant</h2><button type="button" class="secondary admin-close" aria-label="Close add participant">×</button></div>
<form id="addParticipantForm" class="admin-dialog-content add-participant-form" novalidate>
<label for="addFullName">Swimmer full name *</label><input id="addFullName" name="fullName" maxlength="120" required>
<label for="addSchool">School *</label><input id="addSchool" name="schoolName" maxlength="120" required>
<div class="grid"><div><label for="addGender">Gender *</label><select id="addGender" name="gender" required><option value="">Choose</option><option>Boys</option><option>Girls</option></select></div>
<div><label for="addDob">Date of birth *</label><input id="addDob" name="dob" type="date" required max="${new Date().toISOString().slice(0,10)}"></div></div>
<p id="addCategory" class="muted" role="status">Enter the date of birth to see the category and its events.</p><div id="addEvents"></div>
<div class="grid"><div><label for="addPhone">Parent phone</label><input id="addPhone" name="phone" inputmode="tel" placeholder="Optional"></div><div><label for="addEmail">Email</label><input id="addEmail" name="email" type="email" placeholder="Optional"></div></div>
<div class="grid"><div><label for="addPaymentStatus">Payment status</label><select id="addPaymentStatus" name="paymentStatus"><option>Pending</option><option>Verified</option></select></div><div><label for="addPaymentNote">Payment note / UTR</label><input id="addPaymentNote" name="paymentNote" maxlength="120" placeholder="e.g. Cash paid at desk"></div></div>
<div class="grid"><div><label for="addPhoto">Participant photo</label><input id="addPhoto" name="participantPhoto" type="file" accept="image/*"></div><div><label for="addProof">Payment screenshot</label><input id="addProof" name="paymentProof" type="file" accept="image/*"></div></div>
<div class="row"><button type="submit" id="addSubmit">Add participant</button></div><p id="addMessage" role="status"></p></form>`;
document.body.append(addDialog);
const addForm=addDialog.querySelector('form'),addMessage=document.getElementById('addMessage'),addEvents=document.getElementById('addEvents'),addCategory=document.getElementById('addCategory');
addDialog.querySelector('.admin-close').onclick=()=>addDialog.close();
const categoryFor=dob=>competitionConfig?.categories.find(c=>dob>=c.min&&dob<=c.max);
function renderAddEvents(){
  const dob=document.getElementById('addDob').value,c=dob&&categoryFor(dob);addEvents.replaceChildren();
  if(!dob){addCategory.textContent='Enter the date of birth to see the category and its events.';return}
  if(!c){addCategory.textContent='This date of birth is not eligible for any age category.';return}
  addCategory.innerHTML=`Category: <b>${esc(c.name)}</b> · choose events (max 4 individual, ₹300 each; relay ₹800)`;
  addEvents.innerHTML=`<fieldset class="dob-events"><legend>${esc(c.name)} events</legend>${c.events.map(e=>`<label><input type="checkbox" data-add-event value="${esc(e)}"> ${esc(c.eventLabels?.[e]||e)}</label>`).join('')}</fieldset>`;
}
document.getElementById('addDob').addEventListener('change',renderAddEvents);
document.getElementById('addParticipant').onclick=()=>{addForm.reset();addEvents.replaceChildren();renderAddEvents();addMessage.textContent='';addDialog.showModal();document.getElementById('addFullName').focus()};
async function submitAdd(allowDuplicate){
  const events=[...addEvents.querySelectorAll('[data-add-event]:checked')].map(box=>box.value);
  for(const [id,label] of [['addFullName','Swimmer name'],['addSchool','School'],['addGender','Gender'],['addDob','Date of birth']])if(!document.getElementById(id).value.trim()){addMessage.textContent=`${label} is required.`;return}
  if(!events.length){addMessage.textContent='Choose at least one event.';return}
  const fd=new FormData(addForm);fd.set('events',JSON.stringify(events));if(allowDuplicate)fd.set('allowDuplicate','true');
  for(const field of ['participantPhoto','paymentProof'])if(!fd.get(field)?.size)fd.delete(field);
  const button=document.getElementById('addSubmit');button.disabled=true;addMessage.textContent='Adding…';
  try{
    const response=await fetch('/api/admin/registrations',{method:'POST',body:fd});
    if(response.status===401)location.assign('/admin/');
    const data=await response.json().catch(()=>({error:'Invalid server response. Please retry.'}));
    if(response.status===409&&data.code==='POSSIBLE_DUPLICATE'){addMessage.textContent='';if(confirm(`${data.error}\nAdd another entry anyway?`))return submitAdd(true);addMessage.textContent=`Not added. Existing entry: ${data.registrationId}.`;return}
    if(!response.ok)throw new Error(data.error||'Could not add the participant.');
    const heats=data.placements.map(p=>p.notPlaced?`${esc(p.event)}: no heats yet (will be included when heats are created)`:`${esc(p.event)}: Heat ${p.heatNo}, Lane ${p.laneNo}`).join('<br>');
    addMessage.innerHTML=`<b>Added ${esc(data.registrationId)}</b> · ${esc(data.category)} · ₹${data.amount} · Payment ${esc(data.paymentStatus)}<br>${heats}<br><a href="${esc(data.ticketUrl)}" target="_blank" rel="noopener">Open ticket</a> (send this link to the parent)`;
    addForm.reset();addEvents.replaceChildren();renderAddEvents();
    await Promise.all([overview(),loadRegistrations()]);
  }catch(err){addMessage.textContent=err.message}
  finally{button.disabled=false}
}
addForm.addEventListener('submit',e=>{e.preventDefault();submitAdd(false)});

