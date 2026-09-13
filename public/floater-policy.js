(function(root,factory){
  const policy=factory();
  if(typeof module==='object'&&module.exports)module.exports=policy;
  else root.BSFFloaters=policy;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  function requiresFloaters(category,events){
    const name=typeof category==='string'?category:category?.name;
    const marked=category?.floaterEvents||[];
    return name==='Under-6'&&Array.isArray(events)&&events.some(event=>
      typeof event==='string'&&(/\bwith\s+floaters\b/i.test(event)||marked.includes(event))
    );
  }
  const reminder='Bring Your Own Floaters — BSF/School will not provide floaters for this event.';
  return {requiresFloaters,reminder};
});
