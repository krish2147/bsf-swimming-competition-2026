// Best swimmers: the champion (🏆) and medal table for each age group and gender. Refreshes every 20 seconds.
(()=>{
  const out=document.getElementById('out'),status=document.getElementById('liveStatus'),pick=document.getElementById('pickAgeGroup');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const medal={1:'🥇',2:'🥈',3:'🥉'};
  let data=[],champs=[];
  function fillPicker(){
    const groups=[...new Set(data.map(g=>g.category))],current=pick.value||new URLSearchParams(location.hash.slice(1)).get('age')||'';
    pick.innerHTML='<option value="">All age groups</option>'+groups.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if(groups.includes(current))pick.value=current;
  }
  function render(){
    const shown=data.filter(g=>!pick.value||g.category===pick.value);
    if(!data.length){out.className='notice';out.textContent='Best swimmers will appear here once events have medal winners.';return}
    history.replaceState(null,'',pick.value?'#'+new URLSearchParams({age:pick.value}):location.pathname);
    champs=[];
    out.className='';out.innerHTML=shown.map(g=>{
      const champions=g.swimmers.filter(s=>s.rank===1);
      return `<section class="card live-event best-group"><div class="live-event-head"><div><h2>${esc(g.category)} • ${esc(g.gender)}</h2><p class="muted">${g.swimmers.length} medal winner(s)</p></div></div>
      <div class="champion">${champions.map(s=>{const i=champs.push({...s,group:g,shared:champions.length>1})-1;return `<button type="button" class="champion-row" data-champion="${i}" aria-label="Open ${esc(s.full_name)}'s card">${s.photo?`<span class="champion-photo-wrap"><img class="champion-photo" src="${esc(s.photo)}" alt="Photo of ${esc(s.full_name)}" loading="lazy"><span class="champion-badge" aria-hidden="true">🏆</span></span>`:'<span class="champion-trophy" aria-hidden="true">🏆</span>'}<span class="champion-info"><span class="eyebrow">Best Swimmer${champions.length>1?' (shared)':''}</span><b>${esc(s.full_name)}</b><span class="muted live-school">${esc(s.school_name)}</span><span class="champion-medals">${s.medals.map(m=>`${medal[m.position]} ${esc(m.event)}`).join(' · ')}</span><span class="champion-open">Tap to see times →</span></span><span class="live-time">${s.points} pts</span></button>`}).join('')}</div>
      <table class="live-table"><thead><tr><th>Rank</th><th>Swimmer</th><th>🥇</th><th>🥈</th><th>🥉</th><th>Pts</th></tr></thead><tbody>
      ${g.swimmers.map(s=>`<tr><td>${s.rank===1?'🏆':s.rank}</td><td>${esc(s.full_name)}<div class="muted live-school">${esc(s.school_name)}</div></td><td>${s.gold}</td><td>${s.silver}</td><td>${s.bronze}</td><td class="live-time">${s.points}</td></tr>`).join('')}
      </tbody></table></section>`}).join('');
  }
  async function load(){
    try{const response=await fetch('/api/public/best-swimmers',{cache:'no-store'});if(!response.ok)throw Error();const json=await response.json();
      const closed=!!(json&&json.closed);for(const el of document.querySelectorAll('#bestFilter,#bestIntro'))el.classList.toggle('hidden',closed);
      if(closed){out.className='notice';out.textContent='Best swimmers will be announced soon. Please check back later.';status.textContent='';return}
      data=json;fillPicker();render();
      status.textContent='Updated '+new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · refreshes automatically';
    }catch{status.textContent='Could not refresh — retrying…'}
  }
  pick.addEventListener('change',render);
  // Champion card: tap to open a bigger card with the full photo and the time in every event they won.
  const dialog=document.createElement('dialog');dialog.className='champion-dialog';dialog.setAttribute('aria-labelledby','championName');document.body.append(dialog);
  dialog.addEventListener('click',e=>{if(e.target===dialog||e.target.closest('[data-close]'))dialog.close()});
  out.addEventListener('click',e=>{
    const row=e.target.closest('[data-champion]');if(!row)return;const c=champs[Number(row.dataset.champion)];if(!c)return;
    dialog.innerHTML=`<div class="champion-dialog-body"><button type="button" class="secondary champion-close" data-close aria-label="Close">×</button>
      ${c.photo?`<img class="champion-dialog-photo" src="${esc(c.photo)}" alt="Photo of ${esc(c.full_name)}">`:'<div class="champion-dialog-trophy" aria-hidden="true">🏆</div>'}
      <div class="eyebrow">🏆 Best Swimmer${c.shared?' (shared)':''} · ${esc(c.group.category)} • ${esc(c.group.gender)}</div>
      <h2 id="championName">${esc(c.full_name)}</h2><p class="muted">${esc(c.school_name)}</p>
      <table class="live-table"><thead><tr><th>Medal</th><th>Event</th><th>Time</th></tr></thead><tbody>
      ${c.medals.map(m=>`<tr><td>${medal[m.position]} ${({1:'1st',2:'2nd',3:'3rd'})[m.position]}</td><td>${esc(m.event)}</td><td class="live-time">${esc(m.time||'—')}</td></tr>`).join('')}
      </tbody></table><p class="champion-points"><b>${c.points}</b> points · 🥇 ${c.gold} · 🥈 ${c.silver} · 🥉 ${c.bronze}</p></div>`;
    dialog.addEventListener('error',ev=>{if(ev.target.matches?.('.champion-dialog-photo'))ev.target.replaceWith(Object.assign(document.createElement('div'),{className:'champion-dialog-trophy',textContent:'🏆'}))},{capture:true,once:true});
    if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  });
  // A missing or broken photo falls back to the trophy.
  out.addEventListener('error',e=>{const img=e.target;if(img?.matches?.('img.champion-photo')){img.parentNode.classList.add('no-photo');img.remove()}},true);
  load();setInterval(()=>{if(!document.hidden)load()},20000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
})();
