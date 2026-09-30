const {test}=require('node:test');
const assert=require('node:assert/strict');
const {heatSizes,assignHeats}=require('../public/heat-layout');

test('heats are split as evenly as possible, extra swimmers in earlier heats',()=>{
  for(const [swimmers,lanes,sizes] of [[13,6,[5,4,4]],[14,6,[5,5,4]],[12,6,[6,6]],[7,6,[4,3]],[6,6,[6]],[5,6,[5]],[1,6,[1]],[19,6,[5,5,5,4]],[25,8,[7,6,6,6]],[10,4,[4,3,3]]]){
    assert.deepEqual(heatSizes(swimmers,lanes),sizes,`${swimmers} swimmers, ${lanes} lanes`);
  }
  for(let lanes=1;lanes<=10;lanes++)for(let swimmers=1;swimmers<=80;swimmers++){
    const sizes=heatSizes(swimmers,lanes);
    assert.equal(sizes.reduce((a,b)=>a+b,0),swimmers);assert.equal(sizes.length,Math.ceil(swimmers/lanes),'fewest heats');
    assert.ok(Math.max(...sizes)<=lanes&&Math.max(...sizes)-Math.min(...sizes)<=1,'never over lanes, never more than 1 apart');
    assert.deepEqual(sizes,[...sizes].sort((a,b)=>b-a),'bigger heats first');
  }
  for(const bad of [[0,6],[5,0],[-1,6],[2.5,6],[5,'6']])assert.deepEqual(heatSizes(...bad),[]);
});

test('assignHeats keeps swimmer order and fills lanes 1..size in each heat',()=>{
  assert.deepEqual(assignHeats(7,6).map(s=>`${s.heatNo}/${s.laneNo}`),['1/1','1/2','1/3','1/4','2/1','2/2','2/3']);
});
