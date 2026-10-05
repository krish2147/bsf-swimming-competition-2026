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
    const g=c.group,word='CONGRATULATIONS',medalWords=[c.gold&&`${c.gold} gold`,c.silver&&`${c.silver} silver`,c.bronze&&`${c.bronze} bronze`].filter(Boolean);
    dialog.innerHTML=`<div class="congrats-card"><button type="button" class="congrats-close" data-close aria-label="Close">×</button>
      <div class="congrats-brand"><img src="/bsf-logo.jpeg" alt=""><span>3rd Inter-School<br>Swimming 2026</span></div>
      <i class="confetti c1"></i><i class="confetti c2"></i><i class="confetti c3"></i><i class="confetti c4"></i>
      <div class="congrats-hero"><div class="congrats-word" aria-hidden="true"><span>${word}</span><span>${word}</span><span>${word}</span></div>
        ${c.photo?`<img class="champion-dialog-photo congrats-photo" src="${esc(c.photo)}" alt="Photo of ${esc(c.full_name)}">`:'<div class="champion-dialog-trophy congrats-photo" aria-hidden="true">🏊</div>'}
        <span class="congrats-trophy" aria-hidden="true">🏆</span></div>
      <h2 id="championName" class="congrats-name">${esc(c.full_name)}</h2>
      <div class="congrats-title">Best Swimmer${c.shared?' (shared)':''} · ${esc(g.category)} ${esc(g.gender)}</div>
      <p class="congrats-text">With great pride, we congratulate <b>${esc(c.full_name)}</b> of ${esc(c.school_name)} on being crowned <b>Best Swimmer</b> of the ${esc(g.category)} ${esc(g.gender)} category — winning <b>${medalWords.join(', ')}</b> for <b>${c.points} points</b>. A truly outstanding swim!</p>
      <ul class="congrats-times">${c.medals.map(m=>`<li><span>${medal[m.position]} ${({1:'1st',2:'2nd',3:'3rd'})[m.position]}</span><span>${esc(m.event)}</span><b>${esc(m.time||'—')}</b></li>`).join('')}</ul>
      <div class="congrats-foot"><div class="congrats-logos"><span><img src="/aark-logo.png" alt="AARK International School"></span><span><img src="/bsf-logo.jpeg" alt="Baroda Swim Front"></span></div><div class="congrats-where">AARK International School<br>× Baroda Swim Front<br>Vadodara · 4 October 2026</div></div>
    </div>`;
    dialog.addEventListener('error',ev=>{if(ev.target.matches?.('.champion-dialog-photo'))ev.target.replaceWith(Object.assign(document.createElement('div'),{className:'champion-dialog-trophy congrats-photo',textContent:'🏊'}))},{capture:true,once:true});
    if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  });
  // A missing or broken photo falls back to the trophy.
  out.addEventListener('error',e=>{const img=e.target;if(img?.matches?.('img.champion-photo')){img.parentNode.classList.add('no-photo');img.remove()}},true);
  load();setInterval(()=>{if(!document.hidden)load()},20000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
})();
