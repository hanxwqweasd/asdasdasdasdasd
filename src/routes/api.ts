import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { authenticateRequest } from '../auth.js';
import { pool, withTransaction } from '../db.js';
import { createExpedition, currentRoom, resolveChoice, type ExpeditionState } from '../game/engine.js';
import { ITEM_CATALOG } from '../game/catalog.js';
import { loadEnabledRooms } from '../game/content.js';
import { config } from '../config.js';
import { createStarsInvoice } from '../telegram.js';
import { AppError } from '../errors.js';
import { getAllSettings, getSetting } from '../settings.js';
import { roleChoice } from '../services/roles.js';
import { changeInventory } from '../services/economy.js';
import { executeIdempotent, operationKey, assertActionLimit } from '../security/anti-abuse.js';
import { assertCanCommunicate, moderateText } from '../services/moderation.js';
import { recordBehavior } from '../services/storylines.js';
import { makeRoomObservation, makeSceneObservation } from '../services/room-observation.js';


function userOf(request: FastifyRequest) {
  return (request as FastifyRequest & { telegramUser: { id: number } }).telegramUser;
}

function exposeRoom(state: ExpeditionState, roomIndex: number) {
  const room = currentRoom(state, roomIndex);
  if (!room) return null;
  return { ...room, choices: room.choices.map(({ label, requires }) => ({ label, requires })) };
}

async function assertEnabled(key: string, message: string): Promise<void> {
  if (!await getSetting<boolean>(key, true)) throw new AppError(message, 503, 'FEATURE_DISABLED');
}

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async request => {
    if (request.url.startsWith('/api/')) (request as any).telegramUser = await authenticateRequest(request);
  });

  app.get('/api/bootstrap', async request => {
    const user = userOf(request);
    const [profile, inventory, apartment, event, neighbors, notes, active, shop, season, settings] = await Promise.all([
      pool.query(`SELECT p.*,u.referral_code,u.username,u.first_name,u.photo_url FROM player_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1`, [user.id]),
      pool.query(`SELECT item_id,quantity FROM inventory WHERE user_id=$1 AND quantity>0 ORDER BY item_id`, [user.id]),
      pool.query(`SELECT id,item_id,slot,rotation FROM apartment_items WHERE user_id=$1 ORDER BY slot`, [user.id]),
      pool.query(`SELECT * FROM building_events WHERE active_from<=NOW() AND active_until>NOW() ORDER BY CASE severity WHEN 'critical' THEN 4 WHEN 'danger' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END DESC, active_from DESC LIMIT 1`),
      pool.query(`SELECT u.id::text,u.first_name,u.username,p.apartment_no,p.trust FROM users u JOIN player_profiles p ON p.user_id=u.id
        LEFT JOIN user_moderation m ON m.user_id=u.id
        WHERE u.id<>$1 AND NOT(COALESCE(m.banned,FALSE) AND (m.banned_until IS NULL OR m.banned_until>NOW())) ORDER BY p.last_seen DESC LIMIT 12`, [user.id]),
      pool.query(`SELECT n.id,n.body,n.mood,n.created_at,a.first_name author_name FROM neighbor_notes n JOIN users a ON a.id=n.author_id WHERE n.target_id=$1 ORDER BY n.created_at DESC LIMIT 20`, [user.id]),
      pool.query(`SELECT * FROM expeditions WHERE user_id=$1 AND status='active' LIMIT 1`, [user.id]),
      pool.query(`SELECT sku,title,description,stars,icon,product_type,available_from,available_until,full_contents,guest_slots FROM shop_products WHERE active=TRUE AND (available_from IS NULL OR available_from<=NOW()) AND (available_until IS NULL OR available_until>NOW()) ORDER BY sort_order,sku`),
      pool.query(`SELECT id,slug,title,description,starts_at,ends_at,metadata FROM seasons WHERE status='active' AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>NOW()) ORDER BY created_at DESC LIMIT 1`),
      getAllSettings()
    ]);
    const activeExpedition = active.rows[0] ? {
      id: active.rows[0].id,
      state: active.rows[0].state,
      roomIndex: active.rows[0].room_index,
      room: exposeRoom(active.rows[0].state, active.rows[0].room_index),
      status: active.rows[0].status
    } : null;
    return {
      profile: profile.rows[0],
      inventory: inventory.rows.map(row => ({ ...row, ...ITEM_CATALOG[row.item_id] })),
      apartment: apartment.rows.map(row => ({ ...row, ...ITEM_CATALOG[row.item_id] })),
      event: event.rows[0] ?? null,
      season: season.rows[0] ?? null,
      neighbors: neighbors.rows,
      notes: notes.rows,
      shop: shop.rows,
      activeExpedition,
      system: settings,
      referralLink: `https://t.me/${config.BOT_USERNAME}?start=${profile.rows[0].referral_code}`,
      economy: { houseMarks: Number(profile.rows[0].house_marks ?? 0) }
    };
  });

  app.post('/api/scenes/observe', async request => {
    const user = userOf(request);
    await assertActionLimit(user.id, 'scene_observe', 30, 60);
    const body = z.object({
      sceneKey: z.string().trim().min(1).max(80),
      action: z.enum(['listen','inspect']),
      operationId: z.string().optional()
    }).parse(request.body);
    const key = operationKey(request, body);
    return executeIdempotent(user.id, 'scene-observe', key, body, async () => {
      const count = await pool.query(`SELECT COUNT(*)::int count FROM room_observations WHERE expedition_id IS NULL AND user_id=$1 AND room_id=$2 AND action=$3 AND created_at>=CURRENT_DATE`, [user.id, body.sceneKey, body.action]);
      const attempt = Number(count.rows[0]?.count ?? 0);
      const observation = makeSceneObservation(body.sceneKey, body.action, `${user.id}:${new Date().toISOString().slice(0,10)}`, attempt);
      await pool.query(`INSERT INTO room_observations(id,expedition_id,user_id,room_id,action,variant_key,payload) VALUES($1,NULL,$2,$3,$4,$5,$6)`, [crypto.randomUUID(), user.id, body.sceneKey, body.action, `${observation.key}:${attempt}`, JSON.stringify(observation)]);
      await pool.query(`INSERT INTO analytics_events(user_id,event_name,properties) VALUES($1,'scene_observe',$2)`, [user.id, JSON.stringify({sceneKey:body.sceneKey,action:body.action,attempt,variant:observation.key})]);
      return { observation, attemptsToday: attempt + 1 };
    });
  });

  app.post('/api/expeditions/:id/observe', async request => {
    await assertEnabled('expeditions_enabled', 'Лифт временно закрыт администрацией дома');
    const user = userOf(request);
    await assertActionLimit(user.id, 'expedition_observe', 30, 60);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ action: z.enum(['listen','inspect']), operationId: z.string().optional() }).parse(request.body);
    const key = operationKey(request, body);
    return executeIdempotent(user.id, 'expedition-observe', key, {...body,expeditionId:params.id}, async () => withTransaction(async client => {
      const found = await client.query(`SELECT * FROM expeditions WHERE id=$1 AND user_id=$2 FOR UPDATE`, [params.id, user.id]);
      const expedition = found.rows[0];
      if (!expedition || expedition.status !== 'active') throw new AppError('Вылазка уже завершена', 409, 'EXPEDITION_FINISHED');
      const room = currentRoom(expedition.state, expedition.room_index);
      if (!room) throw new AppError('Комната не найдена', 409, 'ROOM_NOT_FOUND');
      const previous = await client.query(`SELECT COUNT(*)::int count FROM room_observations WHERE expedition_id=$1 AND user_id=$2 AND room_id=$3 AND action=$4`, [params.id,user.id,room.id,body.action]);
      const attempt = Number(previous.rows[0]?.count ?? 0);
      if (attempt >= 3) throw new AppError(body.action === 'listen' ? 'Вы уже услышали всё, что комната готова выдать' : 'Вы уже осмотрели все доступные детали', 409, 'ROOM_OBSERVATION_EXHAUSTED');
      const observation = makeRoomObservation(room, body.action, `${expedition.seed}:${user.id}:${expedition.room_index}`, attempt);
      const nextState = structuredClone(expedition.state) as ExpeditionState;
      if (observation.clueAwarded) nextState.clues = Math.max(0, Number(nextState.clues ?? 0) + 1);
      await client.query(`INSERT INTO room_observations(id,expedition_id,user_id,room_id,action,variant_key,payload) VALUES($1,$2,$3,$4,$5,$6,$7)`, [crypto.randomUUID(),params.id,user.id,room.id,body.action,observation.key,JSON.stringify(observation)]);
      await client.query(`UPDATE expeditions SET state=$2 WHERE id=$1`, [params.id,nextState]);
      await client.query(`INSERT INTO analytics_events(user_id,event_name,properties) VALUES($1,'room_observe',$2)`, [user.id,JSON.stringify({expeditionId:params.id,roomId:room.id,action:body.action,attempt,variant:observation.key,clueAwarded:observation.clueAwarded})]);
      return { observation, attemptsRemaining: 2 - attempt, state: nextState };
    }));
  });

  app.post('/api/profile/intro-seen', async request => {
    const user = userOf(request);
    await pool.query('UPDATE player_profiles SET intro_seen=TRUE WHERE user_id=$1', [user.id]);
    return { ok: true };
  });

  app.post('/api/expeditions/start', async request => {
    await assertEnabled('expeditions_enabled', 'Лифт временно закрыт администрацией дома');
    if (await getSetting<boolean>('maintenance_mode', false)) {
      const message = await getSetting<string>('maintenance_message', 'Дом временно закрыт');
      throw new AppError(message, 503, 'MAINTENANCE_MODE');
    }
    const user = userOf(request);
    const existing = await pool.query(`SELECT * FROM expeditions WHERE user_id=$1 AND status='active' LIMIT 1`, [user.id]);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      return { id: row.id, state: row.state, roomIndex: row.room_index, room: exposeRoom(row.state, row.room_index), status: row.status };
    }
    const [baseRooms, maxRooms, roleResult] = await Promise.all([
      loadEnabledRooms(),
      getSetting<number>('max_expedition_rooms', 6),
      pool.query(`SELECT role_key FROM role_progress WHERE user_id=$1`, [user.id])
    ]);
    const role = roleResult.rows[0]?.role_key as string | undefined;
    const rooms = baseRooms.map(room => {
      const special = roleChoice(role, room.id);
      return special ? { ...room, choices: [...room.choices, special] } : room;
    });
    const id = crypto.randomUUID();
    const seed = crypto.randomInt(1, 2_147_483_647);
    const state = createExpedition(seed, rooms, Number(maxRooms));
    await pool.query(`INSERT INTO expeditions(id,user_id,seed,state,status) VALUES($1,$2,$3,$4,'active')`, [id, user.id, seed, state]);
    return { id, state, roomIndex: 0, room: exposeRoom(state, 0), status: 'active' };
  });

  app.post('/api/expeditions/:id/action', async request => {
    await assertEnabled('expeditions_enabled', 'Лифт временно закрыт администрацией дома');
    const user = userOf(request);
    await assertActionLimit(user.id, 'expedition_action', 40, 60);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ choiceIndex: z.number().int().min(0).max(5), operationId: z.string().optional() }).parse(request.body);
    const key = operationKey(request, body);
    return executeIdempotent(user.id, 'expedition-action', key, { ...body, expeditionId: params.id }, async () => withTransaction(async client => {
      const found = await client.query(`SELECT * FROM expeditions WHERE id=$1 AND user_id=$2 FOR UPDATE`, [params.id, user.id]);
      const expedition = found.rows[0];
      if (!expedition || expedition.status !== 'active') throw new AppError('Экспедиция уже завершена', 409, 'EXPEDITION_FINISHED');
      const room = currentRoom(expedition.state, expedition.room_index);
      const selected = room?.choices[body.choiceIndex];
      const result = resolveChoice(expedition.state, expedition.room_index, body.choiceIndex);
      await client.query(`UPDATE expeditions SET state=$2,room_index=$3,status=$4,completed_at=CASE WHEN $4::text='active' THEN NULL ELSE NOW() END WHERE id=$1`,
        [params.id, result.state, result.roomIndex, result.status]);
      await client.query(`INSERT INTO analytics_events(user_id,event_name,properties) VALUES($1,'room_choice',$2)`, [user.id, JSON.stringify({ expeditionId: params.id, roomId: room?.id, choiceIndex: body.choiceIndex, status: result.status })]);
      if(room?.id){const traceTypes=['silhouette','sound','message','object','camera'];const traceType=traceTypes[Math.abs(Number(expedition.seed)+expedition.room_index+body.choiceIndex)%traceTypes.length];await client.query(`INSERT INTO room_traces(id,room_id,user_id,trace_type,payload) VALUES($1,$2,$3,$4,$5)`,[crypto.randomUUID(),room.id,user.id,traceType,JSON.stringify({choice:selected?.label,outcome:selected?.outcome,status:result.status})]);}
      if(room?.id){const visits=await client.query(`SELECT COUNT(*)::int count FROM analytics_events WHERE user_id=$1 AND event_name='room_choice' AND properties->>'roomId'=$2`,[user.id,room.id]);if(Number(visits.rows[0]?.count)>=3)await client.query(`INSERT INTO user_achievements(achievement_id,user_id,context) SELECT id,$1,$2 FROM achievements WHERE slug='room-third-time' ON CONFLICT DO NOTHING`,[user.id,JSON.stringify({roomId:room.id,count:Number(visits.rows[0]?.count)})]);}
      if (selected?.effects?.noise && selected.effects.noise > 8) void recordBehavior(user.id, 'lie', 1, { roomId: room?.id }).catch(() => undefined);
      if (room?.ambience === 'radio' || room?.ambience === 'voices') void recordBehavior(user.id, 'listen', 1, { roomId: room?.id }).catch(() => undefined);
      if (selected?.effects?.item === 'torn_photo') void recordBehavior(user.id, 'photo', 1, { roomId: room?.id }).catch(() => undefined);
      if (result.status !== 'active') {
        const multiplier = result.status === 'escaped' ? 1 : 0.35;
        const clues = Math.floor(result.state.clues * multiplier);
        const trust = result.status === 'escaped' ? 2 : 0;
        await client.query(`UPDATE player_profiles SET clues=clues+$2,trust=trust+$3,nerve=$4 WHERE user_id=$1`, [user.id, clues, trust, result.status === 'escaped' ? 100 : 65]);
        for (const [itemId, qty] of Object.entries(result.state.bag)) {
          if (qty <= 0 || ['matchbox', 'chalk'].includes(itemId)) continue;
          const keep = Math.max(0, Math.floor(qty * multiplier));
          if (keep) await changeInventory(client, user.id, itemId, keep, 'expedition_reward', `expedition:${params.id}:${itemId}`, { status: result.status });
        }
        await client.query(`UPDATE building_weekly_goals SET progress=LEAST(target,progress+$2),status=CASE WHEN progress+$2>=target THEN 'completed' ELSE status END,completed_at=CASE WHEN progress+$2>=target THEN COALESCE(completed_at,NOW()) ELSE completed_at END WHERE building_id=(SELECT building_id FROM building_members WHERE user_id=$1) AND status='active'`, [user.id, clues]);
        if (result.status==='escaped'&&result.state.nerve === 0) await client.query(`INSERT INTO user_achievements(achievement_id,user_id,context) SELECT id,$1,$2 FROM achievements WHERE slug='zero-nerve' ON CONFLICT DO NOTHING`,[user.id,JSON.stringify({expeditionId:params.id})]);
        if (result.status==='escaped'&&Number(result.state.lightsUsed??0)===0) await client.query(`INSERT INTO user_achievements(achievement_id,user_id,context) SELECT id,$1,$2 FROM achievements WHERE slug='without-light' ON CONFLICT DO NOTHING`,[user.id,JSON.stringify({expeditionId:params.id})]);
        void recordBehavior(user.id, result.status === 'escaped' ? 'rescue' : 'abandon', 1, { expeditionId: params.id }).catch(() => undefined);
      }
      return { id: params.id, ...result, room: result.status === 'active' ? exposeRoom(result.state, result.roomIndex) : null } as Record<string, unknown>;
    }));
  });

  app.post('/api/apartment/place', async request => {
    const user = userOf(request);
    const body = z.object({ itemId: z.string().min(1).max(80), slot: z.number().int().min(0).max(11), rotation: z.number().int().min(0).max(3).default(0) }).parse(request.body);
    await withTransaction(async client => {
      const inv = await client.query(`SELECT quantity FROM inventory WHERE user_id=$1 AND item_id=$2 FOR UPDATE`, [user.id, body.itemId]);
      if (!inv.rows[0] || inv.rows[0].quantity < 1) throw new AppError('Этого предмета нет в инвентаре', 409, 'ITEM_MISSING');
      const old = await client.query(`SELECT item_id FROM apartment_items WHERE user_id=$1 AND slot=$2 FOR UPDATE`, [user.id, body.slot]);
      if (old.rows[0]) await client.query(`INSERT INTO inventory(user_id,item_id,quantity) VALUES($1,$2,1)
        ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=inventory.quantity+1`, [user.id, old.rows[0].item_id]);
      await client.query(`DELETE FROM apartment_items WHERE user_id=$1 AND slot=$2`, [user.id, body.slot]);
      await client.query(`INSERT INTO apartment_items(id,user_id,item_id,slot,rotation) VALUES($1,$2,$3,$4,$5)`, [crypto.randomUUID(), user.id, body.itemId, body.slot, body.rotation]);
      await client.query(`UPDATE inventory SET quantity=quantity-1 WHERE user_id=$1 AND item_id=$2`, [user.id, body.itemId]);
      await client.query(`DELETE FROM inventory WHERE user_id=$1 AND item_id=$2 AND quantity=0`, [user.id, body.itemId]);
    });
    return { ok: true };
  });

  app.post('/api/social/note', async request => {
    await assertEnabled('notes_enabled', 'Доска записок временно закрыта');
    const user = userOf(request);
    await assertCanCommunicate(user.id);
    await assertActionLimit(user.id, 'neighbor_note', 10, 3600);
    const body = z.object({ targetId: z.string().regex(/^\d+$/), body: z.string().trim().min(1).max(280), mood: z.enum(['neutral', 'warning', 'kind', 'strange']).default('neutral') }).parse(request.body);
    if (body.targetId === String(user.id)) throw new AppError('Нельзя оставить записку самому себе', 400, 'SELF_NOTE');
    const target = await pool.query(`SELECT 1 FROM users u LEFT JOIN user_moderation m ON m.user_id=u.id WHERE u.id=$1 AND NOT(COALESCE(m.banned,FALSE) AND (m.banned_until IS NULL OR m.banned_until>NOW()))`, [body.targetId]);
    if (!target.rowCount) throw new AppError('Жилец недоступен', 404, 'TARGET_NOT_FOUND');
    const checked = await moderateText(user.id, body.body, { entity: 'neighbor_note', targetId: body.targetId });
    if (checked.hidden) throw new AppError('Записка отправлена на проверку и пока скрыта', 202, 'MESSAGE_UNDER_REVIEW');
    await pool.query(`INSERT INTO neighbor_notes(id,author_id,target_id,body,mood) VALUES($1,$2,$3,$4,$5)`, [crypto.randomUUID(), user.id, body.targetId, checked.text, body.mood]);
    return { ok: true };
  });

  app.post('/api/shop/:sku/invoice', async request => {
    await assertEnabled('shop_enabled', 'Магазин временно закрыт');
    const user = userOf(request);
    const { sku } = z.object({ sku: z.string().min(1).max(60) }).parse(request.params);
    return createStarsInvoice(user.id, sku);
  });

  app.get('/api/purchases/:id/status', async request => {
    const user = userOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const found = await pool.query(`SELECT status FROM purchases WHERE id=$1 AND user_id=$2`, [id, user.id]);
    if (!found.rows[0]) throw new AppError('Счёт не найден', 404, 'PURCHASE_NOT_FOUND');
    return { status: found.rows[0].status };
  });
}
