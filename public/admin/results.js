const {api,post,escape:esc,text,run}=Admin;
const eventSelect=document.getElementById('event'),panel=document.getElementById('panel');
let requestVersion=0;
window.openEvent=run(async()=>{
 const version=++requestVersion,key=eventSelect.value;panel.replaceChildren();if(!key)return;
 const [people,data]=await Promise.all([api('/api/admin/event-participants?eventKey='+encodeURIComponent(key)),api('/api/admin/results?eventKey='+encodeURIComponent(key))]);
 if(version!==requestVersion)return;
 const existing=Object.fromEntries(data.entries.map(x=>[x.position,x.registration_id]));
 panel.innerHTML=`<div class="card"><h2>Podium Draft</h2>${[1,2,3].map(p=>`<label for="p${p}">${p===1?'🥇 First':p===2?'🥈 Second':'🥉 Third'}</label><select id="p${p}"><option value="">Select swimmer</option>${people.map(r=>`<option value="${esc(r.registration_id)}" ${existing[p]===r.registration_id?'selected':''}>${text(r.full_name)} — ${text(r.school_name)}</option>`).join('')}</select><button class="secondary" data-position="${p}">Save</button><br><br>`).join('')}<p>Status: <b>${data.published?'PUBLIC':'PRIVATE DRAFT'}</b></p><button class="good" id="publish">Publish Results + Timings</button> <button class="bad" id="unpublish">Unpublish</button><p id="msg" role="status"></p></div>`;
 for(const button of panel.querySelectorAll('[data-position]'))button.onclick=run(async()=>{const position=Number(button.dataset.position),id=document.getElementById('p'+position).value;if(!id)return;await post('/api/admin/result',{eventKey:key,position,registrationId:id});document.getElementById('msg').textContent='Saved privately.'});
 document.getElementById('publish').onclick=run(async()=>{if(!confirm('Mic announcement done? Publish results and timings now?'))return;await post('/api/admin/publish-event',{eventKey:key});await openEvent()});
 document.getElementById('unpublish').onclick=run(async()=>{await post('/api/admin/unpublish-event',{eventKey:key});await openEvent()});
});
run(async()=>{if(!await Admin.authenticated())return;const events=await api('/api/admin/events');eventSelect.innerHTML='<option value="">Select event</option>'+events.map(e=>`<option value="${esc(e.key)}">${text(e.category)} • ${text(e.gender)} • ${text(e.event)}</option>`).join('')})();
