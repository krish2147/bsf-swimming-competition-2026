const {api,post,escape:esc,text,run}=Admin;
const eventSelect=document.getElementById('event'),heat=document.getElementById('heat'),lanes=document.getElementById('lanes'),heatInfo=document.getElementById('heatInfo');
window.seedHeats=run(async()=>{
 if(!eventSelect.value)throw Error('Select an event first.');
 if(!confirm('Create heat/lane assignments for this event? Existing heat assignments will be reset.'))return;
 const data=await post('/api/admin/seed-heats',{eventKey:eventSelect.value,lanes:Number(lanes.value)});
 heat.value=1;await loadHeat();heatInfo.textContent=`${data.participants} swimmers arranged into ${data.heats} heat(s)${data.heatSizes?.length?` of ${data.heatSizes.join(' / ')} swimmers`:''}.`;
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

// Heat builder: arrange the event's registered swimmers into heats/lanes on this page, adjust, then save.
const builder=document.getElementById('heatBuilder'),include=document.getElementById('heatInclude'),order=document.getElementById('heatOrder');
let builderEvent=null;
const clearBuilder=()=>{builderEvent=null;builder.replaceChildren()};
const byName=(a,b)=>String(a.fullName||'').localeCompare(String(b.fullName||''),'en',{sensitivity:'base'});
const sorters={registration:()=>0,name:byName,school:(a,b)=>String(a.schoolName||'').localeCompare(String(b.schoolName||''),'en',{sensitivity:'base'})||byName(a,b)};
const included={all:()=>true,verified:s=>s.paymentStatus==='Verified',checked:s=>s.checkinStatus==='Approved'};
async function builderSwimmers(){
 if(!eventSelect.value)throw Error('Select an event first.');
 return (await api('/api/admin/heat-builder?eventKey='+encodeURIComponent(eventSelect.value))).swimmers;
}
function renderBuilder(swimmers,note){
 builderEvent=eventSelect.value;
 const placed=swimmers.filter(s=>s.heatNo).sort((a,b)=>a.heatNo-b.heatNo||a.laneNo-b.laneNo),unplaced=swimmers.filter(s=>!s.heatNo);
 const heats=new Set(placed.map(s=>s.heatNo)).size;
 const row=s=>`<tr data-builder-row="${esc(s.registrationId)}"><td><input class="heat-no" type="number" min="1" inputmode="numeric" aria-label="Heat for ${esc(s.fullName)}" value="${s.heatNo??''}"></td><td><input class="lane-no" type="number" min="1" max="10" inputmode="numeric" aria-label="Lane for ${esc(s.fullName)}" value="${s.laneNo??''}"></td><td>${text(s.fullName)}<div class="muted">${text(s.registrationId)}</div></td><td>${text(s.schoolName)}</td><td>${text(s.paymentStatus)}</td><td>${text(s.checkinStatus)}</td></tr>`;
 builder.innerHTML=swimmers.length?`<p><b>${placed.length} swimmer(s) in ${heats} heat(s)</b> — ${esc(note)}${unplaced.length?` ${unplaced.length} swimmer(s) not in a heat are listed at the bottom.`:''}</p><div class="admin-table-scroll"><table><thead><tr><th>Heat</th><th>Lane</th><th>Swimmer</th><th>School</th><th>Payment</th><th>Check-in</th></tr></thead><tbody>${placed.map(row).join('')}${unplaced.length?`<tr class="heat-builder-divider"><td colspan="6">Not in a heat</td></tr>${unplaced.map(row).join('')}`:''}</tbody></table></div><div class="row"><button type="button" class="good" id="saveHeats">Save heats</button><button type="button" class="secondary" id="cancelHeats">Cancel</button></div>`:'<p class="notice">No swimmers are registered for this event.</p>';
 document.getElementById('cancelHeats')?.addEventListener('click',clearBuilder);
 document.getElementById('saveHeats')?.addEventListener('click',saveHeats);
}
document.getElementById('arrangeHeats').onclick=run(async()=>{
 const size=Number(lanes.value);
 if(!Number.isInteger(size)||size<1||size>10)throw Error('Lanes per heat must be from 1 to 10.');
 const swimmers=await builderSwimmers(),picked=swimmers.filter(included[include.value]).sort(sorters[order.value]);
 const slots=BSFHeatLayout.assignHeats(picked.length,size),slot=new Map(picked.map((s,i)=>[s.registrationId,slots[i]]));
 renderBuilder(swimmers.map(s=>({...s,heatNo:null,laneNo:null,...slot.get(s.registrationId)})),`arranged into heats of ${BSFHeatLayout.heatSizes(picked.length,size).join(' / ')} swimmers, ${size} lanes per heat (${include.selectedOptions[0].text.toLowerCase()}, ${order.selectedOptions[0].text}). Not saved yet.`);
});
document.getElementById('editSavedHeats').onclick=run(async()=>{
 const swimmers=await builderSwimmers();
 if(!swimmers.some(s=>s.heatNo))throw Error('No heats are saved for this event yet. Use Arrange heats.');
 renderBuilder(swimmers,'the heats currently saved for this event.');
});
const saveHeats=run(async()=>{
 if(builderEvent!==eventSelect.value)throw Error('The event changed. Arrange the heats again before saving.');
 const entries=[],incomplete=[];let skipped=0;
 for(const tr of builder.querySelectorAll('[data-builder-row]')){
  const heatNo=tr.querySelector('.heat-no').value.trim(),laneNo=tr.querySelector('.lane-no').value.trim();
  if(!heatNo&&!laneNo){skipped++;continue}
  if(!heatNo||!laneNo){incomplete.push(tr.children[2].firstChild.textContent);continue}
  entries.push({registrationId:tr.dataset.builderRow,heatNo:Number(heatNo),laneNo:Number(laneNo)});
 }
 if(incomplete.length)throw Error(`Fill in both Heat and Lane for: ${incomplete.join(', ')}.`);
 if(!confirm(`Save ${entries.length} swimmer(s) into heats?${skipped?` ${skipped} swimmer(s) will not be in any heat.`:''} Existing heats for this event will be replaced.`))return;
 const data=await post('/api/admin/save-heats',{eventKey:eventSelect.value,entries});
 clearBuilder();heat.value=1;await loadHeat();
 heatInfo.textContent=`Heats saved: ${data.participants} swimmers in ${data.heats} heat(s). Showing heat 1.`;
});
for(const control of [eventSelect,lanes])control.addEventListener('change',clearBuilder);
// Printable heat sheets for timekeepers (all saved heats of the selected event).
for(const [id,format] of [['heatSheetPdf','pdf'],['heatSheetWord','docx']])document.getElementById(id).onclick=run(async()=>{
 if(!eventSelect.value)throw Error('Select an event first.');
 await Admin.download('/api/admin/heat-sheet?'+new URLSearchParams({eventKey:eventSelect.value,format}),'heat-sheet.'+format);
});
