import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from './config.js';
import { pool, withTransaction } from './db.js';
import { AppError } from './errors.js';
import { recordDeviceSignal, referralIsSuspicious, flagRisk } from './security/anti-abuse.js';
import { ensureBuildingMembership } from './services/building.js';
import { changeInventory } from './services/economy.js';

export interface TelegramUser { id:number; first_name:string; last_name?:string; username?:string; language_code?:string; photo_url?:string; }
function safeEqualHex(a:string,b:string){if(!/^[a-f0-9]+$/i.test(a)||!/^[a-f0-9]+$/i.test(b)||a.length!==b.length)return false;return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
export function validateInitData(initData:string):TelegramUser{
  const params=new URLSearchParams(initData);const hash=params.get('hash');if(!hash)throw new AppError('В Telegram-данных отсутствует подпись',401,'TELEGRAM_AUTH_INVALID');params.delete('hash');params.delete('signature');
  const dataCheckString=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n');
  const secretKey=crypto.createHmac('sha256','WebAppData').update(config.BOT_TOKEN).digest();const calculated=crypto.createHmac('sha256',secretKey).update(dataCheckString).digest('hex');
  if(!safeEqualHex(hash,calculated))throw new AppError('Подпись Telegram недействительна',401,'TELEGRAM_AUTH_INVALID');const authDate=Number(params.get('auth_date'));if(!Number.isFinite(authDate)||Math.floor(Date.now()/1000)-authDate>config.AUTH_MAX_AGE_SECONDS)throw new AppError('Авторизация Telegram устарела',401,'TELEGRAM_AUTH_EXPIRED');
  const rawUser=params.get('user');if(!rawUser)throw new AppError('Пользователь Telegram не передан',401,'TELEGRAM_AUTH_INVALID');return JSON.parse(rawUser) as TelegramUser;
}
function referralCode(userId:number){return crypto.createHash('sha256').update(`${userId}:${config.WEBHOOK_SECRET}`).digest('base64url').slice(0,10);}
export async function upsertUser(user:TelegramUser,referredByCode?:string|null):Promise<void>{
  await pool.query(`INSERT INTO users(id,username,first_name,last_name,photo_url,language_code,referral_code,referred_by) VALUES($1,$2,$3,$4,$5,$6,$7,(SELECT id FROM users WHERE referral_code=$8 AND id<>$1))
    ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,photo_url=EXCLUDED.photo_url,language_code=EXCLUDED.language_code,referred_by=COALESCE(users.referred_by,EXCLUDED.referred_by),updated_at=NOW()`,[user.id,user.username??null,user.first_name,user.last_name??null,user.photo_url??null,user.language_code??null,referralCode(user.id),referredByCode??null]);
  await pool.query(`INSERT INTO player_profiles(user_id,apartment_no) VALUES($1,100+(($1::bigint%700)::int)) ON CONFLICT(user_id) DO UPDATE SET last_seen=NOW()`,[user.id]);await ensureBuildingMembership(user.id);
}
export async function processReferralReward(invitedId:number):Promise<void>{
  const result=await pool.query<{referred_by:string|null}>('SELECT referred_by::text FROM users WHERE id=$1',[invitedId]);const inviterId=result.rows[0]?.referred_by;if(!inviterId||String(inviterId)===String(invitedId))return;
  if(await referralIsSuspicious(inviterId,invitedId)){await flagRisk(invitedId,'suspicious_referral',70,{inviterId});await flagRisk(inviterId,'suspicious_referral_cluster',55,{invitedId});return;}
  await withTransaction(async client=>{const inserted=await client.query(`INSERT INTO referral_rewards(inviter_id,invited_id) VALUES($1,$2) ON CONFLICT(invited_id) DO NOTHING RETURNING invited_id`,[inviterId,invitedId]);if(!inserted.rowCount)return;await changeInventory(client,inviterId,'spare_key',1,'referral_reward',`referral:${invitedId}`,{invitedId});await client.query(`UPDATE player_profiles SET trust=trust+3 WHERE user_id=$1`,[inviterId]);await client.query(`INSERT INTO economy_ledger(user_id,asset_type,asset_key,delta,balance_after,reason,operation_id,metadata) SELECT $1,'profile','trust',3,trust,'referral_reward',$2,$3 FROM player_profiles WHERE user_id=$1`,[inviterId,`referral:${invitedId}`,JSON.stringify({invitedId})]);});
}
export async function assertNotBanned(userId:number):Promise<void>{const result=await pool.query(`SELECT banned,reason,banned_until FROM user_moderation WHERE user_id=$1`,[userId]);const row=result.rows[0];if(!row?.banned)return;if(row.banned_until&&new Date(row.banned_until).getTime()<=Date.now()){await pool.query(`UPDATE user_moderation SET banned=FALSE,reason=NULL,banned_until=NULL,updated_at=NOW() WHERE user_id=$1`,[userId]);return;}throw new AppError(row.reason?`Доступ ограничен: ${row.reason}`:'Доступ к дому ограничен',403,'USER_BANNED');}
export async function authenticateInitDataString(initData:string):Promise<TelegramUser>{const user=validateInitData(initData);const startParam=new URLSearchParams(initData).get('start_param');await upsertUser(user,startParam);await assertNotBanned(user.id);await processReferralReward(user.id);return user;}
export async function authenticateRequest(request:FastifyRequest):Promise<TelegramUser>{
  const initData=request.headers['x-telegram-init-data'];if(typeof initData==='string'&&initData.length>0){const user=validateInitData(initData);const startParam=new URLSearchParams(initData).get('start_param');await upsertUser(user,startParam);await recordDeviceSignal(user.id,request);await assertNotBanned(user.id);await processReferralReward(user.id);return user;}
  if(config.ALLOW_DEV_AUTH&&config.NODE_ENV!=='production'){const idHeader=request.headers['x-dev-user-id'];const id=idHeader?Number(idHeader):config.DEV_USER_ID;const user={id,first_name:`Тестовый жилец ${id}`,username:`resident_${id}`};await upsertUser(user);await recordDeviceSignal(user.id,request);await assertNotBanned(user.id);return user;}
  throw new AppError('Откройте игру из Telegram',401,'TELEGRAM_AUTH_REQUIRED');
}
