// Splits swimmers into the fewest heats that fit the lanes, as evenly as possible,
// with any extra swimmers in the earlier heats: 13 swimmers, 6 lanes → heats of 5, 4, 4.
// Shared by the server ("Create / Reset Heats") and the Timings page ("Arrange heats").
(function(root,factory){
  const layout=factory();
  if(typeof module==='object'&&module.exports)module.exports=layout;
  else root.BSFHeatLayout=layout;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  function heatSizes(swimmers,lanes){
    if(!Number.isInteger(swimmers)||swimmers<1||!Number.isInteger(lanes)||lanes<1)return [];
    const heats=Math.ceil(swimmers/lanes),base=Math.floor(swimmers/heats),extra=swimmers%heats;
    return Array.from({length:heats},(_,i)=>base+(i<extra?1:0));
  }
  // Returns [{heatNo,laneNo}] in the same order as the swimmers; each heat uses lanes 1..size.
  function assignHeats(swimmers,lanes){
    const slots=[];
    heatSizes(swimmers,lanes).forEach((size,i)=>{for(let lane=1;lane<=size;lane++)slots.push({heatNo:i+1,laneNo:lane})});
    return slots;
  }
  return {heatSizes,assignHeats};
});
