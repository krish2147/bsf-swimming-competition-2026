// Keeps the "Registration Deadline" notices in sync with the server's closing time, and marks
// registration as closed once it has passed. The register page also hides its form when closed.
(()=>{
  const lastDay=closesAt=>{
    const last=new Date(new Date(closesAt).getTime()-1);
    return {label:last.toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'long',year:'numeric'}),iso:last.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})};
  };
  window.BSFRegistrationStatus=fetch('/api/config').then(r=>r.ok?r.json():null).then(config=>{
    if(!config||!config.registrationClosesAt)return config;
    const day=lastDay(config.registrationClosesAt);
    for(const notice of document.querySelectorAll('.registration-deadline')){
      const extended=notice.querySelector('.registration-extended');notice.replaceChildren();
      const strong=document.createElement('strong'),time=document.createElement('time');time.dateTime=day.iso;time.textContent=day.label;
      if(config.tournamentClosed&&!config.lateEntry){notice.classList.add('registration-closed');strong.textContent='The competition has concluded.';notice.append(strong,' Thank you to every swimmer, parent and school! ');const link=document.createElement('a');link.href='/find-ticket.html';link.textContent='Download your participation certificate';notice.append(link,'.')}
      else if(config.lateEntry){notice.classList.add('registration-late-entry');strong.textContent='Admin late entry:';notice.append(strong,' registration closed to the public on ',time,'. Entries you submit here are accepted and recorded in the audit log.')}
      else if(config.registrationOpen){strong.textContent='Registration Deadline:';if(extended)notice.append(extended,' ');notice.append(strong,' ',time)}
      else{notice.classList.add('registration-closed');strong.textContent='Registration closed';notice.append(strong,' on ',time,'. Already registered? ');const link=document.createElement('a');link.href='/find-ticket.html';link.textContent='Find My Ticket';notice.append(link,'.')}
    }
    // No popup once the competition is over; the notice above links to the certificates instead.
    if(!config.registrationOpen&&!config.lateEntry&&!config.tournamentClosed)showClosedPopup(false);
    return config;
  }).catch(()=>null);
  // Popup shown each time a public page is opened after registration has closed; once the competition is over
  // it announces that participation certificates are ready, with a button straight to Find My Ticket.
  function showClosedPopup(concluded){
    const dialog=document.createElement('dialog');
    dialog.className='registration-closed-dialog';dialog.setAttribute('aria-labelledby','registrationClosedTitle');
    dialog.innerHTML=concluded
      ?'<p class="registration-closed-icon" aria-hidden="true">🏅</p><h2 id="registrationClosedTitle">Participation Certificates are Live!</h2>'
      +'<p>Thank you for being part of the 3rd Inter-School Swimming Competition 2026. Your child\'s <b>participation certificate</b> is ready — please download it.</p>'
      +'<p class="registration-closed-note">Tap below, enter the parent\'s phone number and the swimmer\'s date of birth, then tap <b>Download Participation Certificate</b>. 🥇🥈🥉 Medal winners can also download their <b>Merit Certificate</b> there.</p>'
      +'<div class="registration-closed-actions stacked"><a class="btn" href="/find-ticket.html">Download Certificate — Find My Ticket</a><button type="button" class="secondary">Close</button></div>'
      :'<p class="registration-closed-icon" aria-hidden="true">🏊</p><h2 id="registrationClosedTitle">Registrations Closed</h2>'
      +'<p>Registrations for the 3rd Inter-School Swimming Competition are now closed. Thank you for the amazing response!</p>'
      +'<p class="registration-closed-note">Already registered? Use <b>Find My Ticket</b> to get your entry pass. See you on <b>4 October 2026</b> in Vadodara.</p>'
      +'<div class="registration-closed-actions"><a class="btn" href="/find-ticket.html">Find My Ticket</a><button type="button" class="secondary" autofocus>Close</button></div>';
    dialog.querySelector('button').onclick=()=>dialog.close();
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
    dialog.addEventListener('close',()=>dialog.remove());
    document.body.append(dialog);
    if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  }
})();
