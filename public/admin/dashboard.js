const {api,post,escape:esc,text,date,run}=Admin;
let page=1,requestVersion=0;
const filters=document.getElementById('registrationFilters');
async function loadRegistrations(){
  const version=++requestVersion,params=new URLSearchParams(new FormData(filters));params.set('page',page);
  const result=await api('/api/admin/registrations?'+params);
  if(version!==requestVersion)return;
  if(!result.rows.length&&page>1){page=1;return loadRegistrations()}
  document.getElementById('registrationRows').innerHTML=result.rows.map(r=>`<tr><td><button class="secondary" type="button" data-participant="${esc(r.registration_id)}">${text(r.registration_id)}</button></td><td>${text(r.full_name)}</td><td>${text(r.school_name)}</td><td>${text(r.gender)}</td><td>${text(r.dob)}<br>${text(r.age_category)}</td><td>${r.events_json.map(esc).join('<br>')||'No events recorded'}</td><td>${text(r.phone)}</td><td>${text(r.payment_status)}</td><td>${esc(date(r.created_at))}</td></tr>`).join('')||'<tr><td colspan="9">No registrations match these filters.</td></tr>';
  document.getElementById('registrationCount').textContent=`${result.total} registration(s)`;
  document.getElementById('pageInfo').textContent=`Page ${page} of ${Math.max(1,Math.ceil(result.total/result.limit))}`;
  document.getElementById('previousPage').disabled=page<=1;
  document.getElementById('nextPage').disabled=page*result.limit>=result.total;
}
async function overview(){const data=await api('/api/admin/overview');for(const key of ['registrations','checkedIn','paymentPending','paymentVerified','published'])document.getElementById(key).textContent=data[key]}
async function load(){
  const me=await api('/api/admin/me');if(!me.authenticated)return;
  document.getElementById('loginBox').classList.add('hidden');document.getElementById('dash').classList.remove('hidden');
  const config=await api('/api/config');
  document.getElementById('categoryFilter').innerHTML='<option value="">All categories</option>'+config.categories.map(c=>`<option>${esc(c.name)}</option>`).join('');
  document.getElementById('eventFilter').innerHTML='<option value="">All events</option>'+[...new Set(config.categories.flatMap(c=>c.events))].map(e=>`<option>${esc(e)}</option>`).join('');
  await Promise.all([overview(),loadRegistrations()]);
}
window.login=run(async()=>{await post('/api/admin/login',{pin:document.getElementById('pin').value});document.getElementById('pin').value='';await load()});
document.getElementById('pin').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
filters.addEventListener('submit',run(async e=>{e.preventDefault();page=1;await loadRegistrations()}));
filters.addEventListener('change',run(async()=>{page=1;await loadRegistrations()}));
filters.addEventListener('reset',()=>setTimeout(run(async()=>{page=1;await loadRegistrations()}),0));
document.getElementById('previousPage').onclick=run(async()=>{page--;await loadRegistrations()});
document.getElementById('nextPage').onclick=run(async()=>{page++;await loadRegistrations()});
document.addEventListener('admin-payment-updated',run(async()=>{await Promise.all([overview(),loadRegistrations()])}));
run(load)();
