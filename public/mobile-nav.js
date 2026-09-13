(()=>{
  const nav=document.querySelector('.site-nav');
  if(!nav)return;
  const toggle=nav.querySelector('.nav-toggle');
  const menu=nav.querySelector('.site-nav-links');
  if(!toggle||!menu)return;
  const close=()=>{toggle.setAttribute('aria-expanded','false');menu.classList.remove('open');document.body.classList.remove('nav-open')};
  toggle.addEventListener('click',()=>{
    const open=toggle.getAttribute('aria-expanded')==='true';
    if(open)close();else{toggle.setAttribute('aria-expanded','true');menu.classList.add('open');document.body.classList.add('nav-open')}
  });
  menu.addEventListener('click',e=>{if(e.target.closest('a'))close()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  document.addEventListener('click',e=>{if(toggle.getAttribute('aria-expanded')==='true'&&!nav.contains(e.target))close()});
  window.addEventListener('resize',()=>{if(window.innerWidth>700)close()});
})();
