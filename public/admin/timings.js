const {api,post,escape:esc,text,run}=Admin;
const eventSelect=document.getElementById('event'),heat=document.getElementById('heat'),lanes=document.getElementById('lanes'),heatInfo=document.getElementById('heatInfo');
window.seedHeats=run(async()=>{
 if(!eventSelect.value)throw Error('Select an event first.');
 if(!confirm('Create heat/lane assignments for this event? Existing heat assignments will be reset.'))return;
 const data=await post('/api/admin/seed-heats',{eventKey:eventSelect.value,lanes:Number(lanes.value)});
 heat.value=1;await loadHeat();heatInfo.textContent=`${data.participants} swimmers arranged into ${data.heats} heat(s).`;
});
window.loadHeat=run(async()=>{
 if(!eventSelect.value)return;
 const d=await api(`/api/admin/race-card?eventKey=${encodeURIComponent(eventSelect.value)}&heatNo=${encodeURIComponent(heat.value)}`);
 heatInfo.textContent=d.heatCount?`Heat ${heat.value} of ${d.heatCount}`:'No heat assignments yet. Click Create / Reset Heats.';
 document.getElementById('list').innerHTML=d.rows.map(p=>`<div class="card" data-timing-row="${esc(p.registration_id)}"><div class="topbar"><div><span class="pill">Lane ${text(p.lane_no)}</span> <button class="secondary" type="button" data-participant="${esc(p.registration_id)}">${text(p.full_name)}</button><div class="muted">${text(p.school_name)}</div></div><span class="pill timing-state">${p.updated_at?'Saved ✓':'Not saved'}</span></div><div class="row"><input class="timing-value" aria-label="Timing" placeholder="e.g. 00:36.42" value="${esc(p.timing_text)}"><select class="timing-status" aria-label="Timing status">${['TIME','DNS','DQ','PENDING'].map(status=>`<option ${p.status===status?'selected':''}>${status}</option>`).join('')}</select><button type="button" data-save-timing>Save</button></div></div>`).join('')||'<div class="notice">No swimmers assigned to this heat.</div>';
});
document.getElementById('list').addEventListener('click',run(async e=>{
 const button=e.target.closest('[data-save-timing]');if(!button)return;const row=button.closest('[data-timing-row]'),state=row.querySelector('.timing-state');
 button.disabled=true;state.textContent='Saving…';
 try{await post('/api/admin/timing',{eventKey:eventSelect.value,heatNo:Number(heat.value),registrationId:row.dataset.timingRow,timingText:row.querySelector('.timing-value').value,status:row.querySelector('.timing-status').value});state.textContent='Saved ✓'}catch(err){state.textContent='Save failed';throw err}finally{button.disabled=false}
}));
eventSelect.addEventListener('change',()=>{document.getElementById('list').replaceChildren();heatInfo.textContent='';heat.value=1});
run(async()=>{if(!await Admin.authenticated())return;const events=await api('/api/admin/events');eventSelect.innerHTML='<option value="">Select event</option>'+events.map(e=>`<option value="${esc(e.key)}">${text(e.category)} • ${text(e.gender)} • ${text(e.event)} (${e.count})</option>`).join('')})();

// CSV heat import: download the event's swimmers, fill Heat/Lane in Excel (optional), preview, then save.
const csvInput=document.getElementById('heatCsv'),preview=document.getElementById('heatPreview');
let previewed=null;
const clearPreview=()=>{previewed=null;preview.replaceChildren()};
const importUrl=dryRun=>`/api/admin/import-heats?${new URLSearchParams({eventKey:eventSelect.value,lanes:lanes.value,dryRun:dryRun?'1':'0'})}`;
async function sendHeats(csv,dryRun){
 const response=await fetch(importUrl(dryRun),{method:'POST',headers:{'Content-Type':'text/csv'},body:csv});
 const data=await response.json().catch(()=>({error:'Invalid server response. Please retry.'}));
 if(response.status===401)location.assign('/admin/');
 return {ok:response.ok,data};
}
const missingNote=missing=>missing.length?`<p class="notice">${missing.length} swimmer(s) registered for this event are not in the CSV and will not be placed in any heat: ${missing.map(m=>`${esc(m.fullName)} (${esc(m.registrationId)})`).join(', ')}</p>`:'';
document.getElementById('downloadEventCsv').onclick=run(async()=>{
 if(!eventSelect.value)throw Error('Select an event first.');
 const [category,gender,event]=eventSelect.value.split('|||');
 await Admin.download('/api/admin/registrations.csv?'+new URLSearchParams({category,gender,event}),'bsf-heats.csv');
});
document.getElementById('previewHeats').onclick=run(async()=>{
 clearPreview();
 if(!eventSelect.value)throw Error('Select an event first.');
 const file=csvInput.files[0];if(!file)throw Error('Choose the CSV file to upload.');
 const csv=await file.text(),{ok,data}=await sendHeats(csv,true);
 if(!ok){preview.innerHTML=`<div class="notice admin-error"><b>${esc(data.error||'Import failed.')}</b>${data.errors?.length?`<ul>${data.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`:''}</div>`;return}
 previewed={csv,eventKey:eventSelect.value};
 const heats=[...new Set(data.entries.map(e=>e.heatNo))];
 preview.innerHTML=`<p><b>${data.participants} swimmer(s) in ${data.heats} heat(s)</b> — ${data.mode==='csv'?'using the Heat and Lane columns from the CSV':`arranged in CSV row order, ${esc(lanes.value)} lanes per heat`}.</p>${missingNote(data.missing)}${heats.map(h=>`<h3>Heat ${h}</h3><div class="admin-table-scroll"><table data-preview-heat="${h}"><thead><tr><th>Lane</th><th>Swimmer</th><th>School</th><th>Registration ID</th></tr></thead><tbody>${data.entries.filter(e=>e.heatNo===h).map(e=>`<tr><td>${e.laneNo}</td><td>${text(e.fullName)}</td><td>${text(e.schoolName)}</td><td>${text(e.registrationId)}</td></tr>`).join('')}</tbody></table></div>`).join('')}<div class="row"><button type="button" class="good" id="saveHeats">Save these heats</button><button type="button" class="secondary" id="cancelHeats">Cancel</button></div>`;
 document.getElementById('cancelHeats').onclick=clearPreview;
 document.getElementById('saveHeats').onclick=run(async()=>{
  if(!previewed||previewed.eventKey!==eventSelect.value)throw Error('Preview the CSV again before saving.');
  if(!confirm('Save these heats? Existing heat assignments for this event will be replaced.'))return;
  const {ok,data}=await sendHeats(previewed.csv,false);
  if(!ok)throw Error([data.error,...(data.errors||[])].filter(Boolean).join(' '));
  clearPreview();csvInput.value='';heat.value=1;await loadHeat();
  heatInfo.textContent=`Imported from CSV: ${data.participants} swimmers in ${data.heats} heat(s). Showing heat 1.`;
 });
});
for(const input of [csvInput,lanes])input.addEventListener('change',clearPreview);
eventSelect.addEventListener('change',clearPreview);
