// Shrinks phone photos / screenshots before upload (longest side ≤ 1600px, JPEG) so each registration
// stores ~0.2–0.5 MB instead of 3–6 MB. Any failure falls back to the original file, so it never blocks a registration.
(()=>{
  async function decode(file){
    if(typeof createImageBitmap==='function'){try{return await createImageBitmap(file,{imageOrientation:'from-image'})}catch{}}
    const url=URL.createObjectURL(file);
    try{const img=new Image();img.src=url;await img.decode();return img}finally{setTimeout(()=>URL.revokeObjectURL(url),0)}
  }
  async function compressImage(file,{maxSide=1600,quality=0.82,skipBelow=400*1024}={}){
    if(!(file instanceof Blob)||!/^image\//.test(file.type)||file.size<=skipBelow)return file;
    try{
      const image=await decode(file),width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;
      if(!width||!height)return file;
      const scale=Math.min(1,maxSide/Math.max(width,height)),canvas=document.createElement('canvas');
      canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      image.close?.();
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(!blob||blob.size>=file.size)return file;
      return new File([blob],String(file.name||'image').replace(/\.[^.]*$/,'')+'.jpg',{type:'image/jpeg'});
    }catch{return file}
  }
  window.BSFCompressImage=compressImage;
})();
