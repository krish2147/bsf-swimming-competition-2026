const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const jsQR=require('jsqr');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {start,close}=require('../test-support/admin-harness.cjs');
(async()=>{
 const base=await start();let browser;
 const artifacts=process.env.TICKET_TEST_ARTIFACTS||path.join(os.tmpdir(),'bsf-ticket-verification');await fs.mkdir(artifacts,{recursive:true});
 try{
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const scenarios=[
   ['desktop',1440,1000,'2015-05-01',['25m Freestyle','25m Backstroke'],'Aarav Shah','BSF Test School'],
   ['mobile',390,844,'2021-05-01',['25m Freestyle Kick with Board'],'Aanya Patel','Vadodara Test School'],
   ['long-content',320,568,'2015-05-01',['25m Freestyle','25m Backstroke','100m Individual Medley (IM)','25m Breaststroke','4×50m Freestyle Relay'],'A Very Long Participant Name That Wraps Correctly Without Losing Any Letters','A Very Long School Name With Multiple Words And ALongUnbrokenSchoolIdentifierThatMustWrapWithoutClipping']
  ];
  for(const [name,width,height,dob,events,fullName,schoolName] of scenarios){
   const body=new FormData();for(const [k,v] of Object.entries({fullName,schoolName,dob,gender:'Boys',email:'parent@example.com',phone:'9999999999',events:JSON.stringify(events),idempotencyKey:crypto.randomUUID(),...(dob==='2021-05-01'?{floatersAcknowledged:'true'}:{})}))body.set(k,v);
   body.set('participantPhoto',new Blob([await fs.readFile(path.join(__dirname,'../public/bsf-logo.jpeg'))],{type:'image/jpeg'}),'photo.jpg');body.set('paymentProof',new Blob([await fs.readFile(path.join(__dirname,'../public/bsf-payment-qr.jpeg'))],{type:'image/jpeg'}),'proof.jpg');
   const response=await fetch(base+'/api/register',{method:'POST',body});assert.equal(response.status,200);const registration=await response.json();
   const apiUrl=base+'/api/ticket/'+registration.ticketToken,ticket=await (await fetch(apiUrl)).json(),again=await (await fetch(apiUrl)).json();
   assert.equal(ticket.qrDataUrl,again.qrDataUrl);assert.equal(ticket.checkinUrl,again.checkinUrl);assert.equal(new URL(ticket.checkinUrl).searchParams.get('token'),registration.ticketToken);
   assert.equal(ticket.registrationDeadline,'30 September 2026');assert.equal(ticket.competitionDate,'4 October 2026');assert.equal(ticket.venue,'Vadodara, Gujarat');assert.equal(ticket.paymentStatus,'Pending');
   const context=await browser.newContext({viewport:{width,height},isMobile:width<600,hasTouch:width<600,acceptDownloads:true});context.setDefaultTimeout(20000);
   const page=await context.newPage(),errors=[],walletRequests=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('request',r=>{if(r.url().includes('/api/wallet/'))walletRequests.push(r.url())});
   // Ensure the download stays unavailable until required assets load.
   await page.route('**/bsf-logo.jpeg',async route=>{await new Promise(r=>setTimeout(r,200));await route.continue()});
   await page.goto(base+'/success.html?token='+registration.ticketToken);await page.waitForFunction(()=>!document.getElementById('downloadTicket').disabled);
   assert.equal(await page.locator('#ticketDescription').textContent().then(s=>s.includes(fullName)&&s.includes(schoolName)),true);
   assert.equal((await page.locator('#ticketDescription').textContent()).includes('Bring Your Own Floaters'),ticket.requiresFloaters);
   for(const event of events)assert.ok((await page.locator('#ticketDescription').textContent()).includes(event));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(artifacts,name+'-screen.png'),fullPage:true});
   const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download Ticket',exact:true}).click();const download=await pending;
   assert.equal(download.suggestedFilename(),`BSF-Ticket-${registration.registrationId}.png`);
   const bytes=await fs.readFile(await download.path());await fs.writeFile(path.join(artifacts,name+'-ticket.png'),bytes);
   const png=PNG.sync.read(bytes);assert.equal(png.width,1360);assert.ok(png.height>2000);
   const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);assert.ok(decoded,'Downloaded QR must decode');assert.equal(decoded.data,ticket.checkinUrl);
   // The final footer is present, not clipped off a fixed-height canvas.
   const offset=((png.height-10)*png.width+20)*4;assert.deepEqual([...png.data.subarray(offset,offset+3)],[16,45,70]);
   assert.equal(await page.locator('#ticketImage').evaluate(img=>img.naturalWidth),png.width);
   assert.deepEqual(errors,[]);assert.deepEqual(walletRequests,[]);assert.equal(await page.getByRole('button',{name:/Google Wallet|Apple Wallet/}).count(),0);
   await page.evaluate(()=>{window.print=()=>{window.printInvoked=true}});await page.getByRole('button',{name:'Print / Save as PDF'}).click();assert.equal(await page.evaluate(()=>window.printInvoked),true);
   await page.emulateMedia({media:'print'});for(const selector of ['nav','.ticket-intro','.ticket-actions','.ticket-wallets','.ticket-help'])assert.equal(await page.locator(selector).evaluate(e=>getComputedStyle(e).display),'none');
   const pdf=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true});await fs.writeFile(path.join(artifacts,name+'.pdf'),pdf);assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,1);
   await page.goBack();await page.waitForURL(base+'/');
   console.log(`PASS ${name}: complete 1360px PNG, original QR decoded, stable token, all events, one-page PDF, no clipping/errors or wallet calls`);
   await context.close();
  }
  const page=await browser.newPage();await page.goto(base+'/success.html');await page.waitForFunction(()=>document.getElementById('ticketStatus').textContent.includes('missing'));assert.equal(await page.locator('#downloadTicket').isDisabled(),true);
  await page.goto(base+'/success.html?token=missing-ticket');await page.waitForFunction(()=>document.getElementById('ticketStatus').textContent.includes('not found'));assert.equal(await page.locator('#printTicket').isDisabled(),true);
  console.log('PASS invalid/missing ticket links: useful errors, no empty downloads');console.log('Artifacts: '+artifacts);
 }finally{if(browser)await browser.close();await close()}
})().catch(err=>{console.error(err);process.exitCode=1});
