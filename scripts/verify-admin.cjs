// Real browser + application routes + embedded PostgreSQL; no API mocks.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
const {start,close,query}=require('../test-support/admin-harness.cjs');
const {writeQrCamera}=require('../test-support/fake-camera.cjs');
(async()=>{
 const base=await start();let browser;
 const artifacts=process.env.ADMIN_TEST_ARTIFACTS||path.join(os.tmpdir(),'bsf-admin-verification');await fs.mkdir(artifacts,{recursive:true});
 try{
  const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  for(const [name,width,height,mobile] of [['desktop',1440,1000,false],['mobile',390,844,true],['tablet',768,1024,true]]){
   const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile});
   context.setDefaultTimeout(15000);
   const page=await context.newPage(),errors=[],badResponses=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
   page.on('response',r=>{if(r.status()>=400)badResponses.push(`${r.status()} ${r.url()}`)});
   await page.goto(base+'/register.html');await page.waitForFunction(()=>!document.getElementById('submitBtn').disabled);
   const participant=`Browser ${name} Swimmer`;
   await page.locator('#fullName').fill(participant);await page.locator('#schoolName').fill('Browser Test School');await page.locator('#gender').selectOption('Boys');await page.locator('#dobInput').fill('2015-05-01');assert.equal(await page.locator('#email').evaluate(e=>e.required&&!e.checkValidity()),true);await page.locator('#email').fill('invalid-email');assert.equal(await page.locator('#email').evaluate(e=>e.checkValidity()),false);await page.locator('#email').fill('parent@example.com');await page.locator('#phone').fill('9988771122');
   await page.getByLabel('25m Freestyle',{exact:true}).check();await page.getByLabel('25m Backstroke',{exact:true}).check();
   await page.locator('#participantPhoto').setInputFiles(path.join(__dirname,'../public/bsf-logo.jpeg'));await page.locator('#paymentProof').setInputFiles(path.join(__dirname,'../public/bsf-payment-qr.jpeg'));
   await page.locator('#submitBtn').click();await page.waitForURL('**/success.html?token=*');await page.locator('#ticketImage[src]').waitFor();
   console.log(name+': registration saved');
   const token=new URL(page.url()).searchParams.get('token');const row=(await query('SELECT registration_id,events_json FROM registrations WHERE ticket_token=$1',[token])).rows[0];assert.ok(row);assert.deepEqual(row.events_json,['25m Freestyle','25m Backstroke']);const id=row.registration_id;
   await page.goto(base+'/admin/');await page.locator('#pin').fill('test-pin');await page.getByRole('button',{name:'Enter',exact:true}).click();await page.locator('#dash:not(.hidden)').waitFor();await page.getByRole('button',{name:id,exact:true}).waitFor();
   assert.ok((await page.locator('#registrationRows').textContent()).includes('25m Backstroke'));
   for(const search of [id,participant,'Browser Test School','9988771122']){await page.locator('#registrationSearch').fill(search);await page.getByRole('button',{name:'Search / Filter'}).click();await page.getByRole('button',{name:id,exact:true}).waitFor()}
   await page.locator('#categoryFilter').selectOption('Under-12');await page.locator('#genderFilter').selectOption('Boys');await page.locator('#eventFilter').selectOption('25m Backstroke');await page.locator('#paymentFilter').selectOption('Pending');
   {const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download CSV',exact:true}).click()]);
    assert.match(download.suggestedFilename(),/^bsf-registrations-Under-12-Boys-25m-Backstroke-Pending-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv=await fs.readFile(await download.path(),'utf8'),lines=csv.replace(/^\uFEFF/,'').trim().split('\r\n');
    assert.equal(lines[0],'Sr No,Registration ID,Participant,School,Gender,DOB,Age category,Events,Contact,Payment status,Check-in status,Heat,Lane');
    const mine=lines.find(line=>line.includes(id));assert.ok(mine&&mine.includes(participant)&&mine.includes('25m Freestyle; 25m Backstroke')&&mine.includes(',Pending,'),'filtered CSV row');
    assert.ok(lines.slice(1).every(line=>line.includes(',Boys,')&&line.includes(',Under-12,')&&line.includes('25m Backstroke')),'CSV only has filtered swimmers');
    assert.equal(lines.length-1,Number((await page.locator('#registrationCount').textContent()).match(/\d+/)[0]),'CSV row count matches on-screen total');}
   await page.getByRole('button',{name:id,exact:true}).click();await page.locator('#participantDialog[open]').waitFor();assert.ok((await page.locator('#participantDialog').textContent()).includes(participant));
   await page.screenshot({path:path.join(artifacts,`${name}-details.png`)});
   for(const label of ['Participant photo','Payment proof']){
    const button=page.getByRole('button',{name:'Enlarge '+label,exact:true});if(mobile)await button.tap();else await button.click();await page.locator('#mediaDialog[open] img').evaluate(img=>img.decode());
    const rect=await page.locator('#mediaDialog[open] img').boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width&&rect.y+rect.height<=height);
    await page.screenshot({path:path.join(artifacts,`${name}-${label.replaceAll(' ','-')}.png`)});
    await page.getByRole('button',{name:'Close registration image'}).click();assert.equal(await page.locator('#participantDialog').evaluate(e=>e.open),true);
   }
   await page.locator('#participantDialog').getByRole('button',{name:'Verified',exact:true}).click();await page.waitForFunction(()=>document.getElementById('detailPaymentStatus').textContent==='Verified');
   assert.equal((await query('SELECT payment_status FROM registrations WHERE registration_id=$1',[id])).rows[0].payment_status,'Verified');
   await page.getByRole('button',{name:'Close participant details'}).click();await page.locator('#paymentFilter').selectOption('Verified');await page.getByRole('button',{name:id,exact:true}).waitFor();
   await page.reload();await page.getByRole('button',{name:id,exact:true}).waitFor();assert.ok(Number(await page.locator('#paymentVerified').textContent())>=1);
   await page.getByRole('button',{name:id,exact:true}).click();await page.getByRole('link',{name:'Open registration ticket'}).click();await page.waitForURL('**/success.html?token=*');await page.locator('#ticketImage[src]').waitFor();
   await page.goto(base+'/admin/payments.html');await page.locator('[data-payment-id]').first().waitFor();
   const card=page.locator('.card').filter({has:page.getByRole('button',{name:id,exact:true})});await card.getByRole('button',{name:'Enlarge Payment proof',exact:true}).click();await page.locator('#mediaDialog[open] img').evaluate(img=>img.decode());await page.keyboard.press('Escape');
   await card.getByRole('button',{name:'Issue',exact:true}).click();await page.waitForFunction(id=>[...document.querySelectorAll('[data-payment-label]')].find(e=>e.dataset.paymentLabel===id)?.textContent==='Issue',id);
   await page.reload();assert.equal(await page.locator(`[data-payment-label="${id}"]`).textContent(),'Issue');
   console.log(name+': details/media/payment persistence verified');
   await page.goto(base+'/admin/timings.html');const key='Under-12|||Boys|||25m Freestyle';await page.locator('#event option').filter({hasText:'25m Freestyle ('}).waitFor({state:'attached'});await page.locator('#event').selectOption(key);
   {const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download swimmers CSV',exact:true}).click()]);
    const csv=await fs.readFile(await download.path(),'utf8');assert.ok(csv.split('\r\n')[0].endsWith(',Heat,Lane')&&csv.includes(id),'event CSV has Heat/Lane columns and this swimmer');
    await page.locator('#heatCsv').setInputFiles({name:'heats.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.locator('#lanes').fill('4');
    await page.getByRole('button',{name:'Preview heats',exact:true}).click();await page.locator('[data-preview-heat="1"]').waitFor();
    assert.ok((await page.locator('#heatPreview').textContent()).includes(participant));await page.screenshot({path:path.join(artifacts,`${name}-heat-import-preview.png`),fullPage:true});
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Save these heats',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('heatInfo').textContent.startsWith('Imported from CSV'));await page.locator(`[data-timing-row="${id}"]`).waitFor();
    assert.equal(await page.locator('#heatPreview').innerHTML(),'');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
   page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Create / Reset Heats'}).click();await page.locator('[data-timing-row]').first().waitFor();
   const timing=page.locator(`[data-timing-row="${id}"]`);await timing.locator('.timing-value').fill('00:36.42');await timing.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(id=>document.querySelector(`[data-timing-row="${id}"] .timing-state`)?.textContent==='Saved ✓',id);
   await page.goto(base+'/admin/results.html');await page.waitForFunction(()=>document.getElementById('event').options.length>1);await page.locator('#event').selectOption(key);await page.locator('#p1').selectOption(id);await page.locator('[data-position="1"]').click();await page.waitForFunction(()=>document.getElementById('msg').textContent==='Saved privately.');
   await page.goto(base+'/admin/checkin.html?token='+token);await page.locator('#approve').waitFor();await page.locator('#approve').click();await page.waitForFunction(()=>document.getElementById('checkinStatus').textContent==='Approved');
   await page.goto(base+'/admin/');await page.getByRole('button',{name:id,exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(artifacts,`${name}-dashboard.png`)});
   assert.deepEqual(errors,[],name+' console errors');assert.deepEqual(badResponses,[],name+' failed requests');
   console.log(`PASS ${name}: real form submission → PostgreSQL → admin list/search/filters → details/photo/proof → payment persisted → ticket → timings/results/check-in; no console/API errors`);
   await context.close();
  }
  // Check-in camera scanner: Chromium's fake webcam shows a real ticket QR (checkin URL), decoded in-page.
  {
   const scanned=(await query(`SELECT registration_id,ticket_token FROM registrations ORDER BY created_at LIMIT 1`)).rows[0];
   const video=path.join(artifacts,'ticket-qr.y4m');await writeQrCamera(video,`https://bsf.example/admin/checkin.html?token=${scanned.ticket_token}`);
   const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
   const cameraBrowser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-video-capture=${video}`]});
   try{
    const context=await cameraBrowser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['camera']});context.setDefaultTimeout(15000);
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    await page.goto(base+'/admin/');await page.locator('#pin').fill('test-pin');await page.getByRole('button',{name:'Enter',exact:true}).click();await page.locator('#dash:not(.hidden)').waitFor();
    await page.goto(base+'/admin/checkin.html');
    assert.deepEqual(await page.evaluate(()=>['https://x.test/admin/checkin.html?token=0f8fad5b-d9cb-469f-a165-70867728950e','0F8FAD5B-D9CB-469F-A165-70867728950E','https://x.test/?token=nope','hello',''].map(CheckinScanner.tokenFromScan)),['0f8fad5b-d9cb-469f-a165-70867728950e','0F8FAD5B-D9CB-469F-A165-70867728950E',null,null,null]);
    await page.getByRole('button',{name:'Scan QR',exact:true}).tap();
    await page.waitForFunction(token=>document.getElementById('token').value===token,scanned.ticket_token);await page.locator('#reject').waitFor();
    assert.ok(page.url().endsWith('?token='+scanned.ticket_token));assert.equal(await page.locator('#scanner').isHidden(),true);
    assert.equal(await page.evaluate(()=>document.getElementById('scanVideo').srcObject),null,'camera released after scan');
    await page.screenshot({path:path.join(artifacts,'scanner-ticket.png')});
    await page.locator('#reason').fill('Scanner test');await page.locator('#reject').tap();await page.waitForFunction(()=>document.getElementById('checkinStatus').textContent==='Rejected');
    assert.equal((await query('SELECT checkin_status FROM registrations WHERE registration_id=$1',[scanned.registration_id])).rows[0].checkin_status,'Rejected');
    await page.getByRole('button',{name:'Scan next ticket',exact:true}).tap();await page.locator('#scanner:not(.hidden)').waitFor();assert.equal(await page.locator('#card').innerHTML(),'');
    await page.locator('#reject').waitFor();await page.getByRole('button',{name:'Scan QR',exact:true}).tap();await page.locator('#scanner:not(.hidden)').waitFor();
    await page.getByRole('button',{name:'Stop scanning',exact:true}).tap();await page.locator('#scanner').waitFor({state:'hidden'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[],'scanner console errors');await context.close();
    const denied=await cameraBrowser.newContext();
    const deniedPage=await denied.newPage();await deniedPage.goto(base+'/admin/');await deniedPage.locator('#pin').fill('test-pin');await deniedPage.getByRole('button',{name:'Enter',exact:true}).click();await deniedPage.locator('#dash:not(.hidden)').waitFor();
    await deniedPage.goto(base+'/admin/checkin.html');await deniedPage.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('denied','NotAllowedError'))});await deniedPage.getByRole('button',{name:'Scan QR',exact:true}).click();
    await deniedPage.waitForFunction(()=>document.getElementById('scanError').textContent.includes('Camera permission was blocked'));assert.equal(await deniedPage.locator('#scanner').isHidden(),true);assert.equal(await deniedPage.locator('#scanBtn').isEnabled(),true);
    await denied.close();
    console.log('PASS check-in scanner: fake camera QR → token → ticket opened → decision saved → scan next / stop; permission-denied message');
   }finally{await cameraBrowser.close()}
  }
  // Hostile legacy strings must be inert on every desk, including the existing ticket.
  const legacy=(await query('SELECT registration_id,ticket_token FROM registrations LIMIT 1')).rows[0];
  await query('UPDATE registrations SET full_name=$1,school_name=$1,events_json=$2::jsonb WHERE registration_id=$3',["<img src=x onerror=\"window.adminXss=true\">",JSON.stringify({bad:'legacy'}),legacy.registration_id]);
  await query('ALTER TABLE registrations ALTER COLUMN participant_photo DROP NOT NULL');await query('ALTER TABLE registrations ALTER COLUMN payment_proof DROP NOT NULL');
  await query('UPDATE registrations SET participant_photo=NULL,payment_proof=NULL WHERE registration_id=$1',[legacy.registration_id]);
  const context=await browser.newContext({viewport:{width:320,height:568},isMobile:true,hasTouch:true}),page=await context.newPage();
  await page.goto(base+'/admin/');await page.locator('#pin').fill('test-pin');await page.getByRole('button',{name:'Enter',exact:true}).click();await page.getByRole('button',{name:legacy.registration_id,exact:true}).click();
  await page.locator('#participantDialog[open]').waitFor();assert.ok((await page.locator('#participantDialog').textContent()).includes('Participant photo unavailable'));assert.ok((await page.locator('#participantDialog').textContent()).includes('No events recorded'));assert.equal(await page.evaluate(()=>window.adminXss),undefined);
  await page.screenshot({path:path.join(artifacts,'small-mobile-legacy.png')});await context.close();console.log('PASS legacy malformed events / null media / hostile text at 320px');
  const anon=await browser.newContext();const anonymousPage=await anon.newPage();for(const route of ['payments','timings','results','checkin']){await anonymousPage.goto(base+`/admin/${route}.html`);await anonymousPage.waitForURL(base+'/admin/');await anonymousPage.locator('#loginBox:not(.hidden)').waitFor()}await anon.close();console.log('PASS unauthenticated admin desks redirect to login');
  console.log('Screenshots: '+artifacts);
 }finally{if(browser)await browser.close();await close()}
})().catch(err=>{console.error(err);process.exitCode=1});
