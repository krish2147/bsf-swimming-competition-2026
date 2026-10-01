const {test}=require('node:test');
const assert=require('node:assert/strict');
const {heatSizes,assignHeats}=require('../public/heat-layout');

test('heats are filled to the lane count; only a tiny last heat (1-2) is shared with the one before',()=>{
  for(const [swimmers,lanes,sizes] of [[13,6,[6,4,3]],[14,6,[6,4,4]],[15,6,[6,6,3]],[17,6,[6,6,5]],[19,6,[6,6,4,3]],[20,6,[6,6,4,4]],[7,6,[4,3]],[8,6,[4,4]],[12,6,[6,6]],[6,6,[6]],[2,6,[2]],[25,8,[8,8,5,4]],[9,4,[4,3,2]]]){
    assert.deepEqual(heatSizes(swimmers,lanes),sizes,`${swimmers} swimmers, ${lanes} lanes`);
  }
  for(let lanes=1;lanes<=10;lanes++)for(let swimmers=1;swimmers<=80;swimmers++){
    const sizes=heatSizes(swimmers,lanes),n=sizes.length;
    assert.equal(sizes.reduce((a,b)=>a+b,0),swimmers);assert.equal(n,Math.ceil(swimmers/lanes),'fewest heats');
    assert.ok(sizes.slice(0,-2).every(size=>size===lanes),'all heats before the last two are full');
    assert.ok(Math.max(...sizes)<=lanes&&sizes.every((size,i)=>!i||size<=sizes[i-1]),'never over lanes, bigger heats first');
    const full=swimmers%lanes||lanes;
    if(n>1&&full<=2)assert.ok(sizes[n-2]-sizes[n-1]<=1,'tiny last heat shared evenly with the one before');
    else assert.equal(sizes[n-1],full,'otherwise the last heat is left as it is');
  }
  for(const bad of [[0,6],[5,0],[-1,6],[2.5,6],[5,'6']])assert.deepEqual(heatSizes(...bad),[]);
});

test('assignHeats keeps swimmer order and fills lanes 1..size in each heat',()=>{
  assert.deepEqual(assignHeats(7,6).map(s=>`${s.heatNo}/${s.laneNo}`),['1/1','1/2','1/3','1/4','2/1','2/2','2/3']);
  assert.deepEqual(assignHeats(13,6).filter(s=>s.laneNo===1).length,3);assert.deepEqual(assignHeats(13,6).at(-1),{heatNo:3,laneNo:3});
});
