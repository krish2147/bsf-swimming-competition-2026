const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseCsv,planHeats}=require('../src/heat-import');

const swimmers=['A','B','C','D','E'].map((n,i)=>({registration_id:`BSF26-${i+1}`,full_name:`Swimmer ${n}`,school_name:'School'}));
const known=new Map([...swimmers,{registration_id:'BSF26-99',full_name:'Other Event Kid'}].map(r=>[r.registration_id,r]));
const plan=(csv,lanes=2,eventRegistrations=swimmers)=>planHeats(csv,{lanes,eventRegistrations,knownRegistrations:known});
const slots=result=>result.entries.map(e=>`${e.heat_no}/${e.lane_no}/${e.reg.registration_id}`);
const HEADER='Sr No,Registration ID,Participant,School,Gender,DOB,Age category,Events,Contact,Payment status,Check-in status,Heat,Lane';

test('parseCsv handles BOM, quotes, embedded commas/newlines, CRLF and semicolons',()=>{
  assert.deepEqual(parseCsv('﻿a,"b, c","say ""hi""\nthere"\r\n1,2,3\r\n'),[['a','b, c','say "hi"\nthere'],['1','2','3']]);
  assert.deepEqual(parseCsv('Registration ID;Heat;Lane\nX;1;2'),[['Registration ID','Heat','Lane'],['X','1','2']]);
});

test('empty Heat/Lane columns arrange swimmers in CSV row order',()=>{
  const csv=`﻿${HEADER}\r\n1,BSF26-3,C,,,,,,,,,,\r\n2,BSF26-1,A,,,,,,,,,,\r\n3,BSF26-2,B,,,,,,,,,,\r\n`;
  const result=plan(csv);
  assert.deepEqual(result.errors,[]);assert.equal(result.mode,'auto');
  assert.deepEqual(slots(result),['1/1/BSF26-3','1/2/BSF26-1','2/1/BSF26-2']);
  assert.deepEqual(result.missing.map(m=>m.registration_id),['BSF26-4','BSF26-5']);
});

test('filled Heat/Lane columns are used exactly, with empty lanes allowed',()=>{
  const csv=`${HEADER}\n1,BSF26-1,A,,,,,,,,,2,3\n2,BSF26-2,B,,,,,,,,,1,4\n3,BSF26-3,C,,,,,,,,,1,2\n`;
  const result=plan(csv,6);
  assert.deepEqual(result.errors,[]);assert.equal(result.mode,'csv');
  assert.deepEqual(slots(result),['1/2/BSF26-3','1/4/BSF26-2','2/3/BSF26-1']);
});

test('minimal CSV with only Registration ID works, and the export formula guard is ignored',()=>{
  assert.deepEqual(slots(plan("registration id\n'BSF26-2\n BSF26-1 \n",3)),['1/1/BSF26-2','1/2/BSF26-1']);
});

test('clear errors for bad rows; nothing is returned to save',()=>{
  const cases=[
    ['Name\nA','The CSV needs a "Registration ID" column'],
    ['',  'The CSV file is empty'],
    ['Registration ID\n\n','no swimmers for this event'],
    ['Registration ID\nBSF26-1\nBSF26-1','Row 3: BSF26-1 is listed twice (also row 2)'],
    ['Registration ID\nBSF26-99','Row 2: BSF26-99 (Other Event Kid) is not registered for this event'],
    ['Registration ID\nNOPE','Row 2: NOPE was not found'],
    ['Registration ID,Heat,Lane\nBSF26-1,1,1\nBSF26-2,,','Fill in both Heat and Lane for every swimmer'],
    ['Registration ID,Heat,Lane\nBSF26-1,1,1\nBSF26-2,1,1','Row 3: Heat 1 Lane 1 is already used by row 2'],
    ['Registration ID,Heat,Lane\nBSF26-1,1,11','Lane "11" must be a whole number from 1 to 10'],
    ['Registration ID,Heat,Lane\nBSF26-1,0,1','Heat "0" must be a whole number from 1'],
    ['Registration ID,Heat,Lane\nBSF26-1,1,1\nBSF26-2,3,1','Heat 2 has no swimmers'],
  ];
  for(const [csv,message] of cases){
    const result=plan(csv);
    assert.ok(result.errors.some(e=>e.includes(message)),`${JSON.stringify(csv)} → ${JSON.stringify(result.errors)}`);
    assert.deepEqual(result.entries,[]);
  }
  assert.ok(plan('Registration ID\nBSF26-1',11).errors.some(e=>e.includes('Lanes per heat must be from 1 to 10')));
});
