import { io } from 'socket.io-client';
const base=process.env.BASE_URL||'http://127.0.0.1:8080';
const connect=id=>new Promise((resolve,reject)=>{const s=io(base,{path:'/socket.io',transports:['websocket'],auth:{devUserId:id},reconnection:false,timeout:8000});s.once('connect',()=>resolve(s));s.once('connect_error',reject);});
const emit=(s,event,payload={})=>new Promise((resolve,reject)=>s.timeout(8000).emit(event,payload,(err,res)=>err?reject(err):res?.ok?resolve(res.data):reject(new Error(res?.error||event))));
let a,b,c;
try{
 a=await connect(20001);b=await connect(20002);c=await connect(20003);
 const room=await emit(a,'coop:create',{maxPlayers:2});
 await emit(b,'coop:join',{code:room.code});
 await emit(a,'coop:ready',{matchId:room.id,ready:true});
 await emit(b,'coop:ready',{matchId:room.id,ready:true});
 const started=await emit(a,'coop:start',{matchId:room.id});
 if(started.phase!=='playing')throw new Error('Матч не запущен');
 const spectator=await emit(c,'coop:spectate',{code:room.code});
 if(spectator.viewerMode!=='spectator'||!(spectator.spectators||[]).some(x=>x.userId==='20003'))throw new Error('Наблюдатель не зарегистрирован');
 const intervention=await emit(c,'coop:spectator-action',{matchId:room.id,action:'mark'});
 if(!(intervention.spectators||[]).some(x=>x.userId==='20003'&&x.usedIntervention))throw new Error('Вмешательство не сохранено');
 let duplicateBlocked=false;try{await emit(c,'coop:spectator-action',{matchId:room.id,action:'light'});}catch{duplicateBlocked=true;}
 if(!duplicateBlocked)throw new Error('Повторное вмешательство не заблокировано');
 await emit(a,'coop:action',{matchId:room.id,action:'inspect'});
 await emit(b,'coop:action',{matchId:room.id,action:'help'});
 await emit(a,'coop:vote',{matchId:room.id,choiceIndex:0});
 await emit(b,'coop:vote',{matchId:room.id,choiceIndex:0});
 a.disconnect();a=await connect(20001);
 const resumed=await emit(a,'coop:resume',{matchId:room.id});
 if(resumed.id!==room.id)throw new Error('Матч не восстановлен');
 console.log(JSON.stringify({ok:true,matchId:room.id,code:room.code,spectatorIntervention:true,duplicateBlocked,reconnected:true,phase:resumed.phase},null,2));
}finally{a?.disconnect();b?.disconnect();c?.disconnect();}
