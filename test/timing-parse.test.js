const {test}=require('node:test');
const assert=require('node:assert/strict');
const timingSeconds=require('../public/timing-parse');

test('times typed in any common way are read as seconds',()=>{
  for(const [text,secs] of [['36.42',36.42],['00:36.42',36.42],['0:36:42',36.42],['00:36:42',36.42],['00.36.42',36.42],['36,42',36.42],['36.42s',36.42],['36.42 sec',36.42],['0:00:36.42',36.42],['36:42',36.42],['1:05.20',65.2],['1.05.20',65.2],['1:05',65],[' 36 ',36]])
    assert.equal(timingSeconds(text),secs,text);
});

test('things that are not times are rejected',()=>{
  for(const text of ['','abc','0','00:00.00','1:2:3:4:5','36.42.10.5.1',null,undefined])assert.equal(timingSeconds(text),null,String(text));
});
