// Baroda Swim Front events. To add an event, add an entry to EVENTS: it shows under "Upcoming" until its date has
// passed, then under "Completed". Links are optional (e.g. a Register link for an upcoming event).
const EVENTS=[
  {
    title:'3rd Inter-School Swimming Competition 2026',
    partner:'In association with AARK International School, Vadodara',
    date:'2026-10-04',
    venue:'Vadodara, Gujarat',
    badge:'Our first event',
    summary:'Swimmers from schools across Vadodara raced in every age group from Under-6 to Under-17 — freestyle, backstroke, breaststroke, butterfly, medley and relays.',
    logos:['/aark-logo.png','/bsf-logo.jpeg'],
    links:[
      {label:'🏅 Results',href:'/results.html'},
      {label:'🏆 Best Swimmers',href:'/best-swimmers.html'},
      {label:'⏱️ Timings',href:'/timings.html'},
      {label:'📜 Certificates',href:'/find-ticket.html'},
    ],
  },
];
(()=>{
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  const fmt=d=>new Date(d+'T00:00:00+05:30').toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const tile=d=>{const x=new Date(d+'T00:00:00+05:30');return `<div class="event-date" aria-hidden="true"><b>${x.toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric'})}</b><span>${x.toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',month:'short'})}</span><small>${x.getFullYear()}</small></div>`};
  const card=(e,done)=>`<article class="card event-card">${tile(e.date)}<div class="event-body">
    <div class="event-tags">${e.badge?`<span class="pill event-badge">${esc(e.badge)}</span>`:''}<span class="pill ${done?'event-done':'event-soon'}">${done?'Completed':'Upcoming'}</span></div>
    <h3>${esc(e.title)}</h3>${e.partner?`<p class="muted event-partner">${esc(e.partner)}</p>`:''}
    <p class="event-meta">📅 ${esc(fmt(e.date))} · 📍 ${esc(e.venue)}</p>${e.summary?`<p>${esc(e.summary)}</p>`:''}
    ${e.links?.length?`<div class="event-links">${e.links.map(l=>`<a class="btn secondary" href="${esc(l.href)}">${esc(l.label)}</a>`).join('')}</div>`:''}
    ${e.logos?.length?`<div class="event-logos">${e.logos.map(src=>`<img src="${esc(src)}" alt="">`).join('')}</div>`:''}</div></article>`;
  const upcoming=EVENTS.filter(e=>e.date>=today).sort((a,b)=>a.date.localeCompare(b.date)),past=EVENTS.filter(e=>e.date<today).sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('upcomingEvents').innerHTML=upcoming.map(e=>card(e,false)).join('')||`<div class="notice event-empty"><div><b>More Baroda Swim Front events are coming soon.</b><br>Join our WhatsApp group to hear about them first.</div><a class="btn" href="https://chat.whatsapp.com/KjaH2HlIPVzIQ8riESfEKo?s=cl&amp;p=a&amp;mlu=4&amp;ilr=4" target="_blank" rel="noopener noreferrer">Join WhatsApp Group</a></div>`;
  document.getElementById('pastEvents').innerHTML=past.map(e=>card(e,true)).join('')||'<p class="muted">No completed events yet.</p>';
})();
