// Printable heat sheets (one A4 page per heat) for timekeepers to write times by hand.
// sheet: {eventTitle, heats:[{heatNo, lanes:[{laneNo, fullName, schoolName, registrationId}|{laneNo}]}]}
const path=require('path');
const PDFDocument=require('pdfkit');
const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,WidthType,HeightRule,AlignmentType,VerticalAlign,ImageRun,BorderStyle,ShadingType}=require('docx');
const fs=require('fs');

const LOGO=path.join(__dirname,'..','public','bsf-logo.jpeg');
const COMPETITION='Baroda Swim Front — Inter-School Swimming Competition 2026';
const WHEN='4 October 2026 · Vadodara, Gujarat';
const COLUMNS=[['Lane',34],['Swimmer',134],['School',112],['Reg. ID',100],['Time (mm:ss.hh)',85],['DNS / DQ',50]];
const cellValues=lane=>lane.registrationId?[String(lane.laneNo),lane.fullName||'',lane.schoolName||'',lane.registrationId,'','']:[String(lane.laneNo),'— empty lane —','','','',''];

function heatSheetPdf(sheet){
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margin:40,info:{Title:`Heat sheet — ${sheet.eventTitle}`}}),chunks=[];
    doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    const left=40,width=515,rowHeight=34,headerHeight=24,logo=fs.existsSync(LOGO)?LOGO:null;
    sheet.heats.forEach((heat,index)=>{
      if(index)doc.addPage();
      if(logo)doc.image(logo,left,40,{fit:[54,54]});
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#122b45').text(COMPETITION,left+66,44,{width:width-66});
      doc.font('Helvetica').fontSize(10).fillColor('#607184').text(WHEN,left+66,doc.y+2,{width:width-66});
      doc.font('Helvetica-Bold').fontSize(18).fillColor('#122b45').text(sheet.eventTitle,left,112,{width});
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#1268d3').text(`Heat ${heat.heatNo} of ${sheet.heats.length}`,left,doc.y+4,{width});
      let y=doc.y+14;
      const row=(values,minHeight,header)=>{
        // Grow the row to fit long names/schools instead of cutting them off.
        doc.font('Helvetica').fontSize(9.5);
        const height=header?minHeight:Math.max(minHeight,...values.map((v,i)=>i&&v?doc.heightOfString(v,{width:COLUMNS[i][1]-8})+12:0));
        let x=left;
        if(header)doc.rect(left,y,width,height).fill('#eaf3ff');
        COLUMNS.forEach(([,w],i)=>{
          doc.lineWidth(0.8).strokeColor('#8fa3b8').rect(x,y,w,height).stroke();
          doc.font(header||i===0?'Helvetica-Bold':'Helvetica').fontSize(header?8.5:i===0?13:9.5).fillColor(values[i].startsWith('—')?'#8a98a8':'#122b45')
            .text(values[i],x+4,y+(header?8:i===0?10:6),{width:w-8,align:i===0?'center':'left'});
          x+=w;
        });
        y+=height;
      };
      row(COLUMNS.map(([label])=>label),headerHeight,true);
      for(const lane of heat.lanes)row(cellValues(lane),rowHeight,false);
      y+=36;
      doc.font('Helvetica').fontSize(10).fillColor('#122b45');
      doc.text('Timekeeper: ______________________',left,y);doc.text('Referee: ______________________',left+270,y);
      doc.text('Signature: ______________________',left,y+30);doc.text('Time noted at: ________________',left+270,y+30);
      doc.fontSize(8).fillColor('#607184').text(`${sheet.eventTitle} · Heat ${heat.heatNo} · Printed ${sheet.printedAt}`,left,790,{width,align:'center'});
    });
    doc.end();
  });
}

function heatSheetDocx(sheet){
  const total=10466,scale=total/COLUMNS.reduce((sum,[,w])=>sum+w,0),widths=COLUMNS.map(([,w])=>Math.round(w*scale));
  const border={style:BorderStyle.SINGLE,size:6,color:'8FA3B8'},borders={top:border,bottom:border,left:border,right:border};
  const cell=(value,i,header)=>new TableCell({width:{size:widths[i],type:WidthType.DXA},borders,verticalAlign:VerticalAlign.CENTER,
    shading:header?{type:ShadingType.CLEAR,color:'auto',fill:'EAF3FF'}:undefined,margins:{left:80,right:80},
    children:[new Paragraph({alignment:i===0?AlignmentType.CENTER:AlignmentType.LEFT,children:[new TextRun({text:value,bold:header||i===0,size:header?17:i===0?26:19,color:value.startsWith('—')?'8A98A8':'122B45'})]})]});
  const logo=fs.existsSync(LOGO)?fs.readFileSync(LOGO):null;
  const sections=sheet.heats.map(heat=>({
    properties:{page:{size:{width:11906,height:16838},margin:{top:720,bottom:720,left:720,right:720}}},
    children:[
      new Paragraph({children:[...(logo?[new ImageRun({type:'jpg',data:logo,transformation:{width:56,height:56}}),new TextRun('  ')]:[]),new TextRun({text:COMPETITION,bold:true,size:24,color:'122B45'})]}),
      new Paragraph({children:[new TextRun({text:WHEN,size:19,color:'607184'})],spacing:{after:240}}),
      new Paragraph({children:[new TextRun({text:sheet.eventTitle,bold:true,size:34,color:'122B45'})]}),
      new Paragraph({children:[new TextRun({text:`Heat ${heat.heatNo} of ${sheet.heats.length}`,bold:true,size:26,color:'1268D3'})],spacing:{after:200}}),
      new Table({width:{size:total,type:WidthType.DXA},columnWidths:widths,rows:[
        new TableRow({tableHeader:true,height:{value:460,rule:HeightRule.ATLEAST},children:COLUMNS.map(([label],i)=>cell(label,i,true))}),
        ...heat.lanes.map(lane=>new TableRow({height:{value:680,rule:HeightRule.ATLEAST},cantSplit:true,children:cellValues(lane).map((value,i)=>cell(value,i,false))}))]}),
      new Paragraph({spacing:{before:600},children:[new TextRun({text:'Timekeeper: ______________________\t\tReferee: ______________________',size:20})]}),
      new Paragraph({spacing:{before:360},children:[new TextRun({text:'Signature: ______________________\t\tTime noted at: ________________',size:20})]}),
      new Paragraph({spacing:{before:360},alignment:AlignmentType.CENTER,children:[new TextRun({text:`${sheet.eventTitle} · Heat ${heat.heatNo} · Printed ${sheet.printedAt}`,size:16,color:'607184'})]}),
    ]}));
  return Packer.toBuffer(new Document({creator:'Baroda Swim Front',title:`Heat sheet — ${sheet.eventTitle}`,sections}));
}

// Groups saved race entries into heats, listing every lane up to the widest heat so empty lanes are visible.
function buildHeatSheet(rows,eventTitle,printedAt){
  const lanes=Math.max(0,...rows.map(r=>r.lane_no)),heats=new Map();
  for(const r of rows){if(!heats.has(r.heat_no))heats.set(r.heat_no,new Map());heats.get(r.heat_no).set(r.lane_no,r)}
  return {eventTitle,printedAt,heats:[...heats.keys()].sort((a,b)=>a-b).map(heatNo=>({heatNo,lanes:Array.from({length:lanes},(_,i)=>{
    const r=heats.get(heatNo).get(i+1);
    return r?{laneNo:i+1,fullName:r.full_name,schoolName:r.school_name,registrationId:r.registration_id}:{laneNo:i+1};
  })}))};
}

module.exports={heatSheetPdf,heatSheetDocx,buildHeatSheet};
