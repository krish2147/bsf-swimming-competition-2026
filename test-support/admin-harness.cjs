const {PGlite}=require('@electric-sql/pglite');
const {prepareValue}=require('pg/lib/utils');
process.env.DATABASE_URL='postgres://unused:unused@localhost/unused';
process.env.ADMIN_PIN='test-pin';
process.env.SESSION_SECRET='admin-test-only-session-secret';
process.env.NODE_ENV='test';
const db=require('../src/db');
const pg=new PGlite();
async function query(sql,values=[]){
 if(typeof sql==='object'){values=sql.values||[];sql=sql.text}
 if(!values.length&&sql.includes('CREATE TABLE')){await pg.exec(sql);return {rows:[],rowCount:0}}
 const result=await pg.query(sql,values.map(value=>prepareValue(value)));
 return {...result,rowCount:result.affectedRows??result.rows.length};
}
db.pool.query=(sql,values,callback)=>{
 if(typeof values==='function'){callback=values;values=[]}
 const result=query(sql,values);
 if(callback){result.then(r=>callback(null,r),callback);return}
 return result;
};
db.pool.connect=async()=>({query,release(){}});
let server;
async function start(){
 await db.initDb();const app=require('../server');
 server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',err=>err?reject(err):resolve(s))});
 return `http://127.0.0.1:${server.address().port}`;
}
async function close(){if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}await pg.close();await db.pool.end()}
module.exports={start,close,query,pg};
