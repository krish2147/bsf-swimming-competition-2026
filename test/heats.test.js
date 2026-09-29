const {test}=require('node:test');
const assert=require('node:assert/strict');
const {planHeats}=require('../src/heats');

const eventRegistrations=['A','B','C','D'].map((n,i)=>({registration_id:`BSF26-${i+1}`,full_name:`Swimmer ${n}`,school_name:'School'}));
const plan=entries=>planHeats(entries,{eventRegistrations});
const e=(id,heatNo,laneNo)=>({registrationId:`BSF26-${id}`,heatNo,laneNo});

test('valid heats are sorted by heat and lane; empty lanes allowed; unplaced swimmers reported',()=>{
  const result=plan([e(3,2,4),e(1,1,5),e(2,1,2)]);
  assert.deepEqual(result.errors,[]);
  assert.deepEqual(result.entries.map(x=>`${x.heat_no}/${x.lane_no}/${x.reg.registration_id}`),['1/2/BSF26-2','1/5/BSF26-1','2/4/BSF26-3']);
  assert.deepEqual(result.missing.map(m=>m.registration_id),['BSF26-4']);
});

test('invalid heats return named errors and nothing to save',()=>{
  const cases=[
    [[],'Place at least one swimmer in a heat'],
    [null,'Place at least one swimmer in a heat'],
    [[{registrationId:'BSF26-99',heatNo:1,laneNo:1}],'BSF26-99 is not registered for this event'],
    [[e(1,1,1),e(1,1,2)],'Swimmer A is placed twice'],
    [[e(1,1,3),e(2,1,3)],'Heat 1 Lane 3 has two swimmers: Swimmer A and Swimmer B'],
    [[e(1,0,1)],'Swimmer A: Heat must be a whole number from 1'],
    [[e(1,1.5,1)],'Swimmer A: Heat must be a whole number from 1'],
    [[e(1,1,11)],'Swimmer A: Lane must be a whole number from 1 to 10'],
    [[e(1,1,'x')],'Swimmer A: Lane must be a whole number from 1 to 10'],
    [[e(1,1,1),e(2,3,1)],'Heat 2 has no swimmers'],
  ];
  for(const [entries,message] of cases){
    const result=plan(entries);
    assert.ok(result.errors.some(err=>err.includes(message)),`${JSON.stringify(entries)} → ${JSON.stringify(result.errors)}`);
    assert.deepEqual(result.entries,[]);
  }
});
