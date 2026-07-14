import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { pool } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { getRedis, withRedisLock } from '../redis.js';

function hash(value:string):string{return crypto.createHmac('sha256',config.WEBHOOK_SECRET).update(value).digest('base64url');}
export function clientSignals(request:FastifyRequest):{fingerprint:string;network:string}{
  const device=String(request.headers['x-client-device-id']??'unknown-device').slice(0,160);
  const ua=String(request.headers['user-agent']??'unknown-agent').slice(0,300);
  const language=String(request.headers['accept-language']??'').slice(0,80);
  const networkSource=String(request.ip??'').split('.').slice(0,3).join('.') || 'unknown-network';
  return{fingerprint:hash(`${device}|${ua}|${language}`),network:hash(networkSource)};
}

export async function recordDeviceSignal(userId:number,request:FastifyRequest):Promise<void>{
  const signal=clientSignals(request);
  await pool.query(`INSERT INTO device_signals(user_id,fingerprint_hash,network_hash) VALUES($1,$2,$3)
    ON CONFLICT(user_id,fingerprint_hash) DO UPDATE SET network_hash=EXCLUDED.network_hash,last_seen_at=NOW(),seen_count=device_signals.seen_count+1`,[userId,signal.fingerprint,signal.network]);
  const shared=await pool.query(`SELECT COUNT(DISTINCT user_id)::int users FROM device_signals WHERE fingerprint_hash=$1 AND last_seen_at>NOW()-INTERVAL '24 hours'`,[signal.fingerprint]);
  const count=Number(shared.rows[0]?.users??0);
  if(count>=4){
    const exists=await pool.query(`SELECT 1 FROM risk_flags WHERE user_id=$1 AND flag_type='shared_device_cluster' AND status IN ('open','reviewing') AND created_at>NOW()-INTERVAL '24 hours'`,[userId]);
    if(!exists.rowCount) await pool.query(`INSERT INTO risk_flags(id,user_id,flag_type,score,details) VALUES($1,$2,'shared_device_cluster',$3,$4)`,[crypto.randomUUID(),userId,Math.min(90,count*12),JSON.stringify({accounts:count})]);
  }
}

export async function flagRisk(userId:string|number,type:string,score:number,details:Record<string,unknown>):Promise<void>{
  await pool.query(`INSERT INTO risk_flags(id,user_id,flag_type,score,details) VALUES($1,$2,$3,$4,$5)`,[crypto.randomUUID(),userId,type,score,JSON.stringify(details)]);
}

export async function assertActionLimit(userId:string|number,action:string,limit:number,windowSeconds:number):Promise<void>{
  const redis=await getRedis();
  if(redis){
    const bucket=Math.floor(Date.now()/1000/windowSeconds);const key=`limit:${action}:${userId}:${bucket}`;
    const count=await redis.incr(key);if(count===1)await redis.expire(key,windowSeconds+5);
    if(count>limit) throw new AppError('Слишком много действий. Дом просит сделать паузу.',429,'ACTION_RATE_LIMIT');
    return;
  }
  const result=await pool.query(`SELECT COUNT(*)::int count FROM analytics_events WHERE user_id=$1 AND event_name=$2 AND created_at>NOW()-($3::text||' seconds')::interval`,[userId,`limit:${action}`,windowSeconds]);
  if(Number(result.rows[0]?.count??0)>=limit) throw new AppError('Слишком много действий. Дом просит сделать паузу.',429,'ACTION_RATE_LIMIT');
  await pool.query(`INSERT INTO analytics_events(user_id,event_name,properties) VALUES($1,$2,'{}')`,[userId,`limit:${action}`]);
}

export function operationKey(request:FastifyRequest,body?:Record<string,unknown>):string{
  const raw=request.headers['x-idempotency-key']??body?.operationId;
  if(typeof raw==='string'&&/^[a-zA-Z0-9._:-]{8,128}$/.test(raw))return raw;
  throw new AppError('Для этого действия требуется X-Idempotency-Key',400,'IDEMPOTENCY_KEY_REQUIRED');
}

export async function executeIdempotent<T extends Record<string,unknown>>(userId:string|number,scope:string,key:string,payload:unknown,fn:()=>Promise<T>):Promise<T>{
  const requestHash=crypto.createHash('sha256').update(JSON.stringify(payload??null)).digest('hex');
  const existing=await pool.query(`SELECT request_hash,status,response_body,expires_at FROM idempotency_records WHERE user_id=$1 AND scope=$2 AND operation_key=$3`,[userId,scope,key]);
  if(existing.rows[0]){
    if(existing.rows[0].request_hash!==requestHash)throw new AppError('Ключ операции уже использован с другими данными',409,'IDEMPOTENCY_CONFLICT');
    if(existing.rows[0].status==='completed')return existing.rows[0].response_body as T;
    if(new Date(existing.rows[0].expires_at).getTime()>Date.now())throw new AppError('Операция уже выполняется',409,'IDEMPOTENCY_IN_PROGRESS');
  }
  const result=await withRedisLock(`idem:${userId}:${scope}:${key}`,30_000,async()=>{
    await pool.query(`INSERT INTO idempotency_records(user_id,scope,operation_key,request_hash,status,expires_at) VALUES($1,$2,$3,$4,'processing',NOW()+($5::text||' seconds')::interval)
      ON CONFLICT(user_id,scope,operation_key) DO UPDATE SET request_hash=EXCLUDED.request_hash,status='processing',response_body=NULL,expires_at=EXCLUDED.expires_at`,[userId,scope,key,requestHash,config.IDEMPOTENCY_TTL_SECONDS]);
    try{const value=await fn();await pool.query(`UPDATE idempotency_records SET status='completed',response_status=200,response_body=$4 WHERE user_id=$1 AND scope=$2 AND operation_key=$3`,[userId,scope,key,JSON.stringify(value)]);return value;}
    catch(error){await pool.query(`UPDATE idempotency_records SET status='failed',expires_at=NOW()+INTERVAL '5 minutes' WHERE user_id=$1 AND scope=$2 AND operation_key=$3`,[userId,scope,key]).catch(()=>undefined);throw error;}
  });
  if(result===null)throw new AppError('Операция уже выполняется',409,'IDEMPOTENCY_IN_PROGRESS');
  return result;
}

export async function referralIsSuspicious(inviterId:string|number,invitedId:string|number):Promise<boolean>{
  if(String(inviterId)===String(invitedId))return true;
  const result=await pool.query(`SELECT EXISTS(SELECT 1 FROM device_signals a JOIN device_signals b ON b.fingerprint_hash=a.fingerprint_hash WHERE a.user_id=$1 AND b.user_id=$2 AND a.last_seen_at>NOW()-INTERVAL '7 days' AND b.last_seen_at>NOW()-INTERVAL '7 days') suspicious`,[inviterId,invitedId]);
  return Boolean(result.rows[0]?.suspicious);
}
