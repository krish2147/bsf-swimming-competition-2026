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
