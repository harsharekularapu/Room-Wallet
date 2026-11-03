'use strict';
const {spawn}=require('child_process'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..');const port=Number(process.env.TEST_PORT||43127);const db=path.join(root,'test-db.json');
function req(method,url,token,body){return new Promise((resolve,reject)=>{const data=body===undefined?null:Buffer.from(JSON.stringify(body));const r=http.request({hostname:'127.0.0.1',port,path:url,method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json','Content-Length':data.length}:{})}},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>{let j={};try{j=JSON.parse(s)}catch{}resolve({status:res.statusCode,data:j})})});r.on('error',reject);if(data)r.write(data);r.end()})}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{try{try{fs.unlinkSync(db)}catch{}let child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),ROOM_WALLET_DB:db},stdio:'ignore'});let ready=false;for(let i=0;i<60;i++){try{const h=await req('GET','/api/health');if(h.status===200){ready=true;break}}catch{}await wait(150)}assert(ready,'server starts');
for(let round=1;round<=3;round++){
 const a=await req('POST','/api/register',null,{name:`Harsha${round}`,email:`harsha${round}@example.test`,password:'password123'});assert.equal(a.status,201);const ta=a.data.token,aid=a.data.user.accountId;assert(/^RW-[A-F0-9]{8}$/.test(aid));
 const b=await req('POST','/api/register',null,{name:`Charan${round}`,email:`charan${round}@example.test`,password:'password123'});assert.equal(b.status,201);const tb=b.data.token,bid=b.data.user.accountId;assert.notEqual(aid,bid);
 const p=await req('PUT','/api/personal',ta,{transactions:[{type:'income',amount:1000,description:'Salary',createdAt:Date.now()}]});assert.equal(p.status,200);const pb=await req('PUT','/api/personal',tb,{transactions:[]});assert.equal(pb.status,200);
 const mA=await req('GET','/api/me',ta),mB=await req('GET','/api/me',tb);assert.equal(mA.data.personal.transactions.length,1);assert.equal(mB.data.personal.transactions.length,0);
 const r1=await req('POST','/api/rooms',ta,{name:`Boys ${round}`,memberCount:3});assert.equal(r1.status,201);const room1=r1.data.room;
 const inv=await req('POST','/api/rooms/invite',ta,{roomId:room1.id,accountId:bid});assert.equal(inv.status,201);
 const bBefore=await req('GET','/api/me',tb);const invite=bBefore.data.invites.find(x=>x.id===inv.data.invite.id);assert(invite);
 const accept=await req('POST',`/api/invites/${invite.id}`,tb,{action:'accept'});assert.equal(accept.status,200);
 const tx=await req('POST',`/api/rooms/${room1.id}/transactions`,tb,{type:'expense',amount:125,description:'Groceries'});assert.equal(tx.status,201);
 const roomRead=await req('GET',`/api/rooms/${room1.id}`,ta);assert.equal(roomRead.data.transactions.length,1);
 const r2=await req('POST','/api/rooms',tb,{name:`Flat ${round}`,memberCount:2});assert.equal(r2.status,201);
 const multi=await req('GET','/api/me',tb);assert.equal(multi.data.rooms.length,2,'same account can belong to multiple rooms');
 const outsider=await req('POST',`/api/rooms/${room1.id}/transactions`,'invalid',{type:'expense',amount:1,description:'bad'});assert.equal(outsider.status,401);
 const bad=await req('POST','/api/register',null,{name:'Duplicate User',email:`harsha${round}@example.test`,password:'password123'});assert.equal(bad.status,409);
 console.log(`Round ${round}/3 passed`);
 if(round===1){child.kill();await wait(250);child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),ROOM_WALLET_DB:db},stdio:'ignore'});let restarted=false;for(let j=0;j<60;j++){try{const h=await req('GET','/api/health');if(h.status===200){restarted=true;break}}catch{}await wait(150)}assert(restarted,'server restarts');const login=await req('POST','/api/login',null,{email:'harsha1@example.test',password:'password123'});assert.equal(login.status,200,'account survives server restart');const persisted=await req('GET','/api/me',login.data.token);assert.equal(persisted.data.personal.transactions.length,1,'personal wallet survives server restart');assert.equal(persisted.data.rooms.length,1,'room membership survives server restart');console.log('Restart persistence check passed');}
}
const health=await req('GET','/api/health');assert.equal(health.status,200);console.log('All 3 regression rounds passed.');child.kill();try{fs.unlinkSync(db)}catch{}process.exit(0)
}catch(e){console.error(e);try{fs.unlinkSync(db)}catch{}process.exit(1)}})();
