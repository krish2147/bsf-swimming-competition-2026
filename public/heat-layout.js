// Fills heats to the lane count; only when the last heat would be tiny (1 or 2 swimmers)
// are the last two heats shared out evenly, bigger first: 13 swimmers, 6 lanes → 6 / 4 / 3.
// Shared by the server ("Create / Reset Heats") and the Timings page ("Arrange heats").
(function(root,factory){
  const layout=factory();
  if(typeof module==='object'&&module.exports)module.exports=layout;
  else root.BSFHeatLayout=layout;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const SMALL_LAST_HEAT=2;
  function heatSizes(swimmers,lanes){
    if(!Number.isInteger(swimmers)||swimmers<1||!Number.isInteger(lanes)||lanes<1)return [];
    const heats=Math.ceil(swimmers/lanes),sizes=Array.from({length:heats},(_,i)=>Math.min(lanes,swimmers-i*lanes));
    if(heats>1&&sizes[heats-1]<=SMALL_LAST_HEAT){
      const pair=sizes[heats-2]+sizes[heats-1];
      sizes[heats-2]=Math.ceil(pair/2);sizes[heats-1]=Math.floor(pair/2);
    }
    return sizes;
  }
  // Returns [{heatNo,laneNo}] in the same order as the swimmers; each heat uses lanes 1..size.
  function assignHeats(swimmers,lanes){
    const slots=[];
    heatSizes(swimmers,lanes).forEach((size,i)=>{for(let lane=1;lane<=size;lane++)slots.push({heatNo:i+1,laneNo:lane})});
    return slots;
  }
  return {heatSizes,assignHeats};
});
