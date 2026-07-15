import type { FastifyBaseLogger } from 'fastify';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { restorePurchase } from '../telegram.js';

async function tick(logger:FastifyBaseLogger){
  await pool.query(`UPDATE chat_cases SET status='expired' WHERE status IN ('preparing','active') AND expires_at<=NOW()`);
  await pool.query(`UPDATE live_nights SET phase=CASE WHEN starts_at<=NOW() AND ends_at>NOW() THEN 'live' WHEN ends_at<=NOW() AND phase<>'resolved' THEN 'closed' ELSE phase END WHERE phase IN ('scheduled','live')`);
  const missing=await pool.query(`SELECT p.id,p.user_id::text FROM purchases p LEFT JOIN purchase_fulfillments f ON f.purchase_id=p.id WHERE p.status='paid' AND f.purchase_id IS NULL LIMIT 20`);
  for(const row of missing.rows){
    await pool.query(`INSERT INTO payment_recovery_jobs(id,purchase_id,job_type) VALUES($1,$2,'restore_fulfillment') ON CONFLICT DO NOTHING`,[crypto.randomUUID(),row.id]);
  }
  const jobs=await pool.query(`SELECT j.id,j.purchase_id,p.user_id::text FROM payment_recovery_jobs j JOIN purchases p ON p.id=j.purchase_id WHERE j.status='pending' AND j.run_after<=NOW() ORDER BY j.created_at LIMIT 10`);
  for(const job of jobs.rows){
    try{await restorePurchase(job.user_id,job.purchase_id);await pool.query(`UPDATE payment_recovery_jobs SET status='completed',attempts=attempts+1,last_error=NULL WHERE id=$1`,[job.id]);}
    catch(error){const message=error instanceof Error?error.message:String(error);await pool.query(`UPDATE payment_recovery_jobs SET attempts=attempts+1,last_error=$2,status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,run_after=NOW()+INTERVAL '10 minutes' WHERE id=$1`,[job.id,message]);logger.warn({purchaseId:job.purchase_id,error:message},'Payment recovery delayed');}
  }
}
export function startV4Worker(logger:FastifyBaseLogger){const timer=setInterval(()=>void tick(logger).catch(error=>logger.error({error},'V4 worker failed')),60_000);timer.unref();void tick(logger).catch(error=>logger.error({error},'V4 initial worker failed'));return()=>clearInterval(timer);}
