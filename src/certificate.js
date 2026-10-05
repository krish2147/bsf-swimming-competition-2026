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

const ordinal=n=>({1:'1st',2:'2nd',3:'3rd'})[n]||`${n}th`;

async function certificatePdf(p){return fill(load().template,p,'Participation')}
async function meritCertificatePdf(p){return fill(load().meritTemplate,{...p,events:[p.event]},'Merit',ordinal(p.position))}

async function fill(template,p,kind,position){
  const {nameFont:nameBytes,textFont:textBytes}=load();
  const doc=await PDFDocument.load(template);doc.registerFontkit(fontkit);
  const nameFont=await doc.embedFont(nameBytes,{subset:false}),textFont=await doc.embedFont(textBytes,{subset:false});
  const page=doc.getPage(0),H=page.getHeight();
  const write=(text,line,font,{gap=5,y=line.y}={})=>{
    text=String(text??'').replace(/\s+/g,' ').trim();if(!text)return;
    const width=line.x1-line.x0-6,size=fitSize(font,text,width,line.max,line.min);
    const w=font.widthOfTextAtSize(text,size);
    page.drawText(text,{x:line.x0+(line.x1-line.x0-w)/2,y:H-y+gap,size,font,color:NAVY,maxWidth:line.x1-line.x0});
  };
  write(p.fullName,LINES.name,nameFont,{gap:7});
  write(p.schoolName,LINES.school,textFont);
  write(p.category,LINES.ageGroup,textFont);
  if(position)write(position,LINES.position,textFont);
  // Events: one line if it fits, otherwise split over two lines that sit just above the blank.
  const events=(p.events||[]).filter(Boolean),one=joinEvents(events),line=LINES.event,width=line.x1-line.x0-6;
  if(events.length<2||textFont.widthOfTextAtSize(one,line.min+1)<=width)write(one,line,textFont);
  else{
    const half=Math.ceil(events.length/2),first=events.slice(0,half).join(', ')+',',second=joinEvents(events.slice(half));
    const size=Math.min(fitSize(textFont,first,width,11,6.5),fitSize(textFont,second,width,11,6.5));
    write(first,{...line,max:size,min:size},textFont,{gap:5+size+1});
    write(second,{...line,max:size,min:size},textFont);
  }
  doc.setTitle(`Certificate of ${kind} — ${p.fullName}`);doc.setAuthor('Baroda Swim Front');
  if(p.registrationId)doc.setSubject(`Registration ID ${p.registrationId}`);
  return Buffer.from(await doc.save({useObjectStreams:false}));
}

module.exports={certificatePdf,meritCertificatePdf,ordinal};
