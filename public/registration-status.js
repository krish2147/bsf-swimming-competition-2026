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
      notice.replaceChildren();
      const strong=document.createElement('strong'),time=document.createElement('time');time.dateTime=day.iso;time.textContent=day.label;
      if(config.registrationOpen){strong.textContent='Registration Deadline:';notice.append(strong,' ',time)}
      else{notice.classList.add('registration-closed');strong.textContent='Registration closed';notice.append(strong,' on ',time,'. Already registered? ');const link=document.createElement('a');link.href='/find-ticket.html';link.textContent='Find My Ticket';notice.append(link,'.')}
    }
    return config;
  }).catch(()=>null);
})();
