'use strict';
const {spawn}=require('child_process'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..'),port=Number(process.env.TEST_PORT||43127),dbf=path.join(root,'test-db.json');
function req(method,url,token,body){return new Promise((resolve,reject)=>{const d=body===undefined?null:Buffer.from(JSON.stringify(body));const r=http.request({hostname:'127.0.0.1',port,path:url,method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(d?{'Content-Type':'application/json','Content-Length':d.length}:{})}},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>{let j={};try{j=JSON.parse(s)}catch{}resolve({status:res.statusCode,data:j,raw:s})})});r.on('error',reject);if(d)r.write(d);r.end()})}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function start(){return spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),ROOM_WALLET_DB:dbf},stdio:'ignore'})}
async function ready(){for(let i=0;i<80;i++){try{if((await req('GET','/api/health')).status===200)return true}catch{}await wait(150)}return false}
(async()=>{let child;try{try{fs.unlinkSync(dbf)}catch{}child=start();assert(await ready(),'server starts');
const reg=async(n,e)=>{const r=await req('POST','/api/register',null,{name:n,email:e,password:'password123'});assert.equal(r.status,201);return r.data};
for(let round=1;round<=3;round++){
 const A=await reg('Harsha'+round,`a${round}@t.test`),B=await reg('Charan'+round,`b${round}@t.test`),C=await reg('Ravi'+round,`c${round}@t.test`);
 const ta=A.token,tb=B.token,tc=C.token;assert(/^RW-[A-F0-9]{8}$/.test(A.user.accountId));
 assert.equal((await req('POST','/api/register',null,{name:'Dup User',email:`a${round}@t.test`,password:'password123'})).status,409);
 // personal
 assert.equal((await req('POST','/api/personal/tx',ta,{type:'income',amount:1000,description:'Salary'})).status,201);
 assert.equal((await req('PATCH','/api/personal',ta,{limit:500})).status,200);
 assert.equal((await req('POST','/api/personal/tx',ta,{type:'expense',amount:600,description:'Big'})).data.code,'LIMIT');
 assert.equal((await req('POST','/api/personal/tx',ta,{type:'expense',amount:600,description:'Big',force:true})).status,201);
 assert.equal((await req('POST','/api/personal/tx',ta,{type:'expense',amount:5000,description:'Too much'})).data.code,'LOW');
 let me=(await req('GET','/api/me',ta)).data;assert.equal(me.personal.transactions.length,2);
 assert.equal((await req('DELETE','/api/personal/tx/'+me.personal.transactions[1].id,ta)).status,200);
 assert.equal((await req('GET','/api/me',tb)).data.personal.transactions.length,0,'personal isolation');
 assert.equal((await req('POST','/api/personal/tx',ta,{type:'expense',amount:-1})).status,400);
 // room
 const room=(await req('POST','/api/rooms',ta,{name:'Boys '+round,limit:500})).data.room;
 assert.equal((await req('POST','/api/rooms/invite',tb,{roomId:room.id,accountId:A.user.accountId})).status,404,'non member cannot invite');
 for(const [t,U] of [[tb,B],[tc,C]]){const inv=(await req('POST','/api/rooms/invite',ta,{roomId:room.id,accountId:U.user.accountId}));assert.equal(inv.status,201);const list=(await req('GET','/api/me',t)).data.invites;assert.equal(list.length,1);assert.equal((await req('POST','/api/invites/'+list[0].id,t,{action:'accept'})).status,200)}
 const path_=`/api/rooms/${room.id}`;
 assert.equal((await req('POST',path_+'/tx',tb,{type:'income',amount:300,description:'B adds'})).status,201);
 assert.equal((await req('POST',path_+'/tx',tc,{type:'income',amount:300})).status,201);
 assert.equal((await req('POST',path_+'/tx',ta,{type:'expense',amount:400,description:'Rent share'})).status,201);
 assert.equal((await req('POST',path_+'/tx',ta,{type:'expense',amount:150})).data.code,'LIMIT');
 // split: A pays 300 for all three -> each owes 100
 const ids=[A.user.id,B.user.id,C.user.id];
 assert.equal((await req('POST',path_+'/tx',ta,{type:'split',amount:300,description:'Groceries',paidBy:A.user.id,among:ids})).status,201);
 assert.equal((await req('POST',path_+'/tx',ta,{type:'split',amount:10,among:['nobody'],paidBy:A.user.id})).status,400);
 let g=(await req('GET',path_,tb)).data;assert.equal(g.stats.pot,200);
 const net=Object.fromEntries(g.stats.members.map(m=>[m.userId,m.net]));assert.equal(net[A.user.id],200);assert.equal(net[B.user.id],-100);assert.equal(net[C.user.id],-100);assert.equal(g.stats.debts.length,2);
 assert.equal((await req('POST',path_+'/leave',tb)).status,409,'cannot leave unsettled');
 assert.equal((await req('POST',path_+'/tx',tb,{type:'settle',amount:100,to:A.user.id})).status,201);
 assert.equal((await req('POST',path_+'/tx',tb,{type:'settle',amount:1,to:B.user.id})).status,400);
 g=(await req('GET',path_,tb)).data;assert.equal(g.stats.debts.length,1);
 // permissions
 const txB=g.transactions.find(t=>t.userId===B.user.id&&t.type==='income');
 assert.equal((await req('DELETE',path_+'/tx/'+txB.id,tc)).status,403,'member cannot delete others entries');
 assert.equal((await req('DELETE',path_+'/tx/'+txB.id,ta)).status,200,'owner can');
 assert.equal((await req('PATCH',path_+`/members/${B.user.id}`,tb,{role:'admin'})).status,403);
 assert.equal((await req('PATCH',path_+`/members/${B.user.id}`,ta,{role:'admin'})).status,200);
 assert.equal((await req('DELETE',path_+`/members/${C.user.id}`,tb)).status,409,'unsettled');
 assert.equal((await req('POST',path_+'/tx',tc,{type:'settle',amount:100,to:A.user.id})).status,201);
 assert.equal((await req('DELETE',path_+`/members/${C.user.id}`,tb)).status,200,'admin removes settled member');
 assert.equal((await req('GET',path_,tc)).status,404,'removed member loses access');
 assert.equal((await req('PATCH',path_,tb,{limit:1000,name:'Boys X'})).status,200);
 assert.equal((await req('POST',path_+'/transfer',ta,{userId:B.user.id})).status,200);
 assert.equal((await req('DELETE',path_,ta)).status,403,'old owner cannot delete');
 const ex=await req('GET','/api/export',ta);assert.equal(ex.status,200);assert(ex.data.rooms.length===1);
 const imp=await req('POST','/api/personal/import',ta,{transactions:ex.data.personal.transactions});assert.equal(imp.status,200);
 assert.equal((await req('DELETE',path_,tb)).status,200,'new owner deletes room');
 console.log(`Round ${round}/3 passed`);
 if(round===1){child.kill();await wait(300);child=start();assert(await ready(),'restarts');const p=await req('GET','/api/me',ta);assert.equal(p.status,200,'session survives restart');assert.equal(p.data.personal.transactions.length,1);console.log('Restart + session persistence passed')}
}
for(const f of['/server.js','/package.json','/test-db.json','/roomwallet-v3.json','/../server.js'])assert.equal((await req('GET',f)).status,404,'static whitelist '+f);
assert.equal((await req('GET','/')).status,200);assert.equal((await req('GET','/icon-192.png')).status,200);assert.equal((await req('GET','/sw.js')).status,200);
for(let i=0;i<9;i++)await req('POST','/api/login',null,{email:'a1@t.test',password:'wrongwrong'});assert.equal((await req('POST','/api/login',null,{email:'a1@t.test',password:'password123'})).status,429,'login rate limit');
console.log('All regression checks passed.');child.kill();try{fs.unlinkSync(dbf)}catch{}process.exit(0)}catch(e){console.error(e);try{child&&child.kill();fs.unlinkSync(dbf)}catch{}process.exit(1)}})();
