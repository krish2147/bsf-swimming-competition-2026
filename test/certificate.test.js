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
