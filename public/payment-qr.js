(()=>{
  const preview=document.getElementById('payQr');
  const zoom=document.getElementById('qrZoom');
  const dialog=document.getElementById('qrDialog');
  const large=document.getElementById('qrLarge');
  const download=document.getElementById('qrDownload');
  const status=document.getElementById('qrDownloadStatus');
  const imageUrl=()=>preview.currentSrc||preview.src;
  const updateAvailability=()=>{const ready=preview.complete&&preview.naturalWidth>0;zoom.disabled=!ready;download.disabled=!ready};
  preview.addEventListener('load',updateAvailability);preview.addEventListener('error',updateAvailability);updateAvailability();
  zoom.addEventListener('click',()=>{large.src=imageUrl();dialog.showModal()});
  document.getElementById('qrClose').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{const rect=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))dialog.close()});
  download.addEventListener('click',async()=>{download.disabled=true;status.textContent='';try{const response=await fetch(imageUrl());if(!response.ok)throw new Error('QR download failed');const blob=await response.blob();const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/svg+xml':'svg','image/gif':'gif','image/avif':'avif'};const extension=extensions[blob.type.split(';')[0].toLowerCase()];if(!extension)throw new Error('Unsupported QR image');const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`BSF-Payment-QR.${extension}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}catch{status.textContent='QR download unavailable. Please try again or contact BSF.'}finally{updateAvailability()}});
})();

(()=>{
  const nav=document.querySelector('nav[aria-label="Main navigation"]');if(!nav)return;
  nav.classList.add('site-nav');
  const brand=nav.querySelector('.brand'),links=[...nav.children].filter(el=>el!==brand),menu=document.createElement('div');
  menu.className='site-nav-links';menu.id='mobileNavigation';links.forEach(link=>menu.appendChild(link));
  const toggle=document.createElement('button');toggle.type='button';toggle.className='nav-toggle';toggle.setAttribute('aria-label','Open navigation menu');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',menu.id);toggle.innerHTML='<span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span>';nav.append(toggle,menu);
  const css=document.createElement('link');css.rel='stylesheet';css.href='/mobile-nav.css';document.head.appendChild(css);
  const close=()=>{toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open navigation menu');menu.classList.remove('open');document.body.classList.remove('nav-open')};
  toggle.addEventListener('click',()=>{const opening=toggle.getAttribute('aria-expanded')!=='true';if(opening){toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label','Close navigation menu');menu.classList.add('open');document.body.classList.add('nav-open')}else close()});
  menu.addEventListener('click',e=>{if(e.target.closest('a'))close()});document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});document.addEventListener('click',e=>{if(toggle.getAttribute('aria-expanded')==='true'&&!nav.contains(e.target))close()});window.addEventListener('resize',()=>{if(window.innerWidth>700)close()});
})();
