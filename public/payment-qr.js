(()=>{
  /* Registration page shares the same public navigation as every other page. */
  const oldNav=document.querySelector('nav.co-branded-header');
  if(oldNav){
    if(!document.querySelector('link[href="/mobile-nav.css"]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/mobile-nav.css';document.head.append(css)}
    oldNav.className='site-nav';
    oldNav.innerHTML='<a class="brand" href="/">AARK × BSF <small>/ SWIMMING</small></a><button class="nav-toggle" type="button" aria-label="Open navigation menu" aria-expanded="false" aria-controls="siteNavLinks"><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span></button><div class="site-nav-links" id="siteNavLinks"><a href="/">Home</a><span class="nav-current" aria-current="page">Register</span><a href="/results.html">Results</a><a href="/timings.html">Timings</a></div>';
    const navScript=document.createElement('script');navScript.src='/mobile-nav.js';document.body.append(navScript);
  }
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