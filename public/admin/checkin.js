const {api,post,escape:esc,text,run,media}=Admin;
window.lookup=run(async()=>{
 const token=document.getElementById('token').value.trim();if(!token)throw Error('Enter a ticket token.');
 document.getElementById('card').replaceChildren();
 const d=await api('/api/admin/checkin/'+encodeURIComponent(token));
 document.getElementById('card').innerHTML=`<div class="card"><button class="secondary" type="button" data-participant="${esc(d.registrationId)}">${text(d.registrationId)} — Full details</button><div class="grid"><div>${media(d.photo,'Participant photo')}<h2>${text(d.fullName)}</h2><p>${text(d.schoolName)}</p><p><b>${text(d.category)} • ${text(d.gender)}</b></p><p>DOB: ${text(d.dob)}</p><p>Current status: <b id="checkinStatus">${text(d.checkinStatus)}</b></p></div><div><h3>Payment proof</h3>${media(d.paymentProof,'Payment proof')}<p>Payment review: ${text(d.paymentStatus)}</p><h3>Events</h3><p>${d.events.map(esc).join('<br>')||'No events recorded'}</p></div></div><label for="reason">Rejection reason</label><input id="reason"><div class="row"><button class="good" id="approve">Approve</button><button class="bad" id="reject">Reject</button></div><p id="decision" role="status"></p></div>`;
 for(const [id,decision] of [['approve','Approved'],['reject','Rejected']])document.getElementById(id).onclick=run(async()=>{const d=await post('/api/admin/checkin/'+encodeURIComponent(token),{decision,reason:document.getElementById('reason').value});document.getElementById('decision').textContent='Saved: '+d.status;document.getElementById('checkinStatus').textContent=d.status});
});
run(async()=>{if(!await Admin.authenticated())return;const token=new URLSearchParams(location.search).get('token');if(token){document.getElementById('token').value=token;await lookup()}})();
