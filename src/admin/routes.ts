import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool, withTransaction } from '../db.js';
import { AppError } from '../errors.js';
import { ITEM_CATALOG } from '../game/catalog.js';
import { grantConfigSchema, applyGrantConfig } from '../shop-service.js';
import { getAllSettings, setSetting } from '../settings.js';
import { getBotStarBalance, getBotStarTransactions, refundPurchase, sendBotMessage } from '../telegram.js';
import { authenticateAdmin, hashPassword, issueAdminToken, verifyPassword } from './auth.js';
import { writeAudit } from './audit.js';
import { hasPermission, PERMISSIONS, type AdminPrincipal, type AdminRole, type Permission } from './rbac.js';

const pageSchema=z.coerce.number().int().min(1).default(1);
const limitSchema=z.coerce.number().int().min(1).max(100).default(25);
const idSchema=z.object({id:z.string().uuid()});
const userIdSchema=z.object({id:z.string().regex(/^\d+$/)});

function adminOf(request:FastifyRequest):AdminPrincipal{return (request as any).adminPrincipal;}
function requirePermission(request:FastifyRequest,permission:Permission):AdminPrincipal{
  const admin=adminOf(request);
  if(!hasPermission(admin,permission)) throw new AppError('Недостаточно прав',403,'ADMIN_PERMISSION_DENIED');
  return admin;
}
function paging(page:number,limit:number){return{limit,offset:(page-1)*limit};}
function totalPages(total:number,limit:number){return Math.max(1,Math.ceil(total/limit));}

const effectSchema=z.object({nerve:z.number().int().min(-100).max(100).optional(),danger:z.number().int().min(-100).max(100).optional(),noise:z.number().int().min(-100).max(100).optional(),clues:z.number().int().min(-100).max(100).optional(),keys:z.number().int().min(-100).max(100).optional(),item:z.string().max(80).optional(),itemQty:z.number().int().min(1).max(100).optional()});
const choiceSchema=z.object({label:z.string().trim().min(2).max(120),outcome:z.string().trim().min(2).max(500),effects:effectSchema,requires:z.string().max(80).optional().nullable().transform(v=>v||undefined)});
const roomSchema=z.object({id:z.string().trim().regex(/^[a-z0-9-]+$/).max(60),title:z.string().trim().min(2).max(120),description:z.string().trim().min(10).max(1000),ambience:z.string().trim().min(1).max(60),accent:z.string().regex(/^#[0-9a-fA-F]{6}$/),choices:z.array(choiceSchema).min(2).max(5),enabled:z.boolean().default(true),sortOrder:z.number().int().min(0).max(10000).default(0)});
const shopSchema=z.object({sku:z.string().trim().regex(/^[a-z0-9_\-]+$/).max(60),title:z.string().trim().min(2).max(120),description:z.string().trim().min(5).max(500),stars:z.number().int().min(1).max(100000),icon:z.string().min(1).max(12),active:z.boolean().default(true),sortOrder:z.number().int().min(0).max(10000).default(0),grantConfig:grantConfigSchema});

export async function adminRoutes(app:FastifyInstance):Promise<void>{
  app.addHook('preHandler',async request=>{
    if(request.url.startsWith('/admin/api/')&&!request.url.startsWith('/admin/api/auth/login')) (request as any).adminPrincipal=await authenticateAdmin(request);
  });

  app.post('/admin/api/auth/login',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async request=>{
    const body=z.object({username:z.string().min(1).max(64),password:z.string().min(1).max(256)}).parse(request.body);
    const found=await pool.query(`SELECT id,username,password_hash,role,permissions,active,session_version FROM admins WHERE lower(username)=lower($1)`,[body.username]);
    const row=found.rows[0];
    const valid=row?.active&&await verifyPassword(body.password,row.password_hash);
    if(!valid) throw new AppError('Неверный логин или пароль',401,'ADMIN_LOGIN_FAILED');
    await pool.query(`UPDATE admins SET last_login_at=NOW(),updated_at=NOW() WHERE id=$1`,[row.id]);
    return{token:issueAdminToken(row.id,Number(row.session_version)),admin:{id:row.id,username:row.username,role:row.role,permissions:row.permissions}};
  });

  app.get('/admin/api/auth/me',async request=>({admin:adminOf(request),permissions:PERMISSIONS}));

  app.get('/admin/api/dashboard',async request=>{
    requirePermission(request,'dashboard:read');
    const [totals,revenue,activity,recentPurchases,recentUsers,series]=await Promise.all([
      pool.query(`SELECT (SELECT COUNT(*) FROM users)::int users,(SELECT COUNT(*) FROM player_profiles WHERE last_seen>NOW()-INTERVAL '24 hours')::int dau,
        (SELECT COUNT(*) FROM expeditions WHERE status='active')::int active_expeditions,
        (SELECT COUNT(*) FROM user_moderation WHERE banned=TRUE AND (banned_until IS NULL OR banned_until>NOW()))::int banned,
        (SELECT COUNT(*) FROM neighbor_notes)::int notes,(SELECT COUNT(*) FROM referral_rewards)::int referrals`),
      pool.query(`SELECT COALESCE(SUM(stars) FILTER(WHERE status='paid'),0)::int paid_stars,COUNT(*) FILTER(WHERE status='paid')::int paid_count,
        COUNT(*) FILTER(WHERE status='pending')::int pending_count,COUNT(*) FILTER(WHERE status='refunded')::int refunded_count FROM purchases`),
      pool.query(`SELECT COUNT(*) FILTER(WHERE status='escaped')::int escaped,COUNT(*) FILTER(WHERE status='lost')::int lost,
        COUNT(*) FILTER(WHERE started_at>NOW()-INTERVAL '24 hours')::int expeditions_today FROM expeditions`),
      pool.query(`SELECT p.id,p.user_id::text,u.first_name,u.username,p.sku,p.stars,p.status,p.created_at FROM purchases p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 8`),
      pool.query(`SELECT u.id::text,u.first_name,u.username,u.created_at,p.last_seen,p.apartment_no FROM users u JOIN player_profiles p ON p.user_id=u.id ORDER BY u.created_at DESC LIMIT 8`),
      pool.query(`WITH days AS (SELECT generate_series(CURRENT_DATE-13,CURRENT_DATE,'1 day')::date AS metric_date)
        SELECT d.metric_date AS day,COALESCE(u.signups,0)::int signups,COALESCE(p.stars,0)::int stars,COALESCE(e.runs,0)::int runs FROM days d
        LEFT JOIN (SELECT created_at::date AS metric_date,COUNT(*) signups FROM users WHERE created_at>=CURRENT_DATE-13 GROUP BY 1)u USING(metric_date)
        LEFT JOIN (SELECT created_at::date AS metric_date,SUM(stars) stars FROM purchases WHERE status='paid' AND created_at>=CURRENT_DATE-13 GROUP BY 1)p USING(metric_date)
        LEFT JOIN (SELECT started_at::date AS metric_date,COUNT(*) runs FROM expeditions WHERE started_at>=CURRENT_DATE-13 GROUP BY 1)e USING(metric_date) ORDER BY d.metric_date`)
    ]);
    return{...totals.rows[0],...revenue.rows[0],...activity.rows[0],recentPurchases:recentPurchases.rows,recentUsers:recentUsers.rows,series:series.rows};
  });

  app.get('/admin/api/users',async request=>{
    requirePermission(request,'users:read');
    const query=z.object({page:pageSchema,limit:limitSchema,search:z.string().trim().max(100).default(''),status:z.enum(['all','active','banned','club','new']).default('all'),sort:z.enum(['recent','last_seen','stars','trust','clues']).default('recent')}).parse(request.query);
    const {limit,offset}=paging(query.page,query.limit);const where:string[]=['1=1'];const params:any[]=[];
    if(query.search){params.push(`%${query.search}%`);where.push(`(u.id::text ILIKE $${params.length} OR u.username ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR COALESCE(u.last_name,'') ILIKE $${params.length})`);}
    if(query.status==='active')where.push(`p.last_seen>NOW()-INTERVAL '7 days'`);
    if(query.status==='banned')where.push(`m.banned=TRUE AND (m.banned_until IS NULL OR m.banned_until>NOW())`);
    if(query.status==='club')where.push(`p.club_until>NOW()`);
    if(query.status==='new')where.push(`u.created_at>NOW()-INTERVAL '7 days'`);
    const order={recent:'u.created_at DESC',last_seen:'p.last_seen DESC',stars:'p.stars_spent DESC',trust:'p.trust DESC',clues:'p.clues DESC'}[query.sort];
    const count=await pool.query(`SELECT COUNT(*)::int total FROM users u JOIN player_profiles p ON p.user_id=u.id LEFT JOIN user_moderation m ON m.user_id=u.id WHERE ${where.join(' AND ')}`,params);
    params.push(limit,offset);
    const rows=await pool.query(`SELECT u.id::text,u.username,u.first_name,u.last_name,u.photo_url,u.created_at,p.apartment_no,p.trust,p.clues,p.keys_count,p.stars_spent,p.club_until,p.last_seen,
      COALESCE(m.banned,FALSE) banned,m.reason ban_reason,m.banned_until,(SELECT COUNT(*) FROM referral_rewards r WHERE r.inviter_id=u.id)::int referrals
      FROM users u JOIN player_profiles p ON p.user_id=u.id LEFT JOIN user_moderation m ON m.user_id=u.id WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${params.length-1} OFFSET $${params.length}`,params);
    const total=Number(count.rows[0].total);return{items:rows.rows,page:query.page,limit:query.limit,total,totalPages:totalPages(total,query.limit)};
  });

  app.get('/admin/api/users/:id',async request=>{
    requirePermission(request,'users:read');const{id}=userIdSchema.parse(request.params);
    const [profile,inventory,apartment,entitlements,purchases,expeditions,notes,referrals]=await Promise.all([
      pool.query(`SELECT u.id::text,u.username,u.first_name,u.last_name,u.photo_url,u.language_code,u.referral_code,u.referred_by::text,u.created_at,u.updated_at,p.*,
        COALESCE(m.banned,FALSE)banned,m.reason ban_reason,m.banned_until FROM users u JOIN player_profiles p ON p.user_id=u.id LEFT JOIN user_moderation m ON m.user_id=u.id WHERE u.id=$1`,[id]),
      pool.query(`SELECT item_id,quantity,metadata FROM inventory WHERE user_id=$1 ORDER BY item_id`,[id]),
      pool.query(`SELECT id,item_id,slot,rotation,placed_at FROM apartment_items WHERE user_id=$1 ORDER BY slot`,[id]),
      pool.query(`SELECT entitlement_key,value,granted_at FROM entitlements WHERE user_id=$1 ORDER BY entitlement_key`,[id]),
      pool.query(`SELECT id,sku,stars,status,telegram_charge_id,created_at,fulfilled_at FROM purchases WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,[id]),
      pool.query(`SELECT id,status,room_index,state,started_at,completed_at FROM expeditions WHERE user_id=$1 ORDER BY started_at DESC LIMIT 30`,[id]),
      pool.query(`SELECT n.id,n.body,n.mood,n.created_at,n.author_id::text,a.first_name author_name FROM neighbor_notes n JOIN users a ON a.id=n.author_id WHERE n.target_id=$1 ORDER BY n.created_at DESC LIMIT 30`,[id]),
      pool.query(`SELECT r.invited_id::text,u.first_name,u.username,r.rewarded_at FROM referral_rewards r JOIN users u ON u.id=r.invited_id WHERE r.inviter_id=$1 ORDER BY r.rewarded_at DESC LIMIT 50`,[id])
    ]);
    if(!profile.rows[0])throw new AppError('Игрок не найден',404,'USER_NOT_FOUND');
    return{profile:profile.rows[0],inventory:inventory.rows.map(x=>({...x,catalog:ITEM_CATALOG[x.item_id]??null})),apartment:apartment.rows,entitlements:entitlements.rows,purchases:purchases.rows,expeditions:expeditions.rows,notes:notes.rows,referrals:referrals.rows};
  });

  app.patch('/admin/api/users/:id/profile',async request=>{
    const admin=requirePermission(request,'users:write');const{id}=userIdSchema.parse(request.params);
    const body=z.object({firstName:z.string().trim().min(1).max(64).optional(),lastName:z.string().trim().max(64).nullable().optional(),username:z.string().trim().max(64).nullable().optional(),apartmentNo:z.number().int().min(1).max(99999).optional(),apartmentStyle:z.string().min(1).max(60).optional(),nerve:z.number().int().min(0).max(100).optional(),trust:z.number().int().min(0).max(1000000).optional(),clues:z.number().int().min(0).max(1000000).optional(),keys:z.number().int().min(0).max(1000000).optional(),chapter:z.number().int().min(1).max(10000).optional(),clubUntil:z.string().datetime().nullable().optional(),introSeen:z.boolean().optional()}).parse(request.body);
    await withTransaction(async client=>{
      await client.query(`UPDATE users SET first_name=COALESCE($2,first_name),last_name=CASE WHEN $3::boolean THEN $4 ELSE last_name END,username=CASE WHEN $5::boolean THEN $6 ELSE username END,updated_at=NOW() WHERE id=$1`,[id,body.firstName??null,body.lastName!==undefined,body.lastName??null,body.username!==undefined,body.username??null]);
      await client.query(`UPDATE player_profiles SET apartment_no=COALESCE($2,apartment_no),apartment_style=COALESCE($3,apartment_style),nerve=COALESCE($4,nerve),trust=COALESCE($5,trust),clues=COALESCE($6,clues),keys_count=COALESCE($7,keys_count),chapter=COALESCE($8,chapter),club_until=CASE WHEN $9::boolean THEN $10::timestamptz ELSE club_until END,intro_seen=COALESCE($11,intro_seen) WHERE user_id=$1`,[id,body.apartmentNo??null,body.apartmentStyle??null,body.nerve??null,body.trust??null,body.clues??null,body.keys??null,body.chapter??null,body.clubUntil!==undefined,body.clubUntil??null,body.introSeen??null]);
    });
    await writeAudit(admin,'user.profile.update','user',id,body,request);return{ok:true};
  });

  app.post('/admin/api/users/:id/inventory',async request=>{
    const admin=requirePermission(request,'users:write');const{id}=userIdSchema.parse(request.params);
    const body=z.object({itemId:z.string().trim().min(1).max(80),delta:z.number().int().min(-100000).max(100000)}).parse(request.body);
    await pool.query(`INSERT INTO inventory(user_id,item_id,quantity) VALUES($1,$2,GREATEST(0,$3)) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=GREATEST(0,inventory.quantity+$3)`,[id,body.itemId,body.delta]);
    await pool.query(`DELETE FROM inventory WHERE user_id=$1 AND item_id=$2 AND quantity=0`,[id,body.itemId]);
    await writeAudit(admin,'user.inventory.adjust','user',id,body,request);return{ok:true};
  });

  app.post('/admin/api/users/:id/entitlements',async request=>{
    const admin=requirePermission(request,'users:write');const{id}=userIdSchema.parse(request.params);
    const body=z.object({key:z.string().trim().min(1).max(100),value:z.unknown().default({}),action:z.enum(['grant','revoke'])}).parse(request.body);
    if(body.action==='grant')await pool.query(`INSERT INTO entitlements(user_id,entitlement_key,value) VALUES($1,$2,$3) ON CONFLICT(user_id,entitlement_key) DO UPDATE SET value=EXCLUDED.value,granted_at=NOW()`,[id,body.key,JSON.stringify(body.value)]);
    else await pool.query(`DELETE FROM entitlements WHERE user_id=$1 AND entitlement_key=$2`,[id,body.key]);
    await writeAudit(admin,`user.entitlement.${body.action}`,'user',id,body,request);return{ok:true};
  });

  app.post('/admin/api/users/:id/grant-product',async request=>{
    const admin=requirePermission(request,'users:write');const{id}=userIdSchema.parse(request.params);
    const body=z.object({sku:z.string().min(1).max(60)}).parse(request.body);
    const product=await pool.query(`SELECT grant_config FROM shop_products WHERE sku=$1`,[body.sku]);if(!product.rows[0])throw new AppError('Товар не найден',404);
    await withTransaction(client=>applyGrantConfig(client,id,product.rows[0].grant_config));
    await writeAudit(admin,'user.product.grant','user',id,body,request);return{ok:true};
  });

  app.post('/admin/api/users/:id/moderation',async request=>{
    const admin=requirePermission(request,'users:moderate');const{id}=userIdSchema.parse(request.params);
    const body=z.object({banned:z.boolean(),reason:z.string().trim().max(500).nullable().default(null),bannedUntil:z.string().datetime().nullable().default(null)}).parse(request.body);
    await pool.query(`INSERT INTO user_moderation(user_id,banned,reason,banned_until,banned_by,updated_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(user_id) DO UPDATE SET banned=EXCLUDED.banned,reason=EXCLUDED.reason,banned_until=EXCLUDED.banned_until,banned_by=EXCLUDED.banned_by,updated_at=NOW()`,[id,body.banned,body.reason,body.bannedUntil,admin.id]);
    await writeAudit(admin,body.banned?'user.ban':'user.unban','user',id,body,request);return{ok:true};
  });

  app.post('/admin/api/users/:id/reset',async request=>{
    const admin=requirePermission(request,'users:write');const{id}=userIdSchema.parse(request.params);
    const body=z.object({preservePurchases:z.boolean().default(true)}).parse(request.body??{});
    await withTransaction(async client=>{
      await client.query(`DELETE FROM apartment_items WHERE user_id=$1`,[id]);await client.query(`DELETE FROM inventory WHERE user_id=$1`,[id]);await client.query(`DELETE FROM expeditions WHERE user_id=$1`,[id]);await client.query(`DELETE FROM neighbor_notes WHERE author_id=$1 OR target_id=$1`,[id]);
      await client.query(`UPDATE player_profiles SET apartment_style='tenant',nerve=100,trust=0,clues=0,keys_count=1,chapter=1,intro_seen=FALSE,club_until=NULL WHERE user_id=$1`,[id]);
      if(!body.preservePurchases){await client.query(`DELETE FROM entitlements WHERE user_id=$1`,[id]);await client.query(`DELETE FROM purchases WHERE user_id=$1`,[id]);await client.query(`UPDATE player_profiles SET stars_spent=0 WHERE user_id=$1`,[id]);}
    });
    await writeAudit(admin,'user.progress.reset','user',id,body,request);return{ok:true};
  });

  app.post('/admin/api/users/:id/message',async request=>{
    const admin=requirePermission(request,'users:write');const{id}=userIdSchema.parse(request.params);
    const body=z.object({text:z.string().trim().min(1).max(4000),buttonText:z.string().trim().max(64).nullable().default(null),buttonUrl:z.string().url().nullable().default(null)}).parse(request.body);
    await sendBotMessage(id,body.text,body.buttonText,body.buttonUrl);await writeAudit(admin,'user.message.send','user',id,{...body,text:`${body.text.slice(0,120)}${body.text.length>120?'…':''}`},request);return{ok:true};
  });

  app.delete('/admin/api/users/:id',async request=>{
    const admin=requirePermission(request,'users:delete');const{id}=userIdSchema.parse(request.params);await pool.query(`DELETE FROM users WHERE id=$1`,[id]);await writeAudit(admin,'user.delete','user',id,{},request);return{ok:true};
  });

  app.get('/admin/api/purchases',async request=>{
    requirePermission(request,'purchases:read');const query=z.object({page:pageSchema,limit:limitSchema,status:z.enum(['all','pending','paid','cancelled','refunded']).default('all'),search:z.string().trim().max(100).default('')}).parse(request.query);const{limit,offset}=paging(query.page,query.limit);const where=['1=1'];const params:any[]=[];
    if(query.status!=='all'){params.push(query.status);where.push(`p.status=$${params.length}`);}if(query.search){params.push(`%${query.search}%`);where.push(`(p.id::text ILIKE $${params.length} OR p.user_id::text ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR u.username ILIKE $${params.length})`);}
    const count=await pool.query(`SELECT COUNT(*)::int total FROM purchases p JOIN users u ON u.id=p.user_id WHERE ${where.join(' AND ')}`,params);params.push(limit,offset);
    const rows=await pool.query(`SELECT p.*,p.user_id::text,u.first_name,u.username FROM purchases p JOIN users u ON u.id=p.user_id WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params);const total=Number(count.rows[0].total);return{items:rows.rows,page:query.page,total,totalPages:totalPages(total,query.limit)};
  });

  app.post('/admin/api/purchases/:id/refund',async request=>{const admin=requirePermission(request,'purchases:write');const{id}=idSchema.parse(request.params);await refundPurchase(id);await writeAudit(admin,'purchase.refund','purchase',id,{},request);return{ok:true};});
  app.post('/admin/api/purchases/:id/cancel',async request=>{const admin=requirePermission(request,'purchases:write');const{id}=idSchema.parse(request.params);const result=await pool.query(`UPDATE purchases SET status='cancelled' WHERE id=$1 AND status='pending' RETURNING id`,[id]);if(!result.rowCount)throw new AppError('Отменить можно только ожидающий счёт',409,'PURCHASE_NOT_CANCELLABLE');await writeAudit(admin,'purchase.cancel','purchase',id,{},request);return{ok:true};});
  app.get('/admin/api/stars/balance',async request=>{requirePermission(request,'purchases:read');return{balance:await getBotStarBalance()};});
  app.get('/admin/api/stars/transactions',async request=>{requirePermission(request,'purchases:read');const q=z.object({offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(request.query);return{transactions:await getBotStarTransactions(q.offset,q.limit)};});

  app.get('/admin/api/events',async request=>{requirePermission(request,'content:read');return{items:(await pool.query(`SELECT * FROM building_events ORDER BY active_from DESC`)).rows};});
  app.post('/admin/api/events',async request=>{const admin=requirePermission(request,'content:write');const body=z.object({eventKey:z.string().trim().regex(/^[a-z0-9_-]+$/).max(80),title:z.string().trim().min(2).max(160),body:z.string().trim().min(2).max(1000),severity:z.enum(['info','warning','danger','critical']),activeFrom:z.string().datetime(),activeUntil:z.string().datetime()}).parse(request.body);if(new Date(body.activeUntil)<=new Date(body.activeFrom))throw new AppError('Дата окончания должна быть позже начала',400,'INVALID_EVENT_DATES');await pool.query(`INSERT INTO building_events(event_key,title,body,severity,active_from,active_until) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_key) DO UPDATE SET title=EXCLUDED.title,body=EXCLUDED.body,severity=EXCLUDED.severity,active_from=EXCLUDED.active_from,active_until=EXCLUDED.active_until`,[body.eventKey,body.title,body.body,body.severity,body.activeFrom,body.activeUntil]);await writeAudit(admin,'event.upsert','event',body.eventKey,body,request);return{ok:true};});
  app.delete('/admin/api/events/:key',async request=>{const admin=requirePermission(request,'content:write');const{key}=z.object({key:z.string().max(80)}).parse(request.params);await pool.query(`DELETE FROM building_events WHERE event_key=$1`,[key]);await writeAudit(admin,'event.delete','event',key,{},request);return{ok:true};});

  app.get('/admin/api/rooms',async request=>{requirePermission(request,'content:read');return{items:(await pool.query(`SELECT id,title,description,ambience,accent,choices,enabled,sort_order,updated_at FROM game_rooms ORDER BY sort_order,id`)).rows};});
  app.post('/admin/api/rooms',async request=>{const admin=requirePermission(request,'content:write');const body=roomSchema.parse(request.body);await pool.query(`INSERT INTO game_rooms(id,title,description,ambience,accent,choices,enabled,sort_order,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,ambience=EXCLUDED.ambience,accent=EXCLUDED.accent,choices=EXCLUDED.choices,enabled=EXCLUDED.enabled,sort_order=EXCLUDED.sort_order,updated_at=NOW()`,[body.id,body.title,body.description,body.ambience,body.accent,JSON.stringify(body.choices),body.enabled,body.sortOrder]);await writeAudit(admin,'room.upsert','room',body.id,body,request);return{ok:true};});
  app.delete('/admin/api/rooms/:key',async request=>{const admin=requirePermission(request,'content:write');const{key}=z.object({key:z.string().max(60)}).parse(request.params);const count=await pool.query(`SELECT COUNT(*)::int total FROM game_rooms WHERE enabled=TRUE`);if(Number(count.rows[0].total)<=1)throw new AppError('Нельзя удалить последнюю активную комнату',409,'LAST_ACTIVE_ROOM');await pool.query(`DELETE FROM game_rooms WHERE id=$1`,[key]);await writeAudit(admin,'room.delete','room',key,{},request);return{ok:true};});

  app.get('/admin/api/shop',async request=>{requirePermission(request,'content:read');return{items:(await pool.query(`SELECT sku,title,description,stars,icon,active,grant_config,sort_order,updated_at FROM shop_products ORDER BY sort_order,sku`)).rows};});
  app.post('/admin/api/shop',async request=>{const admin=requirePermission(request,'content:write');const body=shopSchema.parse(request.body);await pool.query(`INSERT INTO shop_products(sku,title,description,stars,icon,active,grant_config,sort_order,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT(sku) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,stars=EXCLUDED.stars,icon=EXCLUDED.icon,active=EXCLUDED.active,grant_config=EXCLUDED.grant_config,sort_order=EXCLUDED.sort_order,updated_at=NOW()`,[body.sku,body.title,body.description,body.stars,body.icon,body.active,JSON.stringify(body.grantConfig),body.sortOrder]);await writeAudit(admin,'shop.upsert','shop_product',body.sku,body,request);return{ok:true};});
  app.delete('/admin/api/shop/:key',async request=>{const admin=requirePermission(request,'content:write');const{key}=z.object({key:z.string().max(60)}).parse(request.params);await pool.query(`UPDATE shop_products SET active=FALSE,updated_at=NOW() WHERE sku=$1`,[key]);await writeAudit(admin,'shop.disable','shop_product',key,{},request);return{ok:true};});

  app.get('/admin/api/seasons',async request=>{requirePermission(request,'content:read');return{items:(await pool.query(`SELECT * FROM seasons ORDER BY created_at DESC`)).rows};});
  app.post('/admin/api/seasons',async request=>{const admin=requirePermission(request,'content:write');const body=z.object({id:z.string().uuid().optional(),slug:z.string().regex(/^[a-z0-9-]+$/).max(80),title:z.string().min(2).max(160),description:z.string().min(2).max(1500),status:z.enum(['draft','active','archived']),startsAt:z.string().datetime().nullable().default(null),endsAt:z.string().datetime().nullable().default(null),metadata:z.unknown().default({})}).parse(request.body);const id=body.id??crypto.randomUUID();if(body.status==='active')await pool.query(`UPDATE seasons SET status='archived',updated_at=NOW() WHERE status='active' AND id<>$1`,[id]);await pool.query(`INSERT INTO seasons(id,slug,title,description,status,starts_at,ends_at,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,description=EXCLUDED.description,status=EXCLUDED.status,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,metadata=EXCLUDED.metadata,updated_at=NOW()`,[id,body.slug,body.title,body.description,body.status,body.startsAt,body.endsAt,JSON.stringify(body.metadata)]);await writeAudit(admin,'season.upsert','season',id,body,request);return{ok:true,id};});
  app.delete('/admin/api/seasons/:id',async request=>{const admin=requirePermission(request,'content:write');const{id}=idSchema.parse(request.params);await pool.query(`DELETE FROM seasons WHERE id=$1`,[id]);await writeAudit(admin,'season.delete','season',id,{},request);return{ok:true};});

  app.get('/admin/api/broadcasts',async request=>{requirePermission(request,'broadcasts:read');return{items:(await pool.query(`SELECT b.*,a.username creator FROM broadcasts b LEFT JOIN admins a ON a.id=b.created_by ORDER BY b.created_at DESC LIMIT 100`)).rows};});
  app.post('/admin/api/broadcasts',async request=>{const admin=requirePermission(request,'broadcasts:write');const body=z.object({title:z.string().trim().min(2).max(160),body:z.string().trim().min(1).max(4000),buttonText:z.string().trim().max(64).nullable().default(null),buttonUrl:z.string().url().nullable().default(null),audience:z.object({lastSeenDays:z.number().int().min(1).max(3650).nullable().default(null),clubOnly:z.boolean().default(false),excludeBanned:z.boolean().default(true)}).default({})}).parse(request.body);const id=crypto.randomUUID();await pool.query(`INSERT INTO broadcasts(id,title,body,button_text,button_url,audience,status,created_by) VALUES($1,$2,$3,$4,$5,$6,'draft',$7)`,[id,body.title,body.body,body.buttonText,body.buttonUrl,JSON.stringify(body.audience),admin.id]);await writeAudit(admin,'broadcast.create','broadcast',id,body,request);return{ok:true,id};});
  app.post('/admin/api/broadcasts/:id/start',async request=>{const admin=requirePermission(request,'broadcasts:write');const{id}=idSchema.parse(request.params);await withTransaction(async client=>{const found=await client.query(`SELECT audience,status FROM broadcasts WHERE id=$1 FOR UPDATE`,[id]);const row=found.rows[0];if(!row||!['draft','paused'].includes(row.status))throw new AppError('Рассылку нельзя запустить в текущем состоянии',409,'BROADCAST_STATE_INVALID');if(row.status==='draft'){const audience=row.audience??{};const conditions=['1=1'];const params:any[]=[id];if(audience.lastSeenDays){params.push(audience.lastSeenDays);conditions.push(`p.last_seen>NOW()-($${params.length}::text||' days')::interval`);}if(audience.clubOnly)conditions.push(`p.club_until>NOW()`);if(audience.excludeBanned!==false)conditions.push(`NOT(COALESCE(m.banned,FALSE) AND (m.banned_until IS NULL OR m.banned_until>NOW()))`);await client.query(`INSERT INTO broadcast_deliveries(broadcast_id,user_id) SELECT $1,u.id FROM users u JOIN player_profiles p ON p.user_id=u.id LEFT JOIN user_moderation m ON m.user_id=u.id WHERE ${conditions.join(' AND ')} ON CONFLICT DO NOTHING`,params);await client.query(`UPDATE broadcasts SET total=(SELECT COUNT(*) FROM broadcast_deliveries WHERE broadcast_id=$1),status='queued',started_at=COALESCE(started_at,NOW()) WHERE id=$1`,[id]);}else await client.query(`UPDATE broadcasts SET status='queued' WHERE id=$1`,[id]);});await writeAudit(admin,'broadcast.start','broadcast',id,{},request);return{ok:true};});
  app.post('/admin/api/broadcasts/:id/pause',async request=>{const admin=requirePermission(request,'broadcasts:write');const{id}=idSchema.parse(request.params);await pool.query(`UPDATE broadcasts SET status='paused' WHERE id=$1 AND status IN ('queued','running')`,[id]);await writeAudit(admin,'broadcast.pause','broadcast',id,{},request);return{ok:true};});
  app.post('/admin/api/broadcasts/:id/cancel',async request=>{const admin=requirePermission(request,'broadcasts:write');const{id}=idSchema.parse(request.params);await pool.query(`UPDATE broadcasts SET status='cancelled',completed_at=NOW() WHERE id=$1 AND status NOT IN ('completed','cancelled')`,[id]);await writeAudit(admin,'broadcast.cancel','broadcast',id,{},request);return{ok:true};});

  app.get('/admin/api/operations/expeditions',async request=>{requirePermission(request,'operations:read');const q=z.object({status:z.enum(['all','active','escaped','lost','cancelled']).default('all'),limit:z.coerce.number().int().min(1).max(200).default(50)}).parse(request.query);const rows=await pool.query(`SELECT e.id,e.user_id::text,u.first_name,u.username,e.status,e.room_index,e.state,e.started_at,e.completed_at FROM expeditions e JOIN users u ON u.id=e.user_id WHERE ($1='all' OR e.status=$1) ORDER BY e.started_at DESC LIMIT $2`,[q.status,q.limit]);return{items:rows.rows};});
  app.post('/admin/api/operations/expeditions/:id/cancel',async request=>{const admin=requirePermission(request,'operations:write');const{id}=idSchema.parse(request.params);await pool.query(`UPDATE expeditions SET status='cancelled',completed_at=NOW() WHERE id=$1 AND status='active'`,[id]);await writeAudit(admin,'expedition.cancel','expedition',id,{},request);return{ok:true};});
  app.get('/admin/api/operations/notes',async request=>{requirePermission(request,'operations:read');const q=z.object({search:z.string().max(100).default(''),limit:z.coerce.number().int().min(1).max(200).default(100)}).parse(request.query);const rows=await pool.query(`SELECT n.id,n.body,n.mood,n.created_at,n.author_id::text,n.target_id::text,a.first_name author_name,t.first_name target_name FROM neighbor_notes n JOIN users a ON a.id=n.author_id JOIN users t ON t.id=n.target_id WHERE ($1='' OR n.body ILIKE '%'||$1||'%' OR a.first_name ILIKE '%'||$1||'%' OR t.first_name ILIKE '%'||$1||'%') ORDER BY n.created_at DESC LIMIT $2`,[q.search,q.limit]);return{items:rows.rows};});
  app.delete('/admin/api/operations/notes/:id',async request=>{const admin=requirePermission(request,'operations:write');const{id}=idSchema.parse(request.params);await pool.query(`DELETE FROM neighbor_notes WHERE id=$1`,[id]);await writeAudit(admin,'note.delete','note',id,{},request);return{ok:true};});
  app.get('/admin/api/operations/referrals',async request=>{requirePermission(request,'operations:read');const rows=await pool.query(`SELECT r.inviter_id::text,r.invited_id::text,i.first_name inviter_name,i.username inviter_username,u.first_name invited_name,u.username invited_username,r.rewarded_at FROM referral_rewards r JOIN users i ON i.id=r.inviter_id JOIN users u ON u.id=r.invited_id ORDER BY r.rewarded_at DESC LIMIT 300`);return{items:rows.rows};});

  app.get('/admin/api/settings',async request=>{requirePermission(request,'settings:read');return{settings:await getAllSettings()};});
  app.patch('/admin/api/settings',async request=>{const admin=requirePermission(request,'settings:write');const body=z.object({maintenance_mode:z.boolean().optional(),maintenance_message:z.string().min(1).max(500).optional(),expeditions_enabled:z.boolean().optional(),notes_enabled:z.boolean().optional(),shop_enabled:z.boolean().optional(),max_expedition_rooms:z.number().int().min(1).max(20).optional()}).parse(request.body);for(const[key,value]of Object.entries(body))await setSetting(key,value);await writeAudit(admin,'settings.update','settings',null,body,request);return{ok:true};});

  app.get('/admin/api/admins',async request=>{requirePermission(request,'admins:read');return{items:(await pool.query(`SELECT id,username,role,permissions,active,last_login_at,created_at,updated_at FROM admins ORDER BY created_at`)).rows,roles:['superadmin','manager','operator','moderator','content','analyst'],permissions:PERMISSIONS};});
  app.post('/admin/api/admins',async request=>{const admin=requirePermission(request,'admins:write');const body=z.object({username:z.string().trim().min(3).max(64),password:z.string().min(12).max(256),role:z.enum(['superadmin','manager','operator','moderator','content','analyst']),permissions:z.array(z.enum(PERMISSIONS)).default([])}).parse(request.body);const id=crypto.randomUUID();await pool.query(`INSERT INTO admins(id,username,password_hash,role,permissions) VALUES($1,$2,$3,$4,$5)`,[id,body.username,await hashPassword(body.password),body.role,JSON.stringify(body.permissions)]);await writeAudit(admin,'admin.create','admin',id,{username:body.username,role:body.role,permissions:body.permissions},request);return{ok:true,id};});
  app.patch('/admin/api/admins/:id',async request=>{const admin=requirePermission(request,'admins:write');const{id}=idSchema.parse(request.params);const body=z.object({role:z.enum(['superadmin','manager','operator','moderator','content','analyst']).optional(),permissions:z.array(z.enum(PERMISSIONS)).optional(),active:z.boolean().optional(),password:z.string().min(12).max(256).optional()}).parse(request.body);if(id===admin.id&&body.active===false)throw new AppError('Нельзя отключить собственную учётную запись',409,'SELF_DISABLE_FORBIDDEN');const passwordHash=body.password?await hashPassword(body.password):null;await pool.query(`UPDATE admins SET role=COALESCE($2,role),permissions=COALESCE($3,permissions),active=COALESCE($4,active),password_hash=COALESCE($5,password_hash),session_version=session_version+CASE WHEN $5::text IS NOT NULL OR $4::boolean=FALSE THEN 1 ELSE 0 END,updated_at=NOW() WHERE id=$1`,[id,body.role??null,body.permissions===undefined?null:JSON.stringify(body.permissions),body.active??null,passwordHash]);await writeAudit(admin,'admin.update','admin',id,{...body,password:body.password?'[changed]':undefined},request);return{ok:true};});
  app.delete('/admin/api/admins/:id',async request=>{const admin=requirePermission(request,'admins:write');const{id}=idSchema.parse(request.params);if(id===admin.id)throw new AppError('Нельзя удалить собственную учётную запись',409,'SELF_DELETE_FORBIDDEN');await pool.query(`DELETE FROM admins WHERE id=$1`,[id]);await writeAudit(admin,'admin.delete','admin',id,{},request);return{ok:true};});

  app.get('/admin/api/audit',async request=>{requirePermission(request,'audit:read');const q=z.object({page:pageSchema,limit:limitSchema,search:z.string().max(100).default('')}).parse(request.query);const{limit,offset}=paging(q.page,q.limit);const count=await pool.query(`SELECT COUNT(*)::int total FROM admin_audit_log l LEFT JOIN admins a ON a.id=l.admin_id WHERE ($1='' OR l.action ILIKE '%'||$1||'%' OR l.entity_type ILIKE '%'||$1||'%' OR l.entity_id ILIKE '%'||$1||'%' OR a.username ILIKE '%'||$1||'%')`,[q.search]);const rows=await pool.query(`SELECT l.*,a.username admin_username FROM admin_audit_log l LEFT JOIN admins a ON a.id=l.admin_id WHERE ($1='' OR l.action ILIKE '%'||$1||'%' OR l.entity_type ILIKE '%'||$1||'%' OR l.entity_id ILIKE '%'||$1||'%' OR a.username ILIKE '%'||$1||'%') ORDER BY l.created_at DESC LIMIT $2 OFFSET $3`,[q.search,limit,offset]);const total=Number(count.rows[0].total);return{items:rows.rows,page:q.page,total,totalPages:totalPages(total,q.limit)};});
}
