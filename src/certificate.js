// Certificates of Participation and Merit: the organisers' signed A4 designs (assets/certificate/*-template.pdf)
// with the swimmer's name, school, event(s), age group and (merit) position written on their blank lines.
// certificatePdf(p): p = {fullName, schoolName, category, gender, events:[label], registrationId}
// meritCertificatePdf(p): p = {fullName, schoolName, category, event:label, position:1|2|3, registrationId}
const path=require('path');
const fs=require('fs');
const {PDFDocument,rgb}=require('pdf-lib');
const fontkit=require('@pdf-lib/fontkit');

const DIR=path.join(__dirname,'..','assets','certificate');
const NAVY=rgb(17/255,32/255,83/255);
// Blank lines on the template, measured in points from the top-left of the page (A4, 595.2 × 841.9).
const LINES={
  name:{x0:81.8,x1:513.8,y:388.5,max:30,min:16},
  school:{x0:125.2,x1:480.8,y:428.5,max:17,min:9},
  event:{x0:163,x1:283.2,y:489.75,max:13,min:8},
  ageGroup:{x0:402.5,x1:465,y:489.75,max:13,min:8},
  position:{x0:265,x1:351.5,y:467,max:14,min:9}, // merit template only
};
let assets=null;
const load=()=>assets||=({
  template:fs.readFileSync(path.join(DIR,'participation-template.pdf')),
  meritTemplate:fs.readFileSync(path.join(DIR,'merit-template.pdf')),
  nameFont:fs.readFileSync(path.join(DIR,'CormorantGaramond_700Bold_Italic.ttf')),
  textFont:fs.readFileSync(path.join(DIR,'CormorantGaramond_600SemiBold.ttf')),
});

// Largest size (≤ max, ≥ min) at which the text fits the line's width.
const fitSize=(font,text,width,max,min)=>{for(let size=max;size>min;size-=0.5)if(font.widthOfTextAtSize(text,size)<=width)return size;return min};
const joinEvents=list=>list.length<2?list.join(''):`${list.slice(0,-1).join(', ')} & ${list.at(-1)}`;

// How a value sits on a blank line: one line at the largest size that fits, otherwise two smaller lines split at
// the most natural point (" / ", ", ", " & ", then a space) — both placed just above the blank, never below it.
// Returns [{text, size, rise}] where rise is the height above the blank line in points.
function layoutLines(font,text,line,gap=5){
  text=String(text??'').replace(/\s+/g,' ').trim();if(!text)return [];
  const width=line.x1-line.x0-6,fits=size=>font.widthOfTextAtSize(text,size)<=width;
  if(fits(line.min))return [{text,size:fitSize(font,text,width,line.max,line.min),rise:gap}];
  // Split between events first (", " / " & "), then at " / ", then at any space — whichever gives the most even lines.
  const split=(i,sep)=>{const keep=sep.trim();return [(text.slice(0,i)+(keep&&keep!=='&'?' '+keep:'')).trim(),((keep==='&'?'& ':'')+text.slice(i+sep.length)).trim()]};
  let best=null;
  for(const seps of [[', ',' & '],[' / '],[' ']]){
    for(const sep of seps)for(let i=text.indexOf(sep);i>0;i=text.indexOf(sep,i+1)){
      const parts=split(i,sep),widest=Math.max(...parts.map(t=>font.widthOfTextAtSize(t,10)));
      if(!best||widest<best.widest)best={parts,widest};
    }
    if(best)break;
  }
  if(!best)return [{text,size:fitSize(font,text,width,line.min,4),rise:gap}];
  const [first,second]=best.parts;
  const size=Math.min(fitSize(font,first,width,Math.min(line.max,11),5),fitSize(font,second,width,Math.min(line.max,11),5));
  return [{text:first,size,rise:gap+size+1},{text:second,size,rise:gap}];
}

const ordinal=n=>({1:'1st',2:'2nd',3:'3rd'})[n]||`${n}th`;

async function certificatePdf(p){return fill(load().template,p,'Participation')}
async function meritCertificatePdf(p){return fill(load().meritTemplate,{...p,events:[p.event]},'Merit',ordinal(p.position))}

async function fill(template,p,kind,position){
  const {nameFont:nameBytes,textFont:textBytes}=load();
  const doc=await PDFDocument.load(template);doc.registerFontkit(fontkit);
  const nameFont=await doc.embedFont(nameBytes,{subset:false}),textFont=await doc.embedFont(textBytes,{subset:false});
  writeFields(doc.getPage(0),{nameFont,textFont},p,position);
  doc.setTitle(`Certificate of ${kind} — ${p.fullName}`);doc.setAuthor('Baroda Swim Front');
  if(p.registrationId)doc.setSubject(`Registration ID ${p.registrationId}`);
  return Buffer.from(await doc.save({useObjectStreams:false}));
}

// Write a swimmer's details onto a certificate page (template already drawn or loaded on it).
function writeFields(page,{nameFont,textFont},p,position){
  const H=page.getHeight();
  const write=(text,line,font,{gap=5}={})=>{
    for(const l of layoutLines(font,text,line,gap)){
      const w=font.widthOfTextAtSize(l.text,l.size);
      page.drawText(l.text,{x:line.x0+(line.x1-line.x0-w)/2,y:H-line.y+l.rise,size:l.size,font,color:NAVY});
    }
  };
  write(p.fullName,LINES.name,nameFont,{gap:7});
  write(p.schoolName,LINES.school,textFont);
  write(p.category,LINES.ageGroup,textFont);
  if(position)write(position,LINES.position,textFont);
  // Events: one line if it fits, otherwise two lines just above the blank (see layoutLines).
  write(joinEvents((p.events||[]).filter(Boolean)),LINES.event,textFont);
}

// Every merit certificate in one printable PDF, one A4 page each. The signed design is embedded once and drawn on
// every page, and the fonts are embedded once, so hundreds of certificates stay a small file.
// list: [{fullName, schoolName, category, event, position}]
async function meritCertificatesBook(list,{title='Merit Certificates'}={}){
  const {meritTemplate,nameFont:nameBytes,textFont:textBytes}=load();
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const [design]=await doc.embedPdf(meritTemplate,[0]);
  const nameFont=await doc.embedFont(nameBytes,{subset:false}),textFont=await doc.embedFont(textBytes,{subset:false});
  for(const p of list){
    const page=doc.addPage([design.width,design.height]);
    page.drawPage(design,{x:0,y:0,width:design.width,height:design.height});
    writeFields(page,{nameFont,textFont},{...p,events:[p.event]},ordinal(p.position));
  }
  doc.setTitle(title);doc.setAuthor('Baroda Swim Front');
  return Buffer.from(await doc.save());
}

module.exports={certificatePdf,meritCertificatePdf,meritCertificatesBook,ordinal,layoutLines,LINES,load};
