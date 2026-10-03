// Ticket page: offers the participation certificate (from competition day) for this ticket's swimmer.
(async()=>{
  const token=new URLSearchParams(location.search).get('token'),button=document.getElementById('downloadCertificate');
  if(!token||!button)return;
  try{
    const response=await fetch('/api/ticket/'+encodeURIComponent(token));if(!response.ok)return;
    const data=await response.json();if(!data.certificateUrl)return;
    if(data.certificateAvailable){button.hidden=false;button.onclick=()=>{location.href=data.certificateUrl};return}
    const note=document.createElement('p');note.className='ticket-help certificate-note';
    note.textContent='Your Participation Certificate can be downloaded from this page from '+new Date(data.certificateAvailableFrom).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'long',year:'numeric'})+'.';
    button.closest('.ticket-actions').after(note);
  }catch{}
})();
