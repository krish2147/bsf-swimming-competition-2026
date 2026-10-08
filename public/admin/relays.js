// Relay desk: build teams of four swimmers from the database, then time each team.
const {api,post,del,escape:esc,text,run,authenticated}=Admin;
const eventSelect=document.getElementById('relayEvent'),legsEl=document.getElementById('legs'),search=document.getElementById('swimmerSearch');
const candidatesEl=document.getElementById('candidates'),teamsEl=document.getElementById('teams'),msg=document.getElementById('teamMsg');
const teamName=document.getElementById('teamName'),teamHeat=document.getElementById('teamHeat'),teamLane=document.getElementById('teamLane');
let legs=[null,null,null,null],editingId=null,teams=[],searchVersion=0;

function renderLegs(){
  legsEl.innerHTML=legs.map((s,i)=>`<li class="relay-leg"><span class="relay-leg-no">Leg ${i+1}</span>${s?`<span class="relay-leg-name"><b>${esc(s.full_name)}</b><span class="muted"> · ${esc(s.school_name)} · ${esc(s.registration_id)}</span></span><button type="button" class="secondary" data-remove-leg="${i}" aria-label="Remove leg ${i+1}">Remove</button>`:'<span class="muted">Empty: search below and tap a swimmer</span>'}</li>`).join('');
}
function resetForm(){
  legs=[null,null,null,null];editingId=null;teamName.value='';teamHeat.value='';teamLane.value='';search.value='';candidatesEl.innerHTML='';msg.textContent='';
  document.getElementById('teamFormTitle').textContent='New team';renderLegs();
}
async function loadEvents(){
  const events=await api('/api/admin/relay-events');
  eventSelect.innerHTML=events.map(e=>`<option value="${esc(e.event_key)}">${esc(e.category)} ${esc(e.gender)} · ${esc(e.label)} (${e.teams} team${e.teams===1?'':'s'})</option>`).join('');
  const wanted=new URLSearchParams(location.search).get('event');if(wanted&&events.some(e=>e.event_key===wanted))eventSelect.value=wanted;
}
async function loadTeams(){
  const data=await api('/api/admin/relays?eventKey='+encodeURIComponent(eventSelect.value));teams=data.teams;
  teamsEl.innerHTML=teams.map(t=>`<article class="card relay-team" data-team="${esc(t.id)}">
    <div class="topbar"><div><h3>${esc(t.team_name)}</h3><p class="muted">Heat ${text(t.heat_no)} · Lane ${text(t.lane_no)}</p></div><div class="row"><button type="button" class="secondary" data-edit="${esc(t.id)}">Edit team</button><button type="button" class="secondary" data-delete="${esc(t.id)}">Delete</button></div></div>
    <ol class="relay-members">${t.members.map(m=>`<li><b>${esc(m.full_name)}</b> <span class="muted">· ${esc(m.school_name)}${m.registeredForRelay?'':' · not registered for relay'}</span></li>`).join('')}</ol>
    <div class="row"><input class="relay-time" aria-label="Team time" placeholder="e.g. 02:36.42" value="${esc(t.timing_text||'')}"><select class="relay-status" aria-label="Team status">${['TIME','DNS','DQ','PENDING'].map(s=>`<option ${t.status===s?'selected':''}>${s}</option>`).join('')}</select><button type="button" data-save-time="${esc(t.id)}">Save time</button></div>
    <p class="muted relay-state" role="status">${t.status==='PENDING'?'No time yet (shows as Absent)':t.status==='TIME'?(t.timing_text?'Saved ✓':'No time yet (shows as Absent)'):'Saved ✓ · '+esc(t.status)}</p></article>`).join('')||'<div class="notice">No teams yet for this relay. Make the first one above.</div>';
}
const findCandidates=run(async()=>{
  const term=search.value.trim(),version=++searchVersion;
  if(term.length<2){candidatesEl.innerHTML='';return}
  const rows=await api(`/api/admin/relay-candidates?eventKey=${encodeURIComponent(eventSelect.value)}&q=${encodeURIComponent(term)}`);
  if(version!==searchVersion)return;
  const inForm=new Set(legs.filter(Boolean).map(s=>s.registration_id)),editingName=editingId&&teams.find(t=>String(t.id)===String(editingId))?.team_name;
  candidatesEl.innerHTML=rows.map(r=>{const busy=r.team&&r.team!==editingName,chosen=inForm.has(r.registration_id);
    return `<li><button type="button" class="secondary relay-candidate" data-pick='${esc(JSON.stringify({registration_id:r.registration_id,full_name:r.full_name,school_name:r.school_name}))}' ${busy||chosen?'disabled':''}><b>${esc(r.full_name)}</b><span class="muted"> · ${esc(r.school_name)} · ${esc(r.registration_id)}</span>${r.registeredForRelay?' <span class="pill">Registered for relay</span>':''}${busy?` <span class="pill">In ${esc(r.team)}</span>`:''}${chosen?' <span class="pill">Added</span>':''}</button></li>`}).join('')||'<li class="muted">No swimmers in this age group and gender match that search.</li>';
});
let searchTimer;search.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(findCandidates,250)});
candidatesEl.addEventListener('click',e=>{
  const b=e.target.closest('[data-pick]');if(!b)return;const i=legs.findIndex(x=>!x);
  if(i<0){msg.textContent='All four legs are filled. Remove one to swap a swimmer.';return}
  legs[i]=JSON.parse(b.dataset.pick);renderLegs();findCandidates();
  if(!teamName.value.trim()&&i===0)teamName.value=legs[0].school_name;
});
legsEl.addEventListener('click',e=>{const b=e.target.closest('[data-remove-leg]');if(!b)return;legs[Number(b.dataset.removeLeg)]=null;renderLegs();findCandidates()});
document.getElementById('resetTeam').onclick=resetForm;
document.getElementById('saveTeam').onclick=run(async()=>{
  msg.textContent='';
  if(legs.some(x=>!x)){msg.textContent='Add four swimmers (legs 1 to 4) before saving.';return}
  await post('/api/admin/relays',{id:editingId,eventKey:eventSelect.value,teamName:teamName.value,heatNo:teamHeat.value,laneNo:teamLane.value,members:legs.map(x=>x.registration_id)});
  const saved=teamName.value.trim();resetForm();msg.textContent=`Saved ${saved} ✓`;await Promise.all([loadTeams(),refreshCounts()]);
});
teamsEl.addEventListener('click',run(async e=>{
  const edit=e.target.closest('[data-edit]'),remove=e.target.closest('[data-delete]'),save=e.target.closest('[data-save-time]');
  if(edit){
    const t=teams.find(x=>String(x.id)===edit.dataset.edit);editingId=t.id;teamName.value=t.team_name;teamHeat.value=t.heat_no??'';teamLane.value=t.lane_no??'';
    legs=[0,1,2,3].map(i=>{const m=t.members.find(x=>x.leg===i+1);return m?{registration_id:m.registration_id,full_name:m.full_name,school_name:m.school_name}:null});
    document.getElementById('teamFormTitle').textContent='Edit '+t.team_name;renderLegs();document.getElementById('teamForm').scrollIntoView({behavior:'smooth'});
  }else if(remove){
    const t=teams.find(x=>String(x.id)===remove.dataset.delete);
    if(!confirm(`Delete ${t.team_name}? Its time is deleted too.`))return;
    await del('/api/admin/relays/'+encodeURIComponent(t.id));await Promise.all([loadTeams(),refreshCounts()]);
  }else if(save){
    const card=save.closest('[data-team]'),state=card.querySelector('.relay-state');save.disabled=true;
    try{await post(`/api/admin/relays/${encodeURIComponent(save.dataset.saveTime)}/timing`,{timingText:card.querySelector('.relay-time').value,status:card.querySelector('.relay-status').value});const status=card.querySelector('.relay-status');if(status.value==='PENDING'&&card.querySelector('.relay-time').value.trim())status.value='TIME';state.textContent='Saved ✓'}
    catch(err){state.textContent=err.message;throw err}finally{save.disabled=false}
  }
}));
async function refreshCounts(){const v=eventSelect.value;await loadEvents();eventSelect.value=v}
eventSelect.addEventListener('change',run(async()=>{resetForm();history.replaceState(null,'','?event='+encodeURIComponent(eventSelect.value));await loadTeams()}));
run(async()=>{if(!await authenticated())return;renderLegs();await loadEvents();await loadTeams()})();
