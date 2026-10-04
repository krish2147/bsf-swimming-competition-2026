// Public live timings: refreshes every 20 seconds; events are "Live · provisional" until published, then "Official".
(()=>{
  const out=document.getElementById('out'),status=document.getElementById('liveStatus'),search=document.getElementById('timingSearch');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const seconds=t=>BSFTimingSeconds(t)??Infinity;
  const rank=r=>r.status==='TIME'?seconds(r.timing_text):r.status==='DNS'?1e9:2e9;
  let data=[];
  function render(){
    const term=search.value.trim().toLowerCase(),rows=term?data.filter(r=>`${r.full_name} ${r.school_name}`.toLowerCase().includes(term)):data;
    if(!data.length){out.className='notice';out.textContent='Race timings will appear here live as soon as each heat is timed.';return}
    if(!rows.length){out.className='notice';out.textContent='No timings match your search yet.';return}
    const events=new Map();
    for(const r of rows){if(!events.has(r.event_key))events.set(r.event_key,{meta:r.meta,order:r.order,published:r.published,heats:new Map()});const e=events.get(r.event_key);if(!e.heats.has(r.heat_no))e.heats.set(r.heat_no,[]);e.heats.get(r.heat_no).push(r)}
    out.className='';out.innerHTML=[...events.values()].sort((a,b)=>a.order-b.order).map(e=>`<section class="card live-event"><div class="live-event-head"><div><h2>${esc(e.meta.label)}</h2><p class="muted">${esc(e.meta.category)} • ${esc(e.meta.gender)}</p></div><span class="pill ${e.published?'official-pill':'live-pill'}">${e.published?'Official':'Live · provisional'}</span></div>${[...e.heats.entries()].sort((a,b)=>a[0]-b[0]).map(([heat,list])=>`<h3>Heat ${esc(heat)}</h3><table class="live-table"><thead><tr><th>Pos</th><th>Swimmer</th><th>Time</th><th>Lane</th></tr></thead><tbody>${list.sort((a,b)=>rank(a)-rank(b)).map((r,i)=>`<tr><td>${r.status==='TIME'?i+1:'—'}</td><td>${esc(r.full_name)}<div class="muted live-school">${esc(r.school_name)}</div></td><td class="live-time">${r.status==='TIME'?esc(r.timing_text):esc(r.status)}</td><td>${r.lane_no?esc(r.lane_no):'—'}</td></tr>`).join('')}</tbody></table>`).join('')}</section>`).join('');
  }
  async function load(){
    try{
      const response=await fetch('/api/public/timings',{cache:'no-store'});if(!response.ok)throw Error();
      data=await response.json();render();
      status.textContent='Updated '+new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · refreshes automatically';
    }catch{status.textContent='Could not refresh — retrying…'}
  }
  search.addEventListener('input',render);
  load();setInterval(()=>{if(!document.hidden)load()},20000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
})();
