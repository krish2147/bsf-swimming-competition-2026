const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');
const {PDFDocument}=require('pdf-lib');
const fontkit=require('@pdf-lib/fontkit');
const {certificatePdf}=require('../src/certificate');

test('certificate is the signed A4 portrait template with the swimmer filled in',async()=>{
  const bytes=await certificatePdf({fullName:'Aarna Sawant',schoolName:"St. Xavier's School",category:'Under-12',gender:'Girls',events:['25m Freestyle','25m Backstroke','50m Freestyle'],registrationId:'BSF26-0001'});
  const doc=await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(),1);
  const {width,height}=doc.getPage(0).getSize();assert.equal(Math.round(width),595);assert.equal(Math.round(height),842);
  assert.equal(doc.getTitle(),'Certificate of Participation — Aarna Sawant');assert.equal(doc.getSubject(),'Registration ID BSF26-0001');
});

test('certificate fonts cover every character the form allows in names and schools',()=>{
  for(const file of ['CormorantGaramond_700Bold_Italic.ttf','CormorantGaramond_600SemiBold.ttf']){
    const font=fontkit.create(fs.readFileSync(path.join(__dirname,'..','assets','certificate',file)));
    for(const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,'’&()-/:")assert.ok(font.hasGlyphForCodePoint(ch.codePointAt(0)),`${file} missing ${ch}`);
  }
});

test('merit certificate is the signed merit design with position, event and age group',async()=>{
  const {meritCertificatePdf,ordinal}=require('../src/certificate');
  assert.deepEqual([1,2,3].map(ordinal),['1st','2nd','3rd']);
  const doc=await PDFDocument.load(await meritCertificatePdf({fullName:'Kalp Shah',schoolName:'Test School',category:'Under-14',event:'25m Freestyle',position:1,registrationId:'BSF26-0002'}));
  assert.equal(doc.getPageCount(),1);assert.equal(doc.getTitle(),'Certificate of Merit — Kalp Shah');
  const {width,height}=doc.getPage(0).getSize();assert.equal(Math.round(width),595);assert.equal(Math.round(height),842);
});

test('every event label, long names and long schools stay on or above their blank line and fit its width',async()=>{
  const {layoutLines,LINES,load}=require('../src/certificate'),{CATEGORIES}=require('../src/competition');
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const text=await doc.embedFont(load().textFont),name=await doc.embedFont(load().nameFont);
  const labels=new Set();for(const c of CATEGORIES)for(const e of c.events)labels.add((c.eventLabels||{})[e]||e);
  const cases=[...[...labels].map(l=>[l,LINES.event,text]),['25m Freestyle Kick with Board / Floaters & 25m Freestyle',LINES.event,text],
    ['Shree Narayan Vidyalaya English Medium Higher Secondary School, Vadodara',LINES.school,text],['Abdullah Parvezahmed Shaikh Mohammed Rafiq Khan',LINES.name,name]];
  for(const [value,line,font] of cases){
    const lines=layoutLines(font,value,line);
    assert.ok(lines.length>=1&&lines.length<=2,value);
    for(const l of lines){assert.ok(l.rise>=5,`${value}: "${l.text}" sits below the blank`);assert.ok(font.widthOfTextAtSize(l.text,l.size)<=line.x1-line.x0,`${value}: "${l.text}" too wide`);assert.ok(l.size>=5,value)}
    assert.equal(lines.map(l=>l.text).join(' ').replace(/\s+/g,' ').replace(/ ,/g,','),value.replace(/\s+/g,' '),'no words lost');
  }
  assert.deepEqual(layoutLines(text,'25m Freestyle Kick with Board / Floaters',LINES.event).map(l=>l.text),['25m Freestyle Kick with Board /','Floaters']);
  assert.deepEqual(layoutLines(text,'25m Freestyle Kick with Board / Floaters & 25-meter Freestyle with/without Floaters',LINES.event).map(l=>l.text),['25m Freestyle Kick with Board / Floaters','& 25-meter Freestyle with/without Floaters'],'two events split between the events');
});
