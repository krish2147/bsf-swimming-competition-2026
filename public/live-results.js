// Public live results: choose Age group → Gender → Event, then see that event's result from the heat list and the timings
// across all heats (fastest first, medals for the top three). "Live · provisional" until published, then the official podium.
(()=>{
  const out=document.getElementById('out'),status=document.getElementById('liveStatus');
  const endpoint=document.body.dataset.resultsEndpoint||'/api/public/results';
  const pick={category:document.getElementById('pickCategory'),gender:document.getElementById('pickGender'),event:document.getElementById('pickEvent')};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const medal=p=>p===1?'🥇':p===2?'🥈':p===3?'🥉':'';
  let data=[],chosen=new URLSearchParams(location.hash.slice(1));
  const unique=list=>[...new Set(list)];
  function fill(select,values,label,current){
    select.innerHTML=values.map(v=>`<option value="${esc(v.value??v)}">${esc(v.label??v)}</option>`).join('');
    select.disabled=!values.length;if(!values.length)select.innerHTML=`<option>${esc(label)}</option>`;
    if(values.some(v=>(v.value??v)===current))select.value=current;
  }
  function syncPickers(){
    fill(pick.category,unique(data.map(e=>e.meta.category)),'Heats not out yet',pick.category.value||chosen.get('category'));
    fill(pick.gender,unique(data.filter(e=>e.meta.category===pick.category.value).map(e=>e.meta.gender)),'—',pick.gender.value||chosen.get('gender'));
    fill(pick.event,data.filter(e=>e.meta.category===pick.category.value&&e.meta.gender===pick.gender.value).map(e=>({value:e.event_key,label:e.meta.label})),'—',pick.event.value||chosen.get('event'));
  }
  function render(){
    const e=data.find(x=>x.event_key===pick.event.value);
    if(!data.length){out.className='notice';out.textContent='Results will appear here once the heat list is out.';return}
    if(!e){out.className='notice';out.textContent='Choose an age group, gender and event.';return}
    history.replaceState(null,'','#'+new URLSearchParams({category:e.meta.category,gender:e.meta.gender,event:e.event_key}));
    const lane=s=>`<td>${esc(s.heat_no)}${s.lane_no?' · '+esc(s.lane_no):''}</td>`;
    const official=e.published&&e.official.length;
    const podium=official?e.official.map(p=>({rank:p.position,...p})):e.standings.filter(s=>s.rank<=3);
    out.className='';out.innerHTML=`<section class="card live-event"><div class="live-event-head"><div><h2>${esc(e.meta.label)}</h2><p class="muted">${esc(e.meta.category)} • ${esc(e.meta.gender)} · ${e.standings.length} of ${e.standings.length+e.notFinished.length+e.awaiting.length} timed</p></div><span class="pill ${official?'official-pill':'live-pill'}">${official?'Official':'Live · provisional'}</span></div>
      <div class="podium">${podium.map(p=>`<div class="podium-row podium-${p.rank}"><span class="podium-medal" aria-label="Position ${p.rank}">${medal(p.rank)||p.rank}</span><div><b>${esc(p.full_name)}</b><div class="muted live-school">${esc(p.school_name)}</div></div><span class="live-time">${esc(p.timing_text||'')}</span></div>`).join('')||'<p class="muted">Waiting for times…</p>'}</div>
      <h3>Full result</h3><table class="live-table"><thead><tr><th>Pos</th><th>Swimmer</th><th>Heat · Lane</th><th>Time</th></tr></thead><tbody>
      ${e.standings.map(s=>`<tr><td>${medal(s.rank)||s.rank}</td><td>${esc(s.full_name)}<div class="muted live-school">${esc(s.school_name)}</div></td>${lane(s)}<td class="live-time">${esc(s.timing_text)}</td></tr>`).join('')}
      ${e.notFinished.map(s=>`<tr class="muted"><td>—</td><td>${esc(s.full_name)}<div class="live-school">${esc(s.school_name)}</div></td>${lane(s)}<td class="live-time">${esc(s.status)}</td></tr>`).join('')}
      ${e.awaiting.map(s=>`<tr class="muted"><td>—</td><td>${esc(s.full_name)}<div class="live-school">${esc(s.school_name)}</div></td>${lane(s)}<td class="live-absent">Absent</td></tr>`).join('')}
      </tbody></table></section>`;
  }
  async function load(){
    try{const response=await fetch(endpoint,{cache:'no-store'});if(response.status===401){location.assign('/admin/');return}if(!response.ok)throw Error();let json=await response.json();
      // Admin preview: {publicOpen, events} — always shows the results, and says whether the public can see them yet.
      if(json&&Array.isArray(json.events)){const note=document.getElementById('previewState');if(note)note.textContent=json.publicOpen?'The public Results page is OPEN — everyone can see these results.':'The public Results page is CLOSED — only admins can see this preview.';json=json.events}
      if(json&&json.closed){for(const el of document.querySelectorAll('.result-pickers,.live-badge,#resultsIntro'))el.classList.add('hidden');out.className='notice';out.textContent='Results are closed. Please check with the organisers at the venue.';status.textContent='';return}
      for(const el of document.querySelectorAll('.result-pickers,.live-badge,#resultsIntro'))el.classList.remove('hidden');data=json;syncPickers();render();
      status.textContent='Updated '+new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · refreshes automatically';
    }catch{status.textContent='Could not refresh — retrying…'}
  }
  for(const select of Object.values(pick))select.addEventListener('change',()=>{chosen=new URLSearchParams();if(select!==pick.event){if(select===pick.category)pick.gender.value='';pick.event.value=''}syncPickers();render()});
  load();setInterval(()=>{if(!document.hidden)load()},20000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
})();
