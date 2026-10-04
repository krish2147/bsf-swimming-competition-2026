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
    assert.equal(lines[0],'Sr No,Registration ID,Participant,School,Gender,DOB,Age category,Events,Contact,Payment status,Check-in status');
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
   {await page.locator('#lanes').fill('11');await page.getByRole('button',{name:'Arrange heats',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('adminError').textContent.includes('Lanes per heat must be from 1 to 10'));
    await page.locator('#lanes').fill('4');await page.locator('#heatOrder').selectOption('name');await page.getByRole('button',{name:'Arrange heats',exact:true}).click();
    const lane=page.getByRole('spinbutton',{name:'Lane for '+participant,exact:true});await lane.waitFor();
    assert.equal(await page.locator('#adminError').textContent(),'');assert.equal(await page.getByRole('spinbutton',{name:'Heat for '+participant,exact:true}).inputValue(),'1');
    await lane.fill('5');await page.screenshot({path:path.join(artifacts,`${name}-heat-builder.png`),fullPage:true});
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Save heats',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('heatInfo').textContent.startsWith('Heats saved'));
    assert.equal(await page.locator(`[data-timing-row="${id}"] .pill`).first().textContent(),'Lane 5');
    assert.equal((await query('SELECT lane_no FROM race_entries WHERE event_key=$1 AND registration_id=$2',[key,id])).rows[0].lane_no,5);
    await page.getByRole('button',{name:'Edit saved heats',exact:true}).click();assert.equal(await page.getByRole('spinbutton',{name:'Lane for '+participant,exact:true}).inputValue(),'5');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('#heatBuilder').innerHTML(),'');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
   for(const [button,ext,magic] of [['Heat sheets (PDF)','pdf','%PDF-'],['Heat sheets (Word)','docx','PK']]){
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:button,exact:true}).click()]);
    assert.equal(download.suggestedFilename(),`heat-sheet-Under-12-Boys-25m-Freestyle.${ext}`);
    assert.equal((await fs.readFile(await download.path())).subarray(0,magic.length).toString(),magic,button);
   }
   page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Create heats for all events',exact:true}).click();
   await page.waitForFunction(()=>/Heats created for \d+ event/.test(document.getElementById('allHeatsInfo').textContent));
   {const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download full heat list (Word)',exact:true}).click()]);
    assert.match(download.suggestedFilename(),/^bsf-full-heat-list-\d{4}-\d{2}-\d{2}\.docx$/);assert.equal((await fs.readFile(await download.path())).subarray(0,2).toString(),'PK');}
   page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Create / Reset Heats'}).click();await page.locator('[data-timing-row]').first().waitFor();
   const timing=page.locator(`[data-timing-row="${id}"]`);await timing.locator('.timing-value').fill('00:36.42');await timing.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(id=>document.querySelector(`[data-timing-row="${id}"] .timing-state`)?.textContent==='Saved ✓',id);
   await page.goto(base+'/admin/results.html');await page.waitForFunction(()=>document.getElementById('event').options.length>1);await page.locator('#event').selectOption(key);await page.locator('#p1').selectOption(id);await page.locator('[data-position="1"]').click();await page.waitForFunction(()=>document.getElementById('msg').textContent==='Saved privately.');
   await page.goto(base+'/admin/checkin.html?token='+token);await page.locator('#approve').waitFor();await page.locator('#approve').click();await page.waitForFunction(()=>document.getElementById('checkinStatus').textContent==='Approved');
   await page.goto(base+'/admin/');await page.getByRole('button',{name:id,exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.getByRole('button',{name:'Show checked-in registrations'}).click();await page.waitForFunction(()=>document.getElementById('checkinFilter').value==='Approved');
   await page.waitForFunction(id=>[...document.querySelectorAll('#registrationRows tr')].length>0&&[...document.querySelectorAll('#registrationRows tr')].every(tr=>tr.textContent.includes('✓ Checked in'))&&document.getElementById('registrationRows').textContent.includes(id),id);
   await page.screenshot({path:path.join(artifacts,`${name}-dashboard.png`)});
   assert.deepEqual(errors,[],name+' console errors');assert.deepEqual(badResponses,[],name+' failed requests');
   console.log(`PASS ${name}: real form submission → PostgreSQL → admin list/search/filters → details/photo/proof → payment persisted → ticket → timings/results/check-in; no console/API errors`);
   await context.close();
  }
  // Edit participant details from the dashboard's participant dialog (phone-sized screen).
  {
   const target=(await query("SELECT registration_id FROM registrations WHERE full_name='Browser mobile Swimmer'")).rows[0].registration_id;
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});context.setDefaultTimeout(15000);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
   await page.goto(base+'/admin/');await page.locator('#pin').fill('test-pin');await page.getByRole('button',{name:'Enter',exact:true}).click();
   await page.getByRole('button',{name:target,exact:true}).tap();await page.locator('#participantDialog[open]').waitFor();
   await page.getByLabel('Participant name',{exact:true}).fill('');await page.getByRole('button',{name:'Save changes',exact:true}).tap();
   await page.waitForFunction(()=>document.getElementById('editMessage').textContent.includes('required'));
   await page.getByLabel('Participant name',{exact:true}).fill('Aarna Sawant');await page.getByRole('button',{name:'Save changes',exact:true}).tap();
   await page.waitForFunction(()=>document.getElementById('editMessage').textContent.startsWith('Saved.'));
   assert.ok((await page.locator('#participantDialog .admin-details').textContent()).includes('Aarna Sawant'));
   await page.screenshot({path:path.join(artifacts,'edit-details.png')});
   // Correct date of birth: 2015 (Under-12) → 2021 (Under-6). 25m Backstroke isn't an Under-6 event, so events must be chosen.
   await page.getByLabel('Date of birth',{exact:true}).fill('2021-01-01');await page.getByLabel('Date of birth',{exact:true}).dispatchEvent('change');
   await page.waitForFunction(()=>document.getElementById('dobPreview').textContent.includes('Under-12 → Under-6'));
   const keepFreestyle=page.locator('#dobEvents').getByLabel('25-meter Freestyle with/without Floaters');assert.equal(await keepFreestyle.isChecked(),true);
   assert.equal(await page.locator('#dobEvents').getByLabel('25m Freestyle Kick with Board / Floaters').isChecked(),false);
   await page.waitForFunction(()=>document.getElementById('dobPreview').textContent.includes('Fee: ₹600 → ₹300'));
   await page.screenshot({path:path.join(artifacts,'correct-dob.png')});
   page.once('dialog',d=>{assert.match(d.message(),/Category: Under-12 → Under-6/);d.accept()});await page.getByRole('button',{name:'Save date of birth',exact:true}).tap();
   await page.waitForFunction(()=>document.getElementById('dobMessage').textContent.startsWith('Saved.'));
   assert.match(await page.locator('#dobMessage').textContent(),/Under-6 · 25m Freestyle\. Fee changed ₹600 → ₹300/);
   assert.ok((await page.locator('#participantDialog .admin-details').textContent()).includes('2021-01-01'));
   assert.deepEqual((await query(`SELECT to_char(dob,'YYYY-MM-DD') dob,age_category,events_json,amount FROM registrations WHERE registration_id=$1`,[target])).rows[0],{dob:'2021-01-01',age_category:'Under-6',events_json:['25m Freestyle'],amount:300});
   await page.getByRole('button',{name:'Close participant details'}).tap();await page.waitForFunction(()=>document.getElementById('registrationRows').textContent.includes('Aarna Sawant'));
   assert.equal((await query('SELECT full_name FROM registrations WHERE registration_id=$1',[target])).rows[0].full_name,'Aarna Sawant');
   assert.deepEqual(errors,[],'edit details console errors');await context.close();
   console.log('PASS edit participant name: validation message, saved, dialog + list refreshed, database updated');
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
  // Registration closes automatically: the form is replaced by a closed notice on the register and home pages.
  {
   const previous=process.env.REGISTRATION_CLOSES_AT;process.env.REGISTRATION_CLOSES_AT='2026-10-02T00:00:00+05:30';
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
   try{
    const open=Date.now()<new Date('2026-10-02T00:00:00+05:30').getTime();
    if(!open){
     await page.goto(base+'/register.html');await page.locator('.registration-closed').first().waitFor();
     assert.equal(await page.locator('#form').isHidden(),true);
     assert.match(await page.locator('.registration-closed').first().textContent(),/Registration closed on 1 October 2026\. Already registered\? Find My Ticket\./);
    }
    process.env.REGISTRATION_CLOSES_AT=new Date(Date.now()-1000).toISOString();
    await page.goto(base+'/register.html');await page.locator('.registration-closed').first().waitFor();assert.equal(await page.locator('#form').isHidden(),true);
    const popup=page.getByRole('dialog',{name:'Registrations Closed'});await popup.waitFor();
    assert.match(await popup.textContent(),/Registrations for the 3rd Inter-School Swimming Competition are now closed/);
    await page.screenshot({path:path.join(artifacts,'registration-closed-popup.png')});
    await popup.getByRole('button',{name:'Close',exact:true}).tap();await popup.waitFor({state:'detached'});
    await page.screenshot({path:path.join(artifacts,'registration-closed.png')});
    assert.equal(await page.locator('.registration-extended').count(),0,'no extension line once closed');
    await page.goto(base+'/');await page.locator('.registration-closed').first().waitFor();
    assert.equal(await page.locator('.registration-closed a').first().getAttribute('href'),'/find-ticket.html');
    const homePopup=page.getByRole('dialog',{name:'Registrations Closed'});await homePopup.waitFor();
    assert.equal(await homePopup.getByRole('link',{name:'Find My Ticket'}).getAttribute('href'),'/find-ticket.html');
    await homePopup.getByRole('link',{name:'Find My Ticket'}).tap();await page.waitForURL('**/find-ticket.html');
    assert.equal(await page.getByRole('dialog').count(),0,'no popup on Find My Ticket');
    // Admin late entry: logged-in admins still get the form (no popup) and their entry is saved.
    await page.goto(base+'/admin/');await page.locator('#pin').fill('test-pin');await page.getByRole('button',{name:'Enter',exact:true}).tap();await page.locator('#dash:not(.hidden)').waitFor();
    await page.goto(base+'/register.html');await page.locator('.registration-late-entry').first().waitFor();
    assert.equal(await page.locator('#form').isVisible(),true);assert.equal(await page.locator('.registration-closed-dialog').count(),0,'no closed popup for admins');
    await page.screenshot({path:path.join(artifacts,'admin-late-entry.png')});
    await page.locator('#fullName').fill('Abdullah Parvezahmed Shaikh');await page.locator('#schoolName').fill('Reliance English Medium School');await page.locator('#gender').selectOption('Boys');await page.locator('#dobInput').fill('2018-01-28');await page.locator('#email').fill('parent@example.com');await page.locator('#phone').fill('9988771144');
    await page.getByLabel('25m Freestyle',{exact:true}).check();await page.getByLabel('50m Freestyle',{exact:true}).check();
    await page.locator('#participantPhoto').setInputFiles(path.join(__dirname,'../public/bsf-logo.jpeg'));await page.locator('#paymentProof').setInputFiles(path.join(__dirname,'../public/bsf-payment-qr.jpeg'));
    await page.locator('#submitBtn').click();await page.waitForURL('**/success.html?token=*');
    assert.equal((await query("SELECT age_category FROM registrations WHERE full_name='Abdullah Parvezahmed Shaikh'")).rows[0].age_category,'Under-10');
    process.env.REGISTRATION_CLOSES_AT='2100-01-02T00:00:00+05:30';
    await page.goto(base+'/register.html');await page.waitForFunction(()=>!document.getElementById('submitBtn').disabled);
    assert.equal(await page.locator('#form').isVisible(),true);assert.equal(await page.locator('.registration-closed').count(),0);
    assert.equal(await page.locator('.registration-closed-dialog').count(),0,'no popup while open');
    assert.match(await page.locator('.registration-deadline time').first().textContent(),/^1 January 2100$/,'deadline notice follows the configured date');
    assert.equal(await page.locator('.registration-extended').first().textContent(),'Registration extended by one day!');assert.equal(await page.locator('.registration-extended').first().isVisible(),true);
    await page.locator('.registration-deadline').first().screenshot({path:path.join(artifacts,'registration-extended.png')});
    assert.deepEqual(errors,[],'registration closed console errors');
    console.log('PASS registration closes automatically: closed notice + hidden form after the deadline; open form and configured date before it');
   }finally{process.env.REGISTRATION_CLOSES_AT=previous;await context.close()}
  }
  // Participation certificate on the ticket page and Find My Ticket (parent's phone).
  {
   const previous=process.env.CERTIFICATES_FROM,kid=(await query("SELECT ticket_token,phone,to_char(dob,'YYYY-MM-DD') dob FROM registrations WHERE full_name='Browser tablet Swimmer'")).rows[0];
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});context.setDefaultTimeout(20000);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   try{
    process.env.CERTIFICATES_FROM='2100-01-01T00:00:00+05:30';
    await page.goto(base+'/success.html?token='+kid.ticket_token);await page.locator('.certificate-note').waitFor();
    assert.match(await page.locator('.certificate-note').textContent(),/from 1 January 2100/);assert.equal(await page.locator('#downloadCertificate').isHidden(),true);
    process.env.CERTIFICATES_FROM=new Date(Date.now()-1000).toISOString();
    await page.evaluate(()=>sessionStorage.clear());
    await page.goto(base+'/success.html?token='+kid.ticket_token);
    // First visit: the WhatsApp popup is open over the ticket and offers the certificate too.
    const popupButton=page.locator('#popupDownloadCertificate');await popupButton.waitFor();
    const [fromPopup]=await Promise.all([page.waitForEvent('download'),popupButton.tap()]);assert.equal(fromPopup.suggestedFilename(),'BSF-Participation-Certificate-Browser-tablet-Swimmer.pdf');
    await page.getByRole('button',{name:'Stay on ticket page'}).tap();
    const button=page.locator('#downloadCertificate');await button.waitFor();
    const [certificate]=await Promise.all([page.waitForEvent('download'),button.tap()]);
    assert.equal(certificate.suggestedFilename(),'BSF-Participation-Certificate-Browser-tablet-Swimmer.pdf');assert.equal((await fs.readFile(await certificate.path())).subarray(0,5).toString(),'%PDF-');
    await page.goto(base+'/find-ticket.html');await page.locator('#recoveryPhone').fill(kid.phone);await page.locator('#recoveryDob').fill(kid.dob);await page.locator('#recoverySubmit').tap();
    const link=page.getByRole('link',{name:'Download Participation Certificate'}).first();await link.waitFor();assert.equal(await link.getAttribute('href'),'/api/certificate/'+kid.ticket_token);
    await page.screenshot({path:path.join(artifacts,'find-ticket-certificate.png'),fullPage:true});
    assert.deepEqual(errors,[],'certificate page errors');
    console.log('PASS participation certificate: note before competition day; download from ticket page; link on Find My Ticket');
   }finally{if(previous===undefined)delete process.env.CERTIFICATES_FROM;else process.env.CERTIFICATES_FROM=previous;await context.close()}
  }
  // Admin manual entry from the dashboard (phone-sized): minimal details, events follow the DOB category.
  {
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});context.setDefaultTimeout(20000);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
   await page.goto(base+'/admin/');await page.locator('#pin').fill('test-pin');await page.getByRole('button',{name:'Enter',exact:true}).tap();await page.locator('#dash:not(.hidden)').waitFor();
   await page.getByRole('button',{name:'+ Add participant',exact:true}).tap();const dialog=page.getByRole('dialog',{name:'Add participant'});await dialog.waitFor();
   await dialog.getByLabel('Swimmer full name *').fill('Aum Tilavat');await dialog.getByLabel('School *').fill('Manual Test School');await dialog.getByLabel('Gender *').selectOption('Boys');
   await dialog.getByLabel('Date of birth *').fill('2015-01-15');await dialog.getByLabel('Date of birth *').dispatchEvent('change');
   await page.waitForFunction(()=>document.getElementById('addCategory').textContent.includes('Under-12'));
   await dialog.getByLabel('50m Freestyle',{exact:true}).check();await dialog.getByLabel('Payment note / UTR').fill('Cash paid at desk');
   await page.screenshot({path:path.join(artifacts,'admin-add-participant.png')});
   await dialog.getByRole('button',{name:'Add participant',exact:true}).tap();
   await page.waitForFunction(()=>document.getElementById('addMessage').textContent.startsWith('Added BSF26-'));
   assert.match(await page.locator('#addMessage').textContent(),/Under-12 · ₹300 · Payment Pending/);
   assert.equal(await dialog.getByRole('link',{name:'Open ticket'}).count(),1);
   await dialog.getByRole('button',{name:'Close add participant'}).tap();await page.waitForFunction(()=>document.getElementById('registrationRows').textContent.includes('Aum Tilavat'));
   assert.equal((await query("SELECT age_category FROM registrations WHERE full_name='Aum Tilavat'")).rows[0].age_category,'Under-12');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual(errors,[],'manual entry console errors');await context.close();
   console.log('PASS admin manual entry: dashboard form, DOB → category events, saved and listed');
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
