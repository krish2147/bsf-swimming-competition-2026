// Certificate of Participation (landscape A4 PDF) for a registered swimmer.
// p: {fullName, schoolName, category, gender, events:[label], registrationId}
const path=require('path');
const fs=require('fs');
const PDFDocument=require('pdfkit');

const LOGO=path.join(__dirname,'..','public','bsf-logo.jpeg');
const NAVY='#0b2a4a',BLUE='#1268d3',GOLD='#c99a2e',MUTED='#5b6b7d';

function certificatePdf(p){
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',layout:'landscape',margin:0,info:{Title:`Certificate of Participation — ${p.fullName}`,Author:'Baroda Swim Front'}}),chunks=[];
    doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    const W=doc.page.width,H=doc.page.height,center=(text,y,opts={})=>doc.text(text,60,y,{width:W-120,align:'center',...opts});

    // Background and double border
    doc.rect(0,0,W,H).fill('#fbf8f1');
    doc.lineWidth(10).strokeColor(NAVY).rect(18,18,W-36,H-36).stroke();
    doc.lineWidth(2).strokeColor(GOLD).rect(34,34,W-68,H-68).stroke();
    doc.lineWidth(0.8).strokeColor(GOLD).rect(40,40,W-80,H-80).stroke();
    // Corner wave accents
    for(const [x,y,sx,sy] of [[40,40,1,1],[W-40,40,-1,1],[40,H-40,1,-1],[W-40,H-40,-1,-1]]){
      doc.save().lineWidth(2).strokeColor(BLUE).opacity(0.35);
      for(let i=0;i<3;i++)doc.moveTo(x,y+sy*(22+i*10)).bezierCurveTo(x+sx*20,y+sy*(12+i*10),x+sx*30,y+sy*(32+i*10),x+sx*(55+i*12),y+sy*(18+i*10)).stroke();
      doc.restore();
    }

    if(fs.existsSync(LOGO))doc.image(LOGO,W/2-38,58,{fit:[76,76]});
    doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY);center('BARODA SWIM FRONT',142,{characterSpacing:3});
    doc.font('Helvetica').fontSize(10.5).fillColor(MUTED);center('3rd Inter-School Swimming Competition 2026  ·  in association with AARK International School, Vadodara',160);

    doc.font('Times-Bold').fontSize(40).fillColor(NAVY);center('Certificate of Participation',190);
    doc.save().lineWidth(1.4).strokeColor(GOLD).moveTo(W/2-150,240).lineTo(W/2+150,240).stroke().restore();

    doc.font('Times-Italic').fontSize(15).fillColor(MUTED);center('This is to certify that',258);
    doc.font('Times-BoldItalic').fontSize(fitSize(doc,p.fullName,W-200,38,24)).fillColor(BLUE);center(p.fullName,284);
    doc.save().lineWidth(0.8).strokeColor('#b9c4cf').moveTo(W/2-210,330).lineTo(W/2+210,330).stroke().restore();

    doc.font('Times-Roman').fontSize(15).fillColor(NAVY);
    center(`of ${p.schoolName}`,342);
    center(`participated in the ${p.category} ${p.gender} category of the 3rd Inter-School Swimming Competition 2026,`,368);
    center('held on 4 October 2026 at Vadodara, Gujarat.',388);
    if(p.events?.length){doc.font('Times-Italic').fontSize(13).fillColor(MUTED);center(`Event${p.events.length>1?'s':''}: ${p.events.join('  ·  ')}`,416)}

    // Signature lines
    const sigY=H-118;
    for(const [x,label] of [[110,'Organising Secretary'],[W-310,'Head Coach, Baroda Swim Front']]){
      doc.save().lineWidth(0.8).strokeColor(NAVY).moveTo(x,sigY).lineTo(x+200,sigY).stroke().restore();
      doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(label,x,sigY+8,{width:200,align:'center'});
    }
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);center(`Registration ID ${p.registrationId}  ·  Swim for life`,H-62);
    doc.end();
  });
}

// Largest font size (≤ max, ≥ min) at which the text fits on one line.
function fitSize(doc,text,width,max,min){
  for(let size=max;size>min;size-=1){if(doc.fontSize(size).widthOfString(text)<=width)return size}
  return min;
}

module.exports={certificatePdf};
