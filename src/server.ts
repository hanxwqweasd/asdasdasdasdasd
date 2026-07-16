import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './migrations.js';
import { apiRoutes } from './routes/api.js';
import { v2Routes } from './routes/v2.js';
import { v4Routes } from './routes/v4.js';
import { telegramWebhookRoutes } from './routes/telegram-webhook.js';
import { configureTelegram } from './telegram.js';
import { AppError } from './errors.js';
import { adminRoutes } from './admin/routes.js';
import { adminV2Routes } from './admin/v2-routes.js';
import { adminV4Routes } from './admin/v4-routes.js';
import { bootstrapAdmin } from './admin/auth.js';
import { startBroadcastWorker } from './admin/broadcast-worker.js';
import { createRealtimeServer } from './realtime/coop.js';
import { startV4Worker } from './v4/worker.js';
import { closeRedis,getRedis,redisDiagnostic,redisHealth } from './redis.js';
import { captureException,flushSentry,initSentry } from './observability/sentry.js';
import { httpDuration,registry } from './observability/metrics.js';
import { getSetting } from './settings.js';
import { closeExpiredVotes } from './services/building.js';
import { startBackupWorker } from './backup/worker.js';
import { runPreMigrationBackupOnce } from './backup/startup.js';

initSentry();
const app=Fastify({logger:{level:config.NODE_ENV==='development'?'debug':'info'},trustProxy:true,bodyLimit:2_000_000});
await app.register(cors,{origin:false});
await app.register(helmet,{contentSecurityPolicy:false,crossOriginEmbedderPolicy:false,frameguard:false});
function requestIdentity(request:any):string{
  const dev=request.headers?.['x-dev-user-id'];
  if(config.ALLOW_DEV_AUTH&&config.NODE_ENV!=='production'&&typeof dev==='string'&&/^\d+$/.test(dev))return `dev:${dev}`;
  const raw=request.headers?.['x-telegram-init-data'];
  if(typeof raw==='string'&&raw.length>0){
    try{const userRaw=new URLSearchParams(raw).get('user');const id=userRaw?JSON.parse(userRaw)?.id:null;if(id)return `tg:${id}`;}catch{}
    return `tgdata:${crypto.createHash('sha256').update(raw).digest('hex').slice(0,24)}`;
  }
  return `ip:${request.ip}`;
}
await app.register(rateLimit,{max:config.RATE_LIMIT_MAX,timeWindow:'1 minute',keyGenerator:requestIdentity,allowList:(request)=>request.url.startsWith('/health')||request.url.startsWith('/ready')||request.url.startsWith('/api/public-status')||request.url.startsWith('/api/public-config')||request.url.startsWith('/telegram/webhook')});

app.addHook('onRequest',async request=>{(request as any).startedAt=process.hrtime.bigint();if(!request.url.startsWith('/api/')||request.url.startsWith('/api/public-status')||request.url.startsWith('/api/public-config'))return;try{const redis=await getRedis();if(redis){const bucket=Math.floor(Date.now()/60_000);const key=`http-limit:${requestIdentity(request)}:${bucket}`;const count=await redis.incr(key);if(count===1)await redis.expire(key,70);if(count>config.RATE_LIMIT_MAX)throw new AppError('Слишком много запросов',429,'DISTRIBUTED_RATE_LIMIT');}}catch(error){if(error instanceof AppError)throw error;request.log.warn({error},'Distributed rate limit unavailable; continuing with local limiter');}});
app.addHook('onResponse',async(request,reply)=>{const started=(request as any).startedAt as bigint|undefined;if(started){const seconds=Number(process.hrtime.bigint()-started)/1e9;httpDuration.observe({method:request.method,route:request.routeOptions?.url??'unknown',status:String(reply.statusCode)},seconds);}});
app.addHook('preHandler',async request=>{
  if(config.DATABASE_URL&&request.url.startsWith('/api/')&&!request.url.startsWith('/api/public-status')&&!request.url.startsWith('/api/public-config')){
    if(await getSetting<boolean>('maintenance_mode',false)){
      const message=await getSetting<string>('maintenance_message','Дом временно закрыт на технические работы');
      throw new AppError(message,503,'MAINTENANCE_MODE');
    }
  }
  if(!['POST','PUT','PATCH','DELETE'].includes(request.method))return;
  if(!request.url.startsWith('/api/')||request.url.startsWith('/api/analytics')||request.url.startsWith('/api/sessions/'))return;
  if(await getSetting<boolean>('readonly_mode',false))throw new AppError('Дом переведён в аварийный режим только для чтения',503,'READONLY_MODE');
});

app.setErrorHandler((error,request,reply)=>{const err=error instanceof Error?error:new Error('Unknown server error');const isValidation=err instanceof ZodError;const appError=err instanceof AppError?err:null;const maybeDbCode=(err as any).code;const pgCode=typeof maybeDbCode==='string'&&/^\d{5}$/.test(maybeDbCode)?maybeDbCode:null;const dbStatus=pgCode==='23505'?409:pgCode&&['23503','23514','22P02'].includes(pgCode)?400:null;const statusCode=appError?.statusCode??(isValidation?400:dbStatus??500);const code=appError?.code??(isValidation?'VALIDATION_ERROR':pgCode?`DATABASE_${pgCode}`:'INTERNAL_ERROR');if(statusCode>=500&&!appError){request.log.error({error:err},'Unhandled request error');captureException(err,{url:request.url,method:request.method});}else request.log.warn({error:err.message,code},'Request rejected');const message=appError?appError.message:statusCode>=500?'Внутренняя ошибка сервера':pgCode==='23505'?'Запись с такими данными уже существует':err.message;reply.code(statusCode).send({error:message,code,...(isValidation?{issues:(err as ZodError).issues}:{})});});

if(!config.DATABASE_URL){
  const postgresKeys=['DATABASE_URL','DATABASE_PRIVATE_URL','DATABASE_PUBLIC_URL','POSTGRES_URL','POSTGRESQL_URL','POSTGRES_DATABASE_URL','PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','POSTGRES_HOST','POSTGRES_PORT','POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_DB','POSTGRES_DATABASE'];
  const present=postgresKeys.filter(key=>typeof process.env[key]==='string'&&String(process.env[key]).trim().length>0);
  const missing=['DATABASE_URL or PGHOST + PGUSER + PGDATABASE'];
  app.log.error({presentPostgresVariables:present,missing},'PostgreSQL is not connected; starting setup-safe mode');
  const payload={ok:true,setupRequired:true,database:false,redis:await redisHealth(),name:'eighth-floor-v4',version:config.APP_VERSION,missing,presentPostgresVariables:present};
  app.get('/health',async()=>payload);
  app.get('/setup-status',async()=>payload);
  const setupHtml=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Настройка PostgreSQL</title><style>body{margin:0;background:#090b0d;color:#e7e1d6;font:16px/1.55 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{max-width:720px;margin:24px;padding:28px;border:1px solid #39342c;background:#121416;border-radius:18px;box-shadow:0 22px 80px #0008}h1{font-size:28px;margin:0 0 14px}code,pre{background:#08090a;border:1px solid #302d28;border-radius:8px;padding:3px 7px;color:#d8c39d}pre{padding:14px;overflow:auto}.bad{color:#ff9a86}.ok{color:#9dd7aa}li{margin:8px 0}</style></head><body><main class="card"><h1>Игра развёрнута, но PostgreSQL не подключён</h1><p class="bad">Контейнер больше не падает. Игровые API временно отключены до появления переменной базы.</p><ol><li>В Railway добавьте сервис <b>PostgreSQL</b> в это же окружение.</li><li>Откройте сервис игры → <b>Variables</b> → <b>Add Reference Variable</b>.</li><li>Выберите PostgreSQL → <code>DATABASE_URL</code>.</li><li>Убедитесь, что в сервисе игры создана ссылка вида:</li></ol><pre>DATABASE_URL=\${{Postgres.DATABASE_URL}}</pre><p>Если сервис называется иначе, Railway подставит его точное имя автоматически. Затем выполните новый Deploy.</p><p>Обнаруженные PostgreSQL-переменные: <code>${present.length?present.join(', '):'нет'}</code></p><p class="ok">После корректной привязки этот же архив автоматически запустит полную игру, миграции и админ-панель.</p></main></body></html>`;
  app.get('/setup',async(_request,reply)=>reply.type('text/html; charset=utf-8').send(setupHtml));
  app.get('/*',async(_request,reply)=>reply.type('text/html; charset=utf-8').send(setupHtml));
  await app.listen({port:config.PORT,host:'0.0.0.0'});
  let setupShuttingDown=false;
  async function shutdownSetup(signal:string){if(setupShuttingDown)return;setupShuttingDown=true;app.log.info({signal},'Setup-safe shutdown');await app.close();await closeRedis();await flushSentry();}
  process.once('SIGTERM',()=>void shutdownSetup('SIGTERM'));
  process.once('SIGINT',()=>void shutdownSetup('SIGINT'));
}else{
await runPreMigrationBackupOnce(app.log);
await runMigrations();
await bootstrapAdmin();
const redis=await getRedis();
if(!redis){
  app.log.warn({redis:redisDiagnostic(),required:config.REDIS_REQUIRED_IN_PRODUCTION},'Redis unavailable; starting in degraded mode. Realtime, matchmaking and distributed presence are disabled.');
}

app.get('/health',async()=>{await pool.query('SELECT 1');const redisOk=await redisHealth();return{ok:true,database:true,redis:redisOk,degraded:!redisOk,disabledFeatures:redisOk?[]:['realtime_coop','matchmaking','distributed_presence'],name:'eighth-floor-v4',version:config.APP_VERSION};});
app.get('/ready',async(_request,reply)=>{await pool.query('SELECT 1');const redisOk=await redisHealth();if(config.NODE_ENV==='production'&&config.REDIS_REQUIRED_IN_PRODUCTION&&!redisOk)return reply.code(503).send({ready:false,database:true,redis:false,redisDiagnostic:redisDiagnostic()});return{ready:true,database:true,redis:redisOk};});
app.get('/setup/redis',async(_request,reply)=>{const diagnostic=redisDiagnostic();const redisKeys=['REDIS_URL','REDIS_PRIVATE_URL','REDIS_PUBLIC_URL','REDIS_TLS_URL','REDIS_URI','REDIS_CONNECTION_STRING','REDISHOST','REDISPORT','REDISUSER','REDISPASSWORD','REDIS_HOST','REDIS_PORT','REDIS_USER','REDIS_PASSWORD'];const present=redisKeys.filter(key=>typeof process.env[key]==='string'&&process.env[key]!.trim().length>0);return reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Настройка Redis</title><style>body{margin:0;background:#0b0d0e;color:#eee;font:16px system-ui;display:grid;place-items:center;min-height:100vh}.card{max-width:760px;margin:24px;padding:28px;background:#17191a;border:1px solid #35312b;border-radius:16px;box-shadow:0 22px 80px #0008}h1{font-size:28px}code,pre{background:#08090a;border:1px solid #302d28;border-radius:8px;padding:3px 7px;color:#d8c39d}pre{padding:14px;overflow:auto}.bad{color:#ff9a86}.ok{color:#9dd7aa}li{margin:8px 0}</style></head><body><main class="card"><h1>Redis ${diagnostic.connected?'подключён':'не подключён'}</h1><p class="${diagnostic.connected?'ok':'bad'}">Основной сервер работает. Без Redis временно выключены realtime-кооператив, matchmaking и распределённое присутствие.</p><ol><li>Добавьте Redis в то же Railway-окружение.</li><li>Сервис игры → Variables → Add Reference Variable.</li><li>Выберите Redis → REDIS_URL.</li><li>Создайте новый Deploy.</li></ol><pre>REDIS_URL=\${{Redis.REDIS_URL}}</pre><p>Обнаруженные переменные: <code>${present.length?present.join(', '):'нет'}</code></p><p>Последняя ошибка: <code>${diagnostic.lastError??'нет'}</code></p><p>Проверка: <code>/health</code></p></main></body></html>`);});
app.get('/metrics',async(request,reply)=>{if(!config.ENABLE_METRICS)return reply.code(404).send();if(config.METRICS_TOKEN&&request.headers.authorization!==`Bearer ${config.METRICS_TOKEN}`)return reply.code(401).send('unauthorized');return reply.type(registry.contentType).send(await registry.metrics());});
app.get('/api/public-config',async()=>({botUsername:config.BOT_USERNAME||'',appVersion:config.APP_VERSION}));
app.get('/api/public-status',{config:{rateLimit:false}},async(_request,reply)=>{
  reply.header('cache-control','no-store, max-age=0');
  return {
  maintenance:await getSetting<boolean>('maintenance_mode',false),
  title:await getSetting<string>('maintenance_title','Дом закрыт на технические работы'),
  message:await getSetting<string>('maintenance_message','Мы проверяем лифт и комнаты. Ваш прогресс сохранён.'),
  eta:await getSetting<string>('maintenance_eta','Проверьте вход немного позже'),
  supportUrl:await getSetting<string>('maintenance_support_url',''),
  appVersion:config.APP_VERSION,
  checkedAt:new Date().toISOString()
};
});

await apiRoutes(app);await v2Routes(app);await v4Routes(app);await telegramWebhookRoutes(app);await adminRoutes(app);await adminV2Routes(app);await adminV4Routes(app);
const realtime=redis?await createRealtimeServer(app.server,app.log):null;

if(!redis){
  app.get('/socket.io/socket.io.js',async(_request,reply)=>reply.type('application/javascript; charset=utf-8').send(`(()=>{window.__REDIS_REALTIME_AVAILABLE__=false;window.io=function(){const handlers={};const socket={connected:false,on(event,fn){(handlers[event]??=[]).push(fn);return socket;},timeout(){return socket;},emit(_event,_payload,callback){if(typeof callback==='function')callback(new Error('REDIS_UNAVAILABLE'));return socket;},disconnect(){return socket;}};queueMicrotask(()=>{for(const fn of handlers.connect_error??[])fn(new Error('Realtime временно недоступен: Redis не подключён'));});return socket;};})();`));
}

const publicDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.wav':'audio/wav','.m4a':'audio/mp4','.ogg':'audio/ogg','.webm':'audio/webm','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'};
app.get('/*',async(request,reply)=>{const raw=String((request.params as Record<string,string>)['*']??'');const relative=raw===''?'index.html':raw;const normalized=path.normalize(relative).replace(/^([.][.][/\\])+/,'');let file=path.resolve(publicDir,normalized);if(!file.startsWith(`${publicDir}${path.sep}`)&&file!==publicDir)throw new AppError('Недопустимый путь',400,'INVALID_PATH');try{const stat=await fs.stat(file);if(stat.isDirectory())file=path.join(file,'index.html');}catch{file=path.join(publicDir,'index.html');}const ext=path.extname(file);const buffer=await fs.readFile(file);const noStore=ext==='.html'||path.basename(file)==='app.js';return reply.header('cache-control',noStore?'no-store':'public, max-age=3600').type(mime[ext]??'application/octet-stream').send(buffer);});

await configureTelegram().catch(error=>app.log.error({error},'Telegram configuration failed'));
await app.listen({port:config.PORT,host:'0.0.0.0'});
const stopBroadcastWorker=startBroadcastWorker(app.log);const stopBackupWorker=startBackupWorker(app.log);const stopV4Worker=startV4Worker(app.log);const voteTimer=setInterval(()=>void closeExpiredVotes().catch(error=>app.log.error({error},'Vote closer failed')),30_000);voteTimer.unref();
let shuttingDown=false;async function shutdown(signal:string){if(shuttingDown)return;shuttingDown=true;app.log.info({signal},'Graceful shutdown');stopBroadcastWorker();stopBackupWorker();stopV4Worker();clearInterval(voteTimer);realtime?.stop();const force=setTimeout(()=>process.exit(1),12_000).unref();await app.close();await closeRedis();await pool.end();await flushSentry();clearTimeout(force);}
process.once('SIGTERM',()=>void shutdown('SIGTERM'));process.once('SIGINT',()=>void shutdown('SIGINT'));

}
