// One navigation for every page: the full list of pages, the page you are on highlighted (desktop bar and the
// phone hamburger menu alike). Public pages and admin desks each have their own list.
(()=>{
  const PUBLIC=[['/','Home'],['/events.html','Events'],['/register.html','Register'],['/find-ticket.html','Find Ticket',['/success.html']],['/results.html','Results'],['/best-swimmers.html','Best Swimmers'],['/timings.html','Timings']];
  const ADMIN=[['/admin/','Dashboard',['/admin/index.html']],['/admin/payments.html','Payments'],['/admin/checkin.html','Check-in'],['/admin/timings.html','Timings'],['/admin/relays.html','Relays'],['/admin/results.html','Results'],['/admin/results-preview.html','Preview']];
  const nav=document.querySelector('nav.site-nav')||document.querySelector('body > nav');
  if(!nav)return;
  if(!document.querySelector('link[href="/mobile-nav.css"]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/mobile-nav.css';document.head.append(css)}
  const here=location.pathname.replace(/\/index\.html$/,'/');
  const pages=here.startsWith('/admin/')?ADMIN:PUBLIC;
  const esc=v=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const brand=nav.querySelector('.brand')?.outerHTML||'<a class="brand" href="/">AARK × BSF <small>/ SWIMMING</small></a>';
  const links=pages.map(([href,label,also=[]])=>{const current=href===here||also.includes(here);
    return `<a href="${href}"${current?' class="nav-current" aria-current="page"':''}>${esc(label)}</a>`}).join('');
  nav.className='site-nav';nav.setAttribute('aria-label',nav.getAttribute('aria-label')||'Main navigation');
  nav.innerHTML=`${brand}<button class="nav-toggle" type="button" aria-label="Open navigation menu" aria-expanded="false" aria-controls="siteNavLinks"><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span></button><div class="site-nav-links" id="siteNavLinks">${links}</div>`;
  const toggle=nav.querySelector('.nav-toggle'),menu=nav.querySelector('.site-nav-links');
  const close=()=>{toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open navigation menu');menu.classList.remove('open');document.body.classList.remove('nav-open')};
  toggle.addEventListener('click',()=>{
    if(toggle.getAttribute('aria-expanded')==='true')return close();
    toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label','Close navigation menu');menu.classList.add('open');document.body.classList.add('nav-open');
  });
  menu.addEventListener('click',e=>{if(e.target.closest('a'))close()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  document.addEventListener('click',e=>{if(toggle.getAttribute('aria-expanded')==='true'&&!nav.contains(e.target))close()});
  window.addEventListener('resize',()=>{if(window.innerWidth>960)close()});
})();
