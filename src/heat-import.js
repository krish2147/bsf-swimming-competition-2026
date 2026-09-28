// Turns an uploaded registrations CSV (the dashboard export, optionally with Heat/Lane filled in)
// into heat/lane assignments for one event. Pure functions: no database access.
const MAX_LANES=10;

function parseCsv(text){
  text=String(text??'').replace(/^﻿/,'');
  const firstLine=text.slice(0,text.search(/\r?\n|$/));
  const delimiter=(firstLine.match(/;/g)||[]).length>(firstLine.match(/,/g)||[]).length?';':',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}
      else if(ch==='"')quoted=false;
      else cell+=ch;
    }else if(ch==='"'&&cell==='')quoted=true;
    else if(ch===delimiter){row.push(cell);cell=''}
    else if(ch==='\n'||ch==='\r'){
      if(ch==='\r'&&text[i+1]==='\n')i++;
      row.push(cell);rows.push(row);row=[];cell='';
    }else cell+=ch;
  }
  if(cell!==''||row.length){row.push(cell);rows.push(row)}
  return rows;
}

// Undo the export's formula guard (leading apostrophe) and surrounding spaces.
const clean=value=>String(value??'').trim().replace(/^'/,'').trim();
const headerKey=value=>clean(value).toLowerCase().replace(/[^a-z0-9]/g,'');
const COLUMNS={id:['registrationid','regid','registrationno','registrationnumber'],heat:['heat','heatno','heatnumber'],lane:['lane','laneno','lanenumber']};

// eventRegistrations: swimmers registered for the chosen event [{registration_id,full_name,school_name}].
// knownRegistrations: Map of every registration_id -> {full_name}, to explain rows from other events.
function planHeats(text,{lanes,eventRegistrations,knownRegistrations=new Map()}){
  const errors=[],rows=parseCsv(text);
  const headerIndex=rows.findIndex(r=>r.some(c=>clean(c)!==''));
  if(headerIndex<0)return {errors:['The CSV file is empty.'],entries:[],missing:[]};
  const header=rows[headerIndex].map(headerKey),col={};
  for(const [name,aliases] of Object.entries(COLUMNS))col[name]=header.findIndex(h=>aliases.includes(h));
  if(col.id<0)return {errors:['The CSV needs a "Registration ID" column. Use the Download CSV file from the dashboard.'],entries:[],missing:[]};
  const eventById=new Map(eventRegistrations.map(r=>[r.registration_id,r]));
  const seen=new Map(),picked=[];
  rows.slice(headerIndex+1).forEach((cells,i)=>{
    const line=headerIndex+i+2;
    if(cells.every(c=>clean(c)===''))return;
    const id=clean(cells[col.id]);
    if(!id)return errors.push(`Row ${line}: Registration ID is empty.`);
    if(seen.has(id))return errors.push(`Row ${line}: ${id} is listed twice (also row ${seen.get(id)}).`);
    seen.set(id,line);
    const reg=eventById.get(id);
    if(!reg){
      const other=knownRegistrations.get(id);
      return errors.push(other?`Row ${line}: ${id} (${other.full_name}) is not registered for this event.`:`Row ${line}: ${id} was not found.`);
    }
    picked.push({line,reg,heat:col.heat<0?'':clean(cells[col.heat]),lane:col.lane<0?'':clean(cells[col.lane])});
  });
  if(!picked.length&&!errors.length)errors.push('The CSV has no swimmers for this event.');
  const manual=picked.filter(p=>p.heat!==''||p.lane!=='');
  let entries=[];
  if(manual.length){
    if(manual.length!==picked.length)errors.push('Fill in both Heat and Lane for every swimmer, or leave both columns empty to arrange automatically.');
    const taken=new Map();
    for(const p of manual){
      const heat=Number(p.heat),lane=Number(p.lane);
      if(!Number.isInteger(heat)||heat<1){errors.push(`Row ${p.line}: Heat "${p.heat}" must be a whole number from 1.`);continue}
      if(!Number.isInteger(lane)||lane<1||lane>MAX_LANES){errors.push(`Row ${p.line}: Lane "${p.lane}" must be a whole number from 1 to ${MAX_LANES}.`);continue}
      const slot=`${heat}/${lane}`;
      if(taken.has(slot)){errors.push(`Row ${p.line}: Heat ${heat} Lane ${lane} is already used by row ${taken.get(slot)}.`);continue}
      taken.set(slot,p.line);entries.push({heat_no:heat,lane_no:lane,reg:p.reg});
    }
    const heats=[...new Set(entries.map(e=>e.heat_no))].sort((a,b)=>a-b);
    const gap=heats.findIndex((h,i)=>h!==i+1);
    if(gap>=0&&!errors.length)errors.push(`Heats must be numbered 1, 2, 3… without gaps (Heat ${gap+1} has no swimmers).`);
  }else{
    if(!Number.isInteger(lanes)||lanes<1||lanes>MAX_LANES)errors.push(`Lanes per heat must be from 1 to ${MAX_LANES}.`);
    else entries=picked.map((p,i)=>({heat_no:Math.floor(i/lanes)+1,lane_no:i%lanes+1,reg:p.reg}));
  }
  entries.sort((a,b)=>a.heat_no-b.heat_no||a.lane_no-b.lane_no);
  const missing=eventRegistrations.filter(r=>!seen.has(r.registration_id));
  return {errors,entries:errors.length?[]:entries,missing,mode:manual.length?'csv':'auto'};
}

module.exports={parseCsv,planHeats,MAX_LANES};
