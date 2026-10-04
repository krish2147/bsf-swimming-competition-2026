// Reads a swim time as typed on the Timings desk and returns seconds (or null if it isn't a time).
// Accepts 36.42 · 00:36.42 · 0:36:42 · 00.36.42 · 1:05.20 · 36,42 · 36.42s · 0:00:36.42.
// Two numbers split by ":" are minutes:seconds, unless the first is 10 or more: no race here lasts
// 10 minutes, so 36:42 is 36.42 seconds. Shared by the server (results) and the Live timings page.
(function(root,factory){
  const parse=factory();
  if(typeof module==='object'&&module.exports)module.exports=parse;
  else root.BSFTimingSeconds=parse;
})(typeof globalThis!=='undefined'?globalThis:this,()=>function timingSeconds(text){
  const s=String(text??'').trim().toLowerCase().replace(/\s*(s|sec|secs|seconds)\.?$/,'').replace(/,/g,'.');
  if(!/^\d+(?:[:.;'"\s]+\d+){0,3}$/.test(s))return null;
  const n=s.split(/[:.;'"\s]+/),seps=s.match(/[:.;'"\s]+/g)||[],num=Number,frac=d=>num('0.'+d);
  let secs;
  if(n.length===1)secs=num(n[0]);
  else if(n.length===2)secs=seps[0]==='.'||num(n[0])>=10?num(n[0])+frac(n[1]):num(n[1])<60?num(n[0])*60+num(n[1]):null;
  else if(n.length===3)secs=num(n[1])<60?num(n[0])*60+num(n[1])+frac(n[2]):null;
  else secs=num(n[1])<60&&num(n[2])<60?num(n[0])*3600+num(n[1])*60+num(n[2])+frac(n[3]):null;
  return secs==null||!Number.isFinite(secs)||secs<=0?null:Math.round(secs*1000)/1000;
});
