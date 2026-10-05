// Ticket page: offers the participation certificate (from competition day) for this ticket's swimmer.
(async()=>{
  const token=new URLSearchParams(location.search).get('token'),button=document.getElementById('downloadCertificate');
  if(!token||!button)return;
  try{
    const response=await fetch('/api/ticket/'+encodeURIComponent(token));if(!response.ok)return;
    const data=await response.json();if(!data.certificateUrl)return;
    if(data.certificateAvailable){
      const download=()=>{location.href=data.certificateUrl};
      button.hidden=false;button.onclick=download;
      // Merit certificates: one per event where the swimmer finished 1st, 2nd or 3rd.
      const medal={1:'🥇',2:'🥈',3:'🥉'};let after=button;
      for(const m of data.meritCertificates||[]){
        const link=document.createElement('a');link.className='btn merit-certificate';link.href=m.url;
        link.textContent=`${medal[m.position]||'🏅'} Download Merit Certificate — ${m.positionLabel} · ${m.event}`;after.after(link);after=link;
      }
      // The WhatsApp popup opens over the ticket on a first visit, so offer the certificate there too.
      const popupActions=document.querySelector('.whatsapp-dialog-actions');
      if(popupActions&&!document.getElementById('popupDownloadCertificate')){const popupButton=document.createElement('button');popupButton.type='button';popupButton.id='popupDownloadCertificate';popupButton.textContent='Download Participation Certificate';popupButton.onclick=download;popupActions.prepend(popupButton)}
      return;
    }
    const note=document.createElement('p');note.className='ticket-help certificate-note';
    note.textContent='Your Participation Certificate can be downloaded from this page from '+new Date(data.certificateAvailableFrom).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'long',year:'numeric'})+'.';
    button.closest('.ticket-actions').after(note);
  }catch{}
})();
