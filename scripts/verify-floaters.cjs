const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const jsQR=require('jsqr');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {start,close,query}=require('../test-support/admin-harness.cjs');
const first='25m Freestyle Kick with Board / Floaters',second='25m Freestyle with Floaters';
(async()=>{
 const base=await start();let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  for(const [width,height] of [[1440,1000],[390,844]]){
   const context=await browser.newContext({viewport:{width,height},isMobile:width<600,hasTouch:width<600,acceptDownloads:true});context.setDefaultTimeout(15000);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/register.html');await page.waitForFunction(()=>!document.getElementById('submitBtn').disabled);
   await page.locator('#fullName').fill('Floater Browser');await page.locator('#schoolName').fill('Test School');await page.locator('#gender').selectOption('Boys');await page.locator('#dobInput').fill('2021-05-01');await page.locator('#email').fill('parent@example.com');await page.locator('#phone').fill('9999999999');
   for(const selector of ['#participantPhoto','#paymentProof'])await page.locator(selector).setInputFiles(path.join(__dirname,'../public/bsf-logo.jpeg'));
   const ack=page.locator('#floatersAcknowledged'),notice=page.locator('#floaterNotice');assert.equal(await notice.isVisible(),false);
   await page.getByLabel(first,{exact:true}).check();assert.equal(await notice.isVisible(),true);assert.equal(await ack.evaluate(e=>e.required),true);
   let submits=0;page.on('request',r=>{if(r.url().endsWith('/api/register'))submits++});await page.locator('#submitBtn').click();assert.equal(submits,0);assert.equal(await ack.evaluate(e=>e.validity.valueMissing),true);
   await page.getByLabel(second,{exact:true}).check();await page.getByLabel(first,{exact:true}).uncheck();assert.equal(await notice.isVisible(),true);
   await ack.check();await page.getByLabel(second,{exact:true}).uncheck();assert.equal(await notice.isVisible(),false);assert.equal(await ack.isChecked(),false);assert.equal(await ack.isDisabled(),true);
   await page.getByLabel(first,{exact:true}).check();await ack.check();await page.locator('#dobInput').fill('2019-05-01');assert.equal(await notice.isVisible(),false);
   await page.locator('#dobInput').fill('2021-05-01');await page.getByLabel(first,{exact:true}).check();assert.equal(await ack.isChecked(),false);
   await page.reload();await page.waitForFunction(()=>!document.getElementById('submitBtn').disabled);assert.equal(await notice.isVisible(),true);assert.equal(await ack.isChecked(),false);
   for(const selector of ['#participantPhoto','#paymentProof'])await page.locator(selector).setInputFiles(path.join(__dirname,'../public/bsf-logo.jpeg'));
   await ack.check();await page.locator('#submitBtn').click();await page.waitForURL('**/success.html?token=*');await page.waitForFunction(()=>!document.getElementById('downloadTicket').disabled);
   assert.ok((await page.locator('#ticketDescription').textContent()).includes('Bring Your Own Floaters'));
   const token=new URL(page.url()).searchParams.get('token'),data=await (await fetch(base+'/api/ticket/'+token)).json();assert.equal(data.requiresFloaters,true);
   const pending=page.waitForEvent('download');await page.locator('#downloadTicket').click();const file=await pending;const bytes=await fs.readFile(await file.path());const png=PNG.sync.read(bytes);assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height).data,data.checkinUrl);
   // Confirm the warning panel is part of the PNG artwork, not only the DOM.
   let goldPixels=0;for(let i=0;i<png.data.length;i+=4)if(png.data[i]===255&&png.data[i+1]===243&&png.data[i+2]===206)goldPixels++;assert.ok(goldPixels>10000);
   await fs.writeFile(path.join(require('os').tmpdir(),`bsf-floaters-${width}.png`),bytes);
   assert.deepEqual(errors,[]);assert.equal((await query('SELECT COUNT(*)::int n FROM registrations WHERE ticket_token=$1',[token])).rows[0].n,1);
   console.log(`PASS ${width}px: visibility, multi-event deselection, age change, draft restore, blocked submit, acknowledgement, saved ticket reminder and PNG QR`);await context.close();
  }
 }finally{if(browser)await browser.close();await close()}
})().catch(e=>{console.error(e);process.exitCode=1});
