import crypto from 'node:crypto';
import { pool } from '../db.js';

export async function trackEvent(userId:string|number|null,eventName:string,properties:Record<string,unknown>={},sessionId?:string,appVersion?:string,assignments:Record<string,string>={}){
  await pool.query(`INSERT INTO analytics_events(user_id,session_id,event_name,properties,app_version,experiment_assignments) VALUES($1,$2,$3,$4,$5,$6)`,[userId,sessionId??null,eventName,JSON.stringify(properties),appVersion??null,JSON.stringify(assignments)]);
  if(sessionId&&userId)await pool.query(`INSERT INTO app_sessions(id,user_id,app_version) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET last_seen_at=NOW(),app_version=COALESCE(EXCLUDED.app_version,app_sessions.app_version)`,[sessionId,userId,appVersion??null]);
}
export async function assignmentsFor(userId:string|number){
  const experiments=await pool.query(`SELECT e.id,e.key,e.allocation FROM ab_experiments e WHERE e.status='running' AND (e.starts_at IS NULL OR e.starts_at<=NOW()) AND (e.ends_at IS NULL OR e.ends_at>NOW())`);const output:Record<string,{variant:string;config:unknown}>={};
  for(const experiment of experiments.rows){
    const bucket=Number(BigInt('0x'+crypto.createHash('sha256').update(`${userId}:${experiment.key}`).digest('hex').slice(0,12))%100n);if(bucket>=Number(experiment.allocation))continue;
    let assigned=await pool.query(`SELECT v.key,v.config FROM user_experiment_assignments a JOIN ab_variants v ON v.id=a.variant_id WHERE a.experiment_id=$1 AND a.user_id=$2`,[experiment.id,userId]);
    if(!assigned.rows[0]){const variants=await pool.query(`SELECT id,key,weight,config FROM ab_variants WHERE experiment_id=$1 ORDER BY key`,[experiment.id]);const total=variants.rows.reduce((s,r)=>s+Number(r.weight),0);let point=Number(BigInt('0x'+crypto.createHash('sha256').update(`${userId}:${experiment.key}:variant`).digest('hex').slice(0,12))%BigInt(Math.max(total,1)));let chosen=variants.rows[0];for(const variant of variants.rows){if(point<Number(variant.weight)){chosen=variant;break;}point-=Number(variant.weight);}if(chosen){await pool.query(`INSERT INTO user_experiment_assignments(experiment_id,user_id,variant_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[experiment.id,userId,chosen.id]);assigned={rows:[chosen]} as any;}}
    if(assigned.rows[0])output[experiment.key]={variant:assigned.rows[0].key,config:assigned.rows[0].config};
  }return output;
}
export async function productAnalytics(days=30){
  const [retention,funnel,revenue,sessions,referrals]=await Promise.all([
    pool.query(`WITH cohorts AS (SELECT id,created_at::date cohort FROM users WHERE id>0 AND created_at>=CURRENT_DATE-$1::int), activity AS (SELECT DISTINCT user_id,created_at::date activity_day FROM analytics_events WHERE created_at>=CURRENT_DATE-$1::int) SELECT COUNT(*)::int signups,ROUND(100.0*COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM activity a WHERE a.user_id=c.id AND a.activity_day=c.cohort+1))/NULLIF(COUNT(*),0),2) d1,ROUND(100.0*COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM activity a WHERE a.user_id=c.id AND a.activity_day=c.cohort+7))/NULLIF(COUNT(*),0),2) d7,ROUND(100.0*COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM activity a WHERE a.user_id=c.id AND a.activity_day=c.cohort+30))/NULLIF(COUNT(*),0),2) d30 FROM cohorts c`,[days]),
    pool.query(`SELECT event_name,COUNT(DISTINCT user_id)::int users,COUNT(*)::int events FROM analytics_events WHERE created_at>=CURRENT_DATE-$1::int AND event_name IN ('app_open','tutorial_complete','expedition_start','expedition_complete','invite_open','purchase_paid') GROUP BY event_name`,[days]),
    pool.query(`SELECT COUNT(DISTINCT user_id)::int payers,COALESCE(SUM(stars),0)::int stars,ROUND(COALESCE(AVG(stars),0),2) avg_check,COUNT(*)::int purchases,COUNT(DISTINCT user_id) FILTER(WHERE c>1)::int repeat_payers FROM (SELECT p.*,COUNT(*) OVER(PARTITION BY user_id)c FROM purchases p WHERE status='paid' AND created_at>=CURRENT_DATE-$1::int)p`,[days]),
    pool.query(`SELECT ROUND(AVG(EXTRACT(EPOCH FROM(COALESCE(ended_at,last_seen_at)-started_at))/60),2) avg_minutes,ROUND(AVG(sessions),2) sessions_per_user FROM (SELECT user_id,COUNT(*) sessions,MIN(started_at) started_at,MAX(last_seen_at) last_seen_at,MAX(ended_at) ended_at FROM app_sessions WHERE started_at>=CURRENT_DATE-$1::int GROUP BY user_id)s`,[days]),
    pool.query(`SELECT COUNT(*)::int invited,COUNT(*) FILTER(WHERE rewarded_at IS NOT NULL)::int rewarded FROM referral_rewards WHERE rewarded_at>=CURRENT_DATE-$1::int`,[days])
  ]);return{retention:retention.rows[0],funnel:funnel.rows,revenue:revenue.rows[0],sessions:sessions.rows[0],referrals:referrals.rows[0]};
}
