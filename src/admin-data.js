// Older rows may contain JSON strings/scalars instead of arrays. Never expose
// non-string event members to filtering or rendering code.
function registrationEvents(value){
  if(typeof value==='string'){
    try{value=JSON.parse(value)}catch{return []}
  }
  return Array.isArray(value)?[...new Set(value.filter(e=>typeof e==='string'&&e.trim()))]:[];
}
function registrationRow(row){
  const {has_photo,has_proof,...data}=row;
  const id=encodeURIComponent(row.registration_id);
  return {...data,events_json:registrationEvents(row.events_json),
    participant_photo:has_photo?`/api/media/${id}/photo`:null,
    payment_proof:has_proof?`/api/media/${id}/proof`:null};
}
const registrationColumns=`registration_id,full_name,school_name,gender,
  to_char(dob,'YYYY-MM-DD') dob,age_category,phone,email,guardian_name,events_json,
  amount,payment_utr,payment_status,checkin_status,created_at,
  (octet_length(participant_photo)>0 AND participant_photo_mime IS NOT NULL) has_photo,
  (octet_length(payment_proof)>0 AND payment_proof_mime IS NOT NULL) has_proof`;
module.exports={registrationEvents,registrationRow,registrationColumns};
