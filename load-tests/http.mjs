const base=process.env.BASE_URL||'http://127.0.0.1:8080';
const users=Number(process.env.USERS||100);const rounds=Number(process.env.ROUNDS||3);const concurrency=Number(process.env.CONCURRENCY||50);
let cursor=0,ok=0,failed=0;const latencies=[];
async function request(user,path){const started=performance.now();const r=await fetch(base+path,{headers:{'x-dev-user-id':String(200000+user)}});await r.arrayBuffer();latencies.push(performance.now()-started);if(r.ok)ok++;else{failed++;console.error(r.status,path);}}
const jobs=[];for(let round=0;round<rounds;round++)for(let user=1;user<=users;user++)jobs.push([user,round%2?'/api/v2/bootstrap':'/api/bootstrap']);
async function worker(){while(cursor<jobs.length){const index=cursor++;const [u,p]=jobs[index];try{await request(u,p);}catch(e){failed++;console.error(e.message);}}}
const start=performance.now();await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)},worker));latencies.sort((a,b)=>a-b);const q=p=>latencies[Math.min(latencies.length-1,Math.floor(latencies.length*p))]||0;
console.log(JSON.stringify({base,users,rounds,requests:jobs.length,ok,failed,durationMs:Math.round(performance.now()-start),rps:Math.round(jobs.length/((performance.now()-start)/1000)),p50Ms:Math.round(q(.5)),p95Ms:Math.round(q(.95)),p99Ms:Math.round(q(.99))},null,2));if(failed)process.exitCode=1;
