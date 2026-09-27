// Renders a QR code into a Y4M clip that Chromium plays as a fake webcam (--use-file-for-fake-video-capture).
const QRCode=require('qrcode');
const fs=require('node:fs/promises');
async function writeQrCamera(file,text,{width=640,height=480}={}){
 const {modules}=QRCode.create(text,{errorCorrectionLevel:'M'});
 const quiet=4,cells=modules.size+quiet*2,scale=Math.floor(Math.min(width,height)*0.8/cells),left=Math.floor((width-cells*scale)/2),top=Math.floor((height-cells*scale)/2);
 const y=Buffer.alloc(width*height,235);
 for(let row=0;row<modules.size;row++)for(let col=0;col<modules.size;col++)if(modules.get(row,col)){
  for(let dy=0;dy<scale;dy++)y.fill(16,(top+(row+quiet)*scale+dy)*width+left+(col+quiet)*scale,(top+(row+quiet)*scale+dy)*width+left+(col+quiet+1)*scale);
 }
 const chroma=Buffer.alloc(width*height/2,128),frame=Buffer.concat([Buffer.from('FRAME\n'),y,chroma]);
 await fs.writeFile(file,Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420\n`),frame,frame]));
}
module.exports={writeQrCamera};
