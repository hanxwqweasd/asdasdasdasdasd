import crypto from 'node:crypto';
import { pool, withTransaction } from '../db.js';
import { AppError } from '../errors.js';
import { config } from '../config.js';
import { callTelegram } from '../telegram.js';
import { changeInventory } from './economy.js';
import { ensureBuildingMembership } from './building.js';

const PHRASES=new Set(['dont_open','im_here','lift_arrived','not_my_flat','look_back']);
const ROOM_COMPONENTS=new Set(['door','window','table','radio','mirror','lamp','wardrobe','camera','mailbox','pipes']);
const ROOM_SOUNDS=new Set(['pipes','wind','camera','voices','radio','elevator','water','glass']);
const MOTION_TYPES=new Set(['tilt','still','peephole','tune']);
function token(size=18){return crypto.randomBytes(size).toString('base64url');}
function hash(value:string){return crypto.createHash('sha256').update(value).digest('hex');}
function weekStart(){const d=new Date();const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);return d.toISOString().slice(0,10);}

export async function recordRoomTrace(userId:number,roomId:string,traceType:string,payload:Record<string,unknown>={}){
  const allowed=['silhouette','sound','message','object','camera','warning'];
  const type=allowed.includes(traceType)?traceType:'silhouette';
  const id=crypto.randomUUID();
  await pool.query(`INSERT INTO room_traces(id,room_id,user_id,trace_type,payload) VALUES($1,$2,$3,$4,$5)`,[id,roomId,userId,type,JSON.stringify(payload)]);
  return{id};
}
export async function roomTraces(roomId:string,userId:number){
  const r=await pool.query(`SELECT id,trace_type,payload,created_at,CASE WHEN user_id=$2 THEN TRUE ELSE FALSE END own FROM room_traces WHERE room_id=$1 AND expires_at>NOW() AND (user_id IS NULL OR user_id<>$2) ORDER BY created_at DESC LIMIT 8`,[roomId,userId]);
  return r.rows;
}
export async function relationshipEvent(userId:number,otherId:number,kind:'help'|'abandon'|'trust'|'debt'|'secret',context:Record<string,unknown>={}){
  if(userId===otherId)return;
  const delta=kind==='help'?4:kind==='trust'?2:kind==='abandon'?-7:kind==='debt'?-2:1;
  await pool.query(`INSERT INTO player_relationships(user_id,other_user_id,trust,debt,rescues,abandonments,labels,secrets) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
  ON CONFLICT(user_id,other_user_id) DO UPDATE SET trust=player_relationships.trust+$3,debt=player_relationships.debt+$4,rescues=player_relationships.rescues+$5,abandonments=player_relationships.abandonments+$6,labels=CASE WHEN $9::text IS NULL THEN player_relationships.labels ELSE (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(player_relationships.labels||$7) x) END,secrets=player_relationships.secrets||$8,updated_at=NOW()`,[userId,otherId,delta,kind==='debt'?1:0,kind==='help'?1:0,kind==='abandon'?1:0,JSON.stringify(kind==='help'?['спаситель']:kind==='abandon'?['бросивший']:kind==='secret'?['знает_секрет']:[]),JSON.stringify(kind==='secret'?[context]:[]),kind]);
}
export async function relationships(userId:number){
  const r=await pool.query(`SELECT r.*,u.first_name,u.username,p.apartment_no FROM player_relationships r JOIN users u ON u.id=r.other_user_id LEFT JOIN player_profiles p ON p.user_id=u.id WHERE r.user_id=$1 ORDER BY r.trust DESC,r.updated_at DESC LIMIT 80`,[userId]);return r.rows;
}

export async function prepareShareCard(userId:number,body:{kind:string;title:string;subtitle:string;facts:string[]}){
  const id=crypto.randomUUID(), cardToken=token(16);const storyUrl=config.PUBLIC_URL?`${config.PUBLIC_URL.replace(/\/$/,'')}/cards/story.png`:undefined;
  const invite=(await pool.query(`SELECT referral_code FROM users WHERE id=$1`,[userId])).rows[0]?.referral_code;
  const launch=`https://t.me/${config.BOT_USERNAME.replace(/^@/,'')}?start=${encodeURIComponent(invite||'app')}`;
  const text=`${body.title}\n${body.subtitle}\n\n${body.facts.slice(0,5).map(x=>`• ${x}`).join('\n')}\n\nВОСЬМОГО ЭТАЖА НЕТ`;
  let preparedMessageId:string|null=null;
  try{
    const result=await callTelegram<{id:string}>('savePreparedInlineMessage',{user_id:userId,result:{type:'article',id:id.slice(0,32),title:body.title,input_message_content:{message_text:text},reply_markup:{inline_keyboard:[[{text:'Позвать свидетеля',url:launch}]]}},allow_user_chats:true,allow_group_chats:true,allow_channel_chats:true});preparedMessageId=result.id;
  }catch{}
  await pool.query(`INSERT INTO share_cards(id,user_id,token,kind,title,subtitle,facts,prepared_message_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,userId,cardToken,body.kind,body.title,body.subtitle,JSON.stringify(body.facts),preparedMessageId]);
  return{id,token:cardToken,preparedMessageId,storyUrl,storyText:text,inviteUrl:launch};
}

export async function prepareChatCase(userId:number,scenarioKey='missing-tenant'){
  const id=crypto.randomUUID(),inviteCode=token(6).slice(0,8).toUpperCase(),requestInt=crypto.randomInt(1,2_000_000_000);
  let requestId:string|null=null;
  try{
    const result=await callTelegram<{id:string}>('savePreparedKeyboardButton',{user_id:userId,button:{text:'Выбрать чат для дела',request_chat:{request_id:requestInt,chat_is_channel:false,request_title:true,request_username:true,bot_is_member:true}}});requestId=result.id;
  }catch(error){throw new AppError(error instanceof Error?error.message:'Telegram не подготовил выбор чата',502,'CHAT_REQUEST_PREPARE_FAILED');}
  await pool.query(`INSERT INTO chat_cases(id,owner_id,request_id,invite_code,scenario_key,state) VALUES($1,$2,$3,$4,$5,$6)`,[id,userId,requestId,inviteCode,scenarioKey,JSON.stringify({requestInt,progress:0,clues:[],decision:null})]);
  return{id,requestId,inviteCode,scenarioKey};
}
export async function attachSharedChat(userId:number,chatShared:any){
  const requestInt=Number(chatShared?.request_id);
  const latest=Number.isInteger(requestInt)
    ? await pool.query(`SELECT id,invite_code,scenario_key FROM chat_cases WHERE owner_id=$1 AND status='preparing' AND (state->>'requestInt')::bigint=$2 ORDER BY created_at DESC LIMIT 1`,[userId,requestInt])
    : await pool.query(`SELECT id,invite_code,scenario_key FROM chat_cases WHERE owner_id=$1 AND status='preparing' ORDER BY created_at DESC LIMIT 1`,[userId]);
  const row=latest.rows[0];if(!row)return null;
  const title=chatShared.title??chatShared.username??'Выбранный чат';
  await pool.query(`UPDATE chat_cases SET chat_id=$2,chat_title=$3,status='active',state=state||$4 WHERE id=$1`,[row.id,String(chatShared.chat_id),title,JSON.stringify({chatShared})]);
  const text=`Дело «${row.scenario_key}» открыто. Код для жильцов: ${row.invite_code}. Откройте Mini App и введите код в разделе «Дом+ → Жильцы».`;
  try{await callTelegram('sendMessage',{chat_id:chatShared.chat_id,text});}catch{}
  try{await callTelegram('sendMessage',{chat_id:userId,text:`Чат «${title}» привязан к делу. Код: ${row.invite_code}`});}catch{}
  return row.id;
}
export async function chatCases(userId:number){const r=await pool.query(`SELECT c.*,COALESCE((SELECT COUNT(*) FROM chat_case_members m WHERE m.case_id=c.id),0)::int members FROM chat_cases c WHERE c.owner_id=$1 OR EXISTS(SELECT 1 FROM chat_case_members m WHERE m.case_id=c.id AND m.user_id=$1) ORDER BY c.created_at DESC`,[userId]);return r.rows;}
export async function joinChatCase(userId:number,code:string){return withTransaction(async client=>{const c=await client.query(`SELECT * FROM chat_cases WHERE invite_code=$1 AND status='active' AND expires_at>NOW() FOR UPDATE`,[code.toUpperCase()]);if(!c.rows[0])throw new AppError('Дело не найдено или закрыто',404,'CHAT_CASE_NOT_FOUND');const count=await client.query(`SELECT COUNT(*)::int n FROM chat_case_members WHERE case_id=$1`,[c.rows[0].id]);const roles=['свидетель','архивист','наблюдатель','хранитель_ключа'];const role=roles[Number(count.rows[0].n)%roles.length];await client.query(`INSERT INTO chat_case_members(case_id,user_id,role_key,clues) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[c.rows[0].id,userId,role,JSON.stringify([`Фрагмент ${Number(count.rows[0].n)+1}`])]);return{caseId:c.rows[0].id,role};});}

export async function antagonistState(userId:number){
  const buildingId=await ensureBuildingMembership(userId);const week=weekStart();let r=await pool.query(`SELECT * FROM antagonist_cycles WHERE building_id=$1 AND week_start=$2`,[buildingId,week]);if(!r.rows[0]){const candidates=await pool.query(`SELECT user_id::text FROM building_members WHERE building_id=$1 ORDER BY random() LIMIT 1`,[buildingId]);const selected=Math.random()<.25?candidates.rows[0]?.user_id:null;const id=crypto.randomUUID();await pool.query(`INSERT INTO antagonist_cycles(id,building_id,week_start,antagonist_user_id,mode,state) VALUES($1,$2,$3,$4,$5,$6)`,[id,buildingId,week,selected,selected?'player':'system',JSON.stringify({suspicion:0,interventions:[],rule:'Не доверяйте объявлениям после 00:08'})]);r=await pool.query(`SELECT * FROM antagonist_cycles WHERE id=$1`,[id]);}
  const row=r.rows[0];return{...row,isYou:String(row.antagonist_user_id||'')===String(userId),publicMessage:row.mode==='player'?'Управляющий мог выбрать одного из жильцов.':'Управляющий меняет записи в доме.'};
}
export async function antagonistIntervention(userId:number,action:string){const state=await antagonistState(userId);if(!state.isYou)throw new AppError('У вас нет ключей Управляющего',403,'NOT_ANTAGONIST');const allowed=['forge_notice','lock_room','move_item','false_vote'];if(!allowed.includes(action))throw new AppError('Действие недоступно',400);await pool.query(`UPDATE antagonist_cycles SET state=jsonb_set(state,'{interventions}',COALESCE(state->'interventions','[]'::jsonb)||$2::jsonb) WHERE id=$1`,[state.id,JSON.stringify([{action,at:new Date().toISOString()}])]);return{ok:true};}

export async function activeLiveNight(userId:number){
  const now=new Date();let r=await pool.query(`SELECT * FROM live_nights WHERE ends_at>NOW()-INTERVAL '2 hours' ORDER BY starts_at DESC LIMIT 1`);
  if(!r.rows[0]){const next=new Date(now);next.setUTCDate(now.getUTCDate()+((6-now.getUTCDay()+7)%7||7));next.setUTCHours(21,8,0,0);const id=crypto.randomUUID();await pool.query(`INSERT INTO live_nights(id,event_key,title,starts_at,ends_at,config) VALUES($1,$2,'Ночь 00:08',$3,$4,$5) ON CONFLICT(event_key) DO NOTHING`,[id,`night-${next.toISOString().slice(0,10)}`,next,new Date(next.getTime()+40*60_000),JSON.stringify({rooms:['blackout','registry','manager'],rewards:{clues:3,marks:25}})]);r=await pool.query(`SELECT * FROM live_nights WHERE event_key=$1`,[`night-${next.toISOString().slice(0,10)}`]);}
  const row=r.rows[0];const c=await pool.query(`SELECT * FROM live_night_contributions WHERE night_id=$1 AND user_id=$2`,[row.id,userId]);return{night:row,contribution:c.rows[0]??null,serverTime:Date.now()};
}
export async function contributeLiveNight(userId:number,amount:number,fragment:string){const current=await activeLiveNight(userId);const n=current.night;if(new Date(n.starts_at)>new Date()||new Date(n.ends_at)<new Date())throw new AppError('Событие сейчас закрыто',409,'LIVE_NIGHT_CLOSED');const building=await ensureBuildingMembership(userId);return withTransaction(async client=>{await client.query(`INSERT INTO live_night_contributions(night_id,user_id,building_id,contribution,fragments) VALUES($1,$2,$3,$4,$5) ON CONFLICT(night_id,user_id) DO UPDATE SET contribution=live_night_contributions.contribution+$4,fragments=live_night_contributions.fragments||$5,updated_at=NOW()`,[n.id,userId,building,amount,JSON.stringify([fragment])]);await client.query(`UPDATE live_nights SET global_progress=LEAST(global_target,global_progress+$2),phase=CASE WHEN global_progress+$2>=global_target THEN 'resolved' ELSE 'live' END WHERE id=$1`,[n.id,amount]);return activeLiveNight(userId);});}

export async function createMotionChallenge(userId:number,type:string){if(!MOTION_TYPES.has(type))throw new AppError('Неизвестная комната движения',400);const target=type==='tilt'?{maxTilt:8,holdMs:2500}:type==='still'?{maxDelta:.7,holdMs:3000}:type==='peephole'?{yaw:25,pitch:8}: {turns:3,tolerance:12};const id=crypto.randomUUID(),fallback=String(crypto.randomInt(1000,9999));await pool.query(`INSERT INTO motion_challenges(id,user_id,challenge_type,target,fallback_code,expires_at) VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '10 minutes')`,[id,userId,type,JSON.stringify(target),fallback]);return{id,type,target,fallback};}
function finiteSamples(value:any){return Array.isArray(value)?value.slice(-40).filter((sample:any)=>sample&&Object.values(sample).every(v=>Number.isFinite(Number(v)))):[];}
export function motionPassed(type:string,target:any,result:any){const samples=finiteSamples(result?.samples);if(samples.length<8)return false;if(type==='tilt'){return samples.every((s:any)=>Math.abs(Number(s.x))<=Number(target.maxTilt||8)&&Math.abs(Number(s.y))<=Number(target.maxTilt||8));}if(type==='still'){let max=0;for(let i=1;i<samples.length;i++){const a=samples[i-1],b=samples[i];max=Math.max(max,Math.abs(Number(a.x)-Number(b.x))+Math.abs(Number(a.y)-Number(b.y))+Math.abs(Number(a.z)-Number(b.z)));}return max<=Number(target.maxDelta||.7);}const angles=samples.map((s:any)=>Number(s.alpha)).filter(Number.isFinite);if(angles.length<8)return false;const span=Math.max(...angles)-Math.min(...angles);return type==='peephole'?span>=Number(target.yaw||25)*.6:span>=90;}
export async function verifyMotionChallenge(userId:number,id:string,result:any,fallbackCode?:string){return withTransaction(async client=>{const r=await client.query(`SELECT * FROM motion_challenges WHERE id=$1 AND user_id=$2 AND status='active' AND expires_at>NOW() FOR UPDATE`,[id,userId]);const row=r.rows[0];if(!row)throw new AppError('Испытание завершено',409);const passed=fallbackCode===row.fallback_code||motionPassed(row.challenge_type,row.target,result);if(!passed)throw new AppError('Комната заметила неверное движение',422,'MOTION_FAILED');await client.query(`UPDATE motion_challenges SET status='completed',result=$2 WHERE id=$1`,[id,JSON.stringify(result||{fallback:true})]);await client.query(`UPDATE player_profiles SET clues=clues+1 WHERE user_id=$1`,[userId]);return{passed:true,reward:{clues:1}};});}

export async function biometricState(userId:number){const r=await pool.query(`SELECT device_id,token_hash IS NOT NULL enrolled,secret_payload,unlocked_at FROM biometric_safes WHERE user_id=$1`,[userId]);return r.rows[0]??{enrolled:false};}
export async function enrollBiometric(userId:number,deviceId:string,biometricToken:string){const recovery=token(10);await pool.query(`INSERT INTO biometric_safes(user_id,device_id,token_hash,recovery_code_hash,secret_payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET device_id=$2,token_hash=$3,recovery_code_hash=$4,updated_at=NOW()`,[userId,deviceId,hash(biometricToken),hash(recovery),JSON.stringify({document:'Протокол квартиры',line:'Управляющий не зарегистрирован среди жильцов.'})]);return{recoveryCode:recovery};}
export async function unlockBiometric(userId:number,biometricToken?:string,recoveryCode?:string){const r=await pool.query(`SELECT * FROM biometric_safes WHERE user_id=$1`,[userId]);const row=r.rows[0];if(!row)throw new AppError('Сейф ещё не настроен',404);if(hash(biometricToken||'')!==row.token_hash&&hash(recoveryCode||'')!==row.recovery_code_hash)throw new AppError('Сейф не узнал владельца',403,'SAFE_AUTH_FAILED');await pool.query(`UPDATE biometric_safes SET unlocked_at=NOW() WHERE user_id=$1`,[userId]);return{payload:row.secret_payload};}

export async function markHomeScreen(userId:number,kind:'prompted'|'added'){await pool.query(`UPDATE player_profiles SET ${kind==='added'?'home_screen_added_at':'install_prompted_at'}=NOW() WHERE user_id=$1`,[userId]);return{ok:true};}
export async function emojiStatuses(userId:number){const r=await pool.query(`SELECT * FROM emoji_status_catalog WHERE active=TRUE ORDER BY key`);const profile=await pool.query(`SELECT emoji_status_access FROM player_profiles WHERE user_id=$1`,[userId]);return{items:r.rows,access:Boolean(profile.rows[0]?.emoji_status_access)};}
export async function markEmojiAccess(userId:number,allowed:boolean){await pool.query(`UPDATE player_profiles SET emoji_status_access=$2 WHERE user_id=$1`,[userId,allowed]);return{ok:true};}

export async function currentAnomaly(userId:number){let r=await pool.query(`SELECT * FROM interface_anomalies WHERE user_id=$1 AND starts_at<=NOW() AND ends_at>NOW() AND acknowledged_at IS NULL ORDER BY starts_at DESC LIMIT 1`,[userId]);if(!r.rows[0]&&Math.random()<.08){const types=['mislabel','shift_button','wrong_clock','ghost_inventory','false_neighbor'];const id=crypto.randomUUID(),type=types[crypto.randomInt(types.length)]!;await pool.query(`INSERT INTO interface_anomalies(id,user_id,anomaly_type,payload,ends_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '12 minutes')`,[id,userId,type,JSON.stringify({seed:crypto.randomInt(99999),safe:true})]);r=await pool.query(`SELECT * FROM interface_anomalies WHERE id=$1`,[id]);}return r.rows[0]??null;}
export async function acknowledgeAnomaly(userId:number,id:string){await pool.query(`UPDATE interface_anomalies SET acknowledged_at=NOW() WHERE id=$1 AND user_id=$2`,[id,userId]);return{ok:true};}

export async function saveVoiceClip(userId:number,body:{phraseKey:string;mimeType:string;audioBase64:string;durationMs:number}){if(!PHRASES.has(body.phraseKey))throw new AppError('Фраза не разрешена',400);if(!/^audio\/(webm|ogg|mp4|mpeg)/.test(body.mimeType))throw new AppError('Формат записи не поддерживается',400);const audio=Buffer.from(body.audioBase64,'base64');if(audio.length<100||audio.length>450_000)throw new AppError('Запись должна быть короткой',413);if(body.durationMs<300||body.durationMs>4000)throw new AppError('Допустимо от 0.3 до 4 секунд',400);const id=crypto.randomUUID();await pool.query(`INSERT INTO neighbor_voice_clips(id,user_id,phrase_key,mime_type,audio,duration_ms) VALUES($1,$2,$3,$4,$5,$6)`,[id,userId,body.phraseKey,body.mimeType,audio,body.durationMs]);return{id,status:'pending'};}
export async function voiceLibrary(userId:number){const own=await pool.query(`SELECT id,phrase_key,mime_type,duration_ms,status,created_at FROM neighbor_voice_clips WHERE user_id=$1 AND status<>'deleted' ORDER BY created_at DESC`,[userId]);const neighbor=await pool.query(`SELECT v.id,v.phrase_key,v.mime_type,v.duration_ms,u.first_name FROM neighbor_voice_clips v JOIN users u ON u.id=v.user_id WHERE v.status='approved' AND v.user_id<>$1 AND (EXISTS(SELECT 1 FROM building_members a JOIN building_members b ON a.building_id=b.building_id WHERE a.user_id=$1 AND b.user_id=v.user_id) OR EXISTS(SELECT 1 FROM player_relationships r WHERE r.user_id=$1 AND r.other_user_id=v.user_id)) ORDER BY random() LIMIT 1`,[userId]);return{own:own.rows,neighbor:neighbor.rows[0]??null};}
export async function voiceClip(id:string,userId:number){const r=await pool.query(`SELECT mime_type,audio FROM neighbor_voice_clips WHERE id=$1 AND (status='approved' OR user_id=$2)`,[id,userId]);if(!r.rows[0])throw new AppError('Запись недоступна',404);return r.rows[0];}
export async function deleteVoiceClip(userId:number,id:string){await pool.query(`UPDATE neighbor_voice_clips SET status='deleted',audio='\\x'::bytea WHERE id=$1 AND user_id=$2`,[id,userId]);return{ok:true};}

export async function createUserRoom(userId:number,body:any){const components=Array.isArray(body.components)?body.components.filter((x:string)=>ROOM_COMPONENTS.has(x)).slice(0,8):[];if(components.length<2)throw new AppError('Добавьте минимум два объекта',400);if(!ROOM_SOUNDS.has(body.sound))throw new AppError('Этот звук недоступен',400);const choices=Array.isArray(body.choices)?body.choices.slice(0,3):[];if(choices.length<2)throw new AppError('Нужно два варианта решения',400);const id=crypto.randomUUID(),slug=`resident-${userId}-${token(5).toLowerCase()}`;const template={layout:body.layout||'corridor',components,sound:body.sound,light:body.light||'flicker',puzzle:body.puzzle||'sequence',choices};await pool.query(`INSERT INTO user_rooms(id,author_id,slug,title,template) VALUES($1,$2,$3,$4,$5)`,[id,userId,slug,String(body.title).slice(0,80),JSON.stringify(template)]);return{id,slug};}
export async function submitUserRoom(userId:number,id:string){const r=await pool.query(`UPDATE user_rooms SET status='review',updated_at=NOW() WHERE id=$1 AND author_id=$2 AND status IN ('draft','rejected') RETURNING id`,[id,userId]);if(!r.rowCount)throw new AppError('Комната не найдена',404);return{ok:true};}
export async function userRooms(userId:number){const r=await pool.query(`SELECT r.*,u.first_name author_name,CASE WHEN r.author_id=$1 THEN TRUE ELSE FALSE END own FROM user_rooms r JOIN users u ON u.id=r.author_id WHERE r.author_id=$1 OR r.status='published' ORDER BY r.published_at DESC NULLS LAST,r.created_at DESC LIMIT 100`,[userId]);return r.rows;}
export async function playUserRoom(userId:number,id:string){const r=await pool.query(`UPDATE user_rooms SET plays=plays+1 WHERE id=$1 AND status='published' RETURNING *`,[id]);if(!r.rows[0])throw new AppError('Комната недоступна',404);await recordRoomTrace(userId,`user:${id}`,'silhouette',{action:'visited'});return r.rows[0];}
export async function reviewUserRoom(userId:number,id:string,liked:boolean){await pool.query(`INSERT INTO user_room_reviews(room_id,user_id,liked) VALUES($1,$2,$3) ON CONFLICT(room_id,user_id) DO UPDATE SET liked=$3`,[id,userId,liked]);await pool.query(`UPDATE user_rooms SET likes=(SELECT COUNT(*) FROM user_room_reviews WHERE room_id=$1 AND liked=TRUE) WHERE id=$1`,[id]);return{ok:true};}

export async function seasonArchive(userId:number){const seasons=await pool.query(`SELECT s.*,COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'date',e.entry_date,'type',e.entry_type,'title',e.title,'body',e.body,'media',e.media,'communityResult',e.community_result,'personal',m.personal_state) ORDER BY e.sort_order) FILTER(WHERE e.id IS NOT NULL),'[]'::jsonb) entries FROM seasons s LEFT JOIN season_archive_entries e ON e.season_id=s.id AND e.published=TRUE LEFT JOIN player_archive_memories m ON m.entry_id=e.id AND m.user_id=$1 GROUP BY s.id ORDER BY s.starts_at DESC NULLS LAST`,[userId]);return seasons.rows;}
export async function rememberArchive(userId:number,entryId:string,state:Record<string,unknown>){await pool.query(`INSERT INTO player_archive_memories(entry_id,user_id,personal_state) VALUES($1,$2,$3) ON CONFLICT(entry_id,user_id) DO UPDATE SET personal_state=player_archive_memories.personal_state||$3`,[entryId,userId,JSON.stringify(state)]);return{ok:true};}

export async function paymentSupport(userId:number,purchaseId:string|undefined,body:string){if(purchaseId){const own=await pool.query(`SELECT 1 FROM purchases WHERE id=$1 AND user_id=$2`,[purchaseId,userId]);if(!own.rowCount)throw new AppError('Покупка не найдена',404);}const id=crypto.randomUUID();await pool.query(`INSERT INTO payment_support_requests(id,user_id,purchase_id,body) VALUES($1,$2,$3,$4)`,[id,userId,purchaseId??null,body]);return{id};}
export async function paymentRecoveryState(userId:number){const r=await pool.query(`SELECT p.id,p.sku,p.stars,p.status,p.created_at,p.fulfilled_at,p.telegram_charge_id,pf.created_at fulfillment_created,pf.revoked_at FROM purchases p LEFT JOIN purchase_fulfillments pf ON pf.purchase_id=p.id WHERE p.user_id=$1 ORDER BY p.created_at DESC`,[userId]);return r.rows;}

export async function premiumContent(userId:number){
  const rows=await pool.query(`SELECT c.content_key,c.content_type,c.title,c.metadata,c.active,
    CASE
      WHEN c.content_type='story_chapter' THEN EXISTS(SELECT 1 FROM entitlements e WHERE e.user_id=$1 AND e.entitlement_key='chapter:'||regexp_replace(c.content_key,'^chapter-',''))
      WHEN c.content_type='coop_case' THEN EXISTS(SELECT 1 FROM entitlements e WHERE e.user_id=$1 AND e.entitlement_key='coop:'||regexp_replace(c.content_key,'^coop-',''))
      WHEN c.content_type='interior' THEN EXISTS(SELECT 1 FROM entitlements e WHERE e.user_id=$1 AND e.entitlement_key='interior:'||regexp_replace(c.content_key,'^interior-','')) OR EXISTS(SELECT 1 FROM player_profiles pp WHERE pp.user_id=$1 AND pp.apartment_style=regexp_replace(c.content_key,'^interior-',''))
      ELSE FALSE
    END owned,
    p.current_node_id,p.completed_at
    FROM content_inventory c LEFT JOIN content_playthroughs p ON p.user_id=$1 AND p.slug=regexp_replace(c.content_key,'^chapter-','')
    WHERE c.active=TRUE AND c.content_type IN ('coop_case','story_chapter','interior')
    ORDER BY CASE c.content_type WHEN 'story_chapter' THEN 0 WHEN 'coop_case' THEN 1 ELSE 2 END,c.title`,[userId]);
  return rows.rows;
}
export async function applyPremiumInterior(userId:number,contentKey:string){
  const row=(await pool.query(`SELECT content_key,title FROM content_inventory WHERE content_key=$1 AND content_type='interior' AND active=TRUE`,[contentKey])).rows[0];
  if(!row)throw new AppError('Интерьер не найден',404,'INTERIOR_NOT_FOUND');
  const style=String(row.content_key).replace(/^interior-/,'');
  const owned=await pool.query(`SELECT 1 FROM entitlements WHERE user_id=$1 AND entitlement_key=$2`,[userId,`interior:${style}`]);
  if(!owned.rowCount)throw new AppError('Сначала приобретите этот интерьер',403,'INTERIOR_ENTITLEMENT_REQUIRED');
  await pool.query(`UPDATE player_profiles SET apartment_style=$2 WHERE user_id=$1`,[userId,style]);
  await pool.query(`INSERT INTO analytics_events(user_id,event_name,properties) VALUES($1,'interior_applied',$2)`,[userId,JSON.stringify({contentKey,style})]);
  return{ok:true,contentKey,style,title:row.title};
}
export async function advancePremiumContent(userId:number,slug:string,fromNodeId:string,toNodeId:string){
  return withTransaction(async client=>{
    const doc=await client.query(`SELECT d.id,v.graph FROM content_documents d JOIN content_versions v ON v.document_id=d.id AND v.version=d.published_version WHERE d.slug=$1 AND d.status='published'`,[slug]);
    const graph=doc.rows[0]?.graph;if(!graph)throw new AppError('Сюжетная глава не опубликована',404,'CONTENT_NOT_FOUND');
    const entitlement=await client.query(`SELECT 1 FROM entitlements WHERE user_id=$1 AND entitlement_key=$2`,[userId,`chapter:${slug}`]);
    if(!entitlement.rowCount)throw new AppError('Для главы нужен сюжетный билет',403,'CONTENT_ENTITLEMENT_REQUIRED');
    const current=await client.query(`SELECT current_node_id,completed_at FROM content_playthroughs WHERE user_id=$1 AND slug=$2 FOR UPDATE`,[userId,slug]);
    const expected=current.rows[0]?.current_node_id??graph.startNodeId;
    if(expected!==fromNodeId)throw new AppError('Глава уже открыта на другой сцене',409,'CONTENT_PROGRESS_CONFLICT');
    const edge=(graph.edges||[]).find((e:any)=>e.from===fromNodeId&&e.to===toNodeId);
    if(!edge)throw new AppError('Этот переход отсутствует в опубликованной версии',422,'CONTENT_EDGE_INVALID');
    const target=(graph.nodes||[]).find((n:any)=>n.id===toNodeId);
    if(!target)throw new AppError('Сцена не найдена',404,'CONTENT_NODE_NOT_FOUND');
    const completed=target.type==='ending';
    await client.query(`INSERT INTO content_playthroughs(user_id,slug,current_node_id,choices,completed_at) VALUES($1,$2,$3,$4,CASE WHEN $5 THEN NOW() ELSE NULL END)
      ON CONFLICT(user_id,slug) DO UPDATE SET current_node_id=$3,choices=content_playthroughs.choices||$4,completed_at=CASE WHEN $5 THEN COALESCE(content_playthroughs.completed_at,NOW()) ELSE content_playthroughs.completed_at END,updated_at=NOW()`,[userId,slug,toNodeId,JSON.stringify([{from:fromNodeId,to:toNodeId,label:edge.label,at:new Date().toISOString()}]),completed]);
    if(completed&&!current.rows[0]?.completed_at){const itemId=slug==='manager-ledger'?'manager_stamp':'brass_number';await changeInventory(client,userId,itemId,1,'chapter_complete',`chapter:${slug}:${userId}`,{slug});await client.query(`UPDATE player_profiles SET clues=clues+2 WHERE user_id=$1`,[userId]);}
    return{currentNodeId:toNodeId,completed,reward:completed?{clues:2,itemId:slug==='manager-ledger'?'manager_stamp':'brass_number'}:null};
  });
}
export async function v4Snapshot(userId:number){const [traces,rels,cases,antagonist,night,motionSafe,statuses,anomaly,voices,rooms,archive,payments,premium]=await Promise.all([
  pool.query(`SELECT id,room_id,trace_type,payload,created_at FROM room_traces WHERE expires_at>NOW() ORDER BY created_at DESC LIMIT 12`),relationships(userId),chatCases(userId),antagonistState(userId),activeLiveNight(userId),biometricState(userId),emojiStatuses(userId),currentAnomaly(userId),voiceLibrary(userId),userRooms(userId),seasonArchive(userId),paymentRecoveryState(userId),premiumContent(userId)
]);return{traces:traces.rows,relationships:rels,chatCases:cases,antagonist,liveNight:night,biometricSafe:motionSafe,emojiStatuses:statuses,anomaly,voices,userRooms:rooms,seasonArchive:archive,payments,premium};}
