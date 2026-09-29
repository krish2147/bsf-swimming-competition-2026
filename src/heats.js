// Validates heat/lane assignments built on the Timings desk for one event. Pure: no database access.
const MAX_LANES=10;

// entries: [{registrationId,heatNo,laneNo}] for swimmers placed in a heat.
// eventRegistrations: swimmers registered for the event [{registration_id,full_name,school_name}].
function planHeats(entries,{eventRegistrations}){
  const errors=[],byId=new Map(eventRegistrations.map(r=>[r.registration_id,r]));
  if(!Array.isArray(entries)||!entries.length)return {errors:['Place at least one swimmer in a heat.'],entries:[],missing:[]};
  const placed=new Set(),slots=new Map(),planned=[];
  for(const entry of entries){
    const id=String(entry?.registrationId??''),reg=byId.get(id);
    if(!reg){errors.push(`${id||'A swimmer'} is not registered for this event.`);continue}
    const name=reg.full_name||id;
    if(placed.has(id)){errors.push(`${name} is placed twice.`);continue}
    placed.add(id);
    const heat=Number(entry.heatNo),lane=Number(entry.laneNo);
    if(!Number.isInteger(heat)||heat<1){errors.push(`${name}: Heat must be a whole number from 1.`);continue}
    if(!Number.isInteger(lane)||lane<1||lane>MAX_LANES){errors.push(`${name}: Lane must be a whole number from 1 to ${MAX_LANES}.`);continue}
    const slot=`${heat}/${lane}`;
    if(slots.has(slot)){errors.push(`Heat ${heat} Lane ${lane} has two swimmers: ${slots.get(slot)} and ${name}.`);continue}
    slots.set(slot,name);planned.push({heat_no:heat,lane_no:lane,reg});
  }
  const heats=[...new Set(planned.map(e=>e.heat_no))].sort((a,b)=>a-b),gap=heats.findIndex((h,i)=>h!==i+1);
  if(gap>=0&&!errors.length)errors.push(`Heats must be numbered 1, 2, 3… without gaps (Heat ${gap+1} has no swimmers).`);
  planned.sort((a,b)=>a.heat_no-b.heat_no||a.lane_no-b.lane_no);
  return {errors,entries:errors.length?[]:planned,missing:eventRegistrations.filter(r=>!placed.has(r.registration_id))};
}

module.exports={planHeats,MAX_LANES};
