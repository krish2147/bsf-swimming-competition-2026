(()=>{
  const preview=document.getElementById('payQr');
  const zoom=document.getElementById('qrZoom');
  const dialog=document.getElementById('qrDialog');
  const large=document.getElementById('qrLarge');
  const download=document.getElementById('qrDownload');
  const status=document.getElementById('qrDownloadStatus');
  const imageUrl=()=>preview.currentSrc||preview.src;
  const updateAvailability=()=>{
    const ready=preview.complete&&preview.naturalWidth>0;
    zoom.disabled=!ready;
    download.disabled=!ready;
  };
  preview.addEventListener('load',updateAvailability);
  preview.addEventListener('error',updateAvailability);
  updateAvailability();
  zoom.addEventListener('click',()=>{
    large.src=imageUrl();
    dialog.showModal();
  });
  document.getElementById('qrClose').addEventListener('click',()=>dialog.close());
  // Native dialog supplies focus containment, Escape handling, and focus return.
  dialog.addEventListener('click',event=>{
    const rect=dialog.getBoundingClientRect();
    if(event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))dialog.close();
  });
  download.addEventListener('click',async()=>{
    download.disabled=true;
    status.textContent='';
    try{
      // A blob URL also supports cross-origin images when their server permits CORS.
      const response=await fetch(imageUrl());
      if(!response.ok)throw new Error('QR download failed');
      const blob=await response.blob();
      const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/svg+xml':'svg','image/gif':'gif','image/avif':'avif'};
      const extension=extensions[blob.type.split(';')[0].toLowerCase()];
      if(!extension)throw new Error('Unsupported QR image');
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;
      link.download=`BSF-Payment-QR.${extension}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch{
      status.textContent='QR download unavailable. Please try again or contact BSF.';
    }finally{updateAvailability()}
  });
})();
