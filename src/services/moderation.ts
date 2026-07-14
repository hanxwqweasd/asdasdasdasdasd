import crypto from 'node:crypto';
import { pool } from '../db.js';
import { getSetting } from '../settings.js';
import { AppError } from '../errors.js';

const BUILTIN_PATTERNS=[/\b(?:spam|scam)\b/iu,/https?:\/\/\S+/iu,/\b(?:куп[люи]|продам)\s+(?:аккаунт|зв[её]зды)\b/iu];
export async function moderationState(userId:string|number){const r=await pool.query(`SELECT banned,reason,banned_until,muted_until,shadow_muted,updated_at FROM user_moderation WHERE user_id=$1`,[userId]);return r.rows[0]??{banned:false,muted_until:null,shadow_muted:false};}
export async function assertCanCommunicate(userId:string|number){const state=await moderationState(userId);if(state.muted_until&&new Date(state.muted_until).getTime()>Date.now())throw new AppError('Возможность писать временно ограничена',403,'USER_MUTED');const user=await pool.query(`SELECT created_at FROM users WHERE id=$1`,[userId]);const hours=await getSetting<number>('new_user_social_limit_hours',6);if(user.rows[0]&&Date.now()-new Date(user.rows[0].created_at).getTime()<Number(hours)*3600000){const notes=await pool.query(`SELECT COUNT(*)::int count FROM neighbor_notes WHERE author_id=$1 AND created_at>NOW()-INTERVAL '1 hour'`,[userId]);if(Number(notes.rows[0].count)>=3)throw new AppError('Новый жилец пока может оставить не больше трёх записок в час',429,'NEW_USER_SOCIAL_LIMIT');}}
export async function moderateText(userId:string|number,text:string,context:Record<string,unknown>={}):Promise<{text:string;hidden:boolean;score:number}>{
  let score=0;for(const pattern of BUILTIN_PATTERNS)if(pattern.test(text))score++;
  const terms=await pool.query(`SELECT pattern,severity,action FROM moderation_terms WHERE active=TRUE`);for(const term of terms.rows){try{if(new RegExp(term.pattern,'iu').test(text))score+=Number(term.severity);}catch{}}
  const threshold=await getSetting<number>('moderation_auto_hide_score',2);const hidden=score>=Number(threshold);
  if(score>0)await pool.query(`INSERT INTO risk_flags(id,user_id,flag_type,score,details) VALUES($1,$2,'message_content',$3,$4)`,[crypto.randomUUID(),userId,Math.min(100,score*20),JSON.stringify({...context,excerpt:text.slice(0,120),hidden})]);
  return{text:text.trim(),hidden,score};
}
export async function createReport(reporterId:string|number,targetId:string|number,entityType:string,entityId:string|undefined,reason:string,details?:string){if(String(reporterId)===String(targetId))throw new AppError('Нельзя пожаловаться на себя',400,'SELF_REPORT');const id=crypto.randomUUID();await pool.query(`INSERT INTO user_reports(id,reporter_id,target_user_id,entity_type,entity_id,reason,details) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,reporterId,targetId,entityType,entityId??null,reason,details??null]);return{id};}
