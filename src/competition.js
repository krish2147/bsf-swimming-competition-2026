const CATEGORIES=[
{name:'Under-6',min:'2020-04-02',max:'9999-12-31',floaterEvents:['25m Freestyle Kick with Board','25m Freestyle'],eventLabels:{'25m Freestyle Kick with Board':'25m Freestyle Kick with Board / Floaters','25m Freestyle':'25m Freestyle with Floaters'},events:['25m Freestyle Kick with Board','25m Freestyle']},
{name:'Under-8',min:'2018-04-02',max:'2020-04-01',events:['25m Freestyle Kick with Board','25m Freestyle','25m Backstroke','25m Breaststroke']},
{name:'Under-10',min:'2016-04-02',max:'2018-04-01',events:['25m Freestyle','25m Backstroke','25m Breaststroke','25m Butterfly','50m Freestyle']},
{name:'Under-12',min:'2014-04-02',max:'2016-04-01',events:['25m Freestyle','50m Freestyle','25m Backstroke','25m Breaststroke','25m Butterfly','100m Individual Medley (IM)','4×50m Freestyle Relay']},
{name:'Under-14',min:'2012-04-02',max:'2014-04-01',events:['25m Freestyle','50m Freestyle','100m Freestyle','50m Backstroke','50m Breaststroke','50m Butterfly','100m Individual Medley (IM)','4×50m Freestyle Relay']},
{name:'Under-17',min:'2009-04-02',max:'2012-04-01',events:['25m Freestyle','50m Freestyle','100m Freestyle','50m Backstroke','50m Breaststroke','50m Butterfly','200m Individual Medley (IM)','100m Backstroke','4×50m Freestyle Relay']}
];
const categoryForDob=dob=>CATEGORIES.find(c=>dob>=c.min&&dob<=c.max)||null;
const eventKey=(category,gender,event)=>`${category}|||${gender}|||${event}`;
const parseEventKey=key=>{const [category,gender,event]=String(key||'').split('|||');return{category,gender,event}};
module.exports={CATEGORIES,categoryForDob,eventKey,parseEventKey};
