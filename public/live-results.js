// Public live results: overall standings across heats (provisional) and the official podium once published.
(()=>{
  const out=document.getElementById('out'),status=document.getElementById('liveStatus'),search=document.getElementById('resultSearch');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const medal=p=>p===1?'🥇':p===2?'🥈':p===3?'🥉':'';
  let data=[];
  const matches=(term,s)=>!term||`${s.full_name} ${s.school_name}`.toLowerCase().includes(term);
  function render(){
    const term=search.value.trim().toLowerCase();
    if(!data.length){out.className='notice';out.textContent='Results will appear here live as soon as each event is timed.';return}
    const events=data.filter(e=>!term||[...e.standings,...e.official,...e.notFinished].some(s=>matches(term,s)));
    if(!events.length){out.className='notice';out.textContent='No results match your search yet.';return}
    out.className='';out.innerHTML=events.map(e=>{
      const official=e.published&&e.official.length;
      const podium=official?e.official.map(p=>({rank:p.position,...p})):e.standings.filter(s=>s.rank<=3);
      const rest=e.standings.filter(s=>official||s.rank>3);
      const row=s=>`<tr class="${matches(term,s)&&term?'result-hit':''}"><td>${s.rank??'—'}</td><td>${esc(s.full_name)}<div class="muted live-school">${esc(s.school_name)}</div></td><td class="live-time">${esc(s.timing_text||s.status||'—')}</td></tr>`;
      return `<section class="card live-event"><div class="live-event-head"><div><h2>${esc(e.meta.label)}</h2><p class="muted">${esc(e.meta.category)} • ${esc(e.meta.gender)}</p></div><span class="pill ${official?'official-pill':'live-pill'}">${official?'Official':'Live · provisional'}</span></div>
        <div class="podium">${podium.map(p=>`<div class="podium-row"><span class="podium-medal" aria-label="Position ${p.rank}">${medal(p.rank)||p.rank}</span><div><b>${esc(p.full_name)}</b><div class="muted live-school">${esc(p.school_name)}</div></div><span class="live-time">${esc(p.timing_text||'')}</span></div>`).join('')||'<p class="muted">Waiting for times…</p>'}</div>
        ${rest.length||e.notFinished.length?`<details class="all-results"><summary>All swimmers (${e.standings.length+e.notFinished.length})</summary><table class="live-table"><thead><tr><th>Pos</th><th>Swimmer</th><th>Time</th></tr></thead><tbody>${e.standings.map(row).join('')}${e.notFinished.map(row).join('')}</tbody></table></details>`:''}
      </section>`}).join('');
  }
  async function load(){
    try{const response=await fetch('/api/public/results',{cache:'no-store'});if(!response.ok)throw Error();data=await response.json();render();
      status.textContent='Updated '+new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · refreshes automatically';
    }catch{status.textContent='Could not refresh — retrying…'}
  }
  search.addEventListener('input',render);
  load();setInterval(()=>{if(!document.hidden)load()},20000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
})();
