import crypto from 'node:crypto';
import { pool } from '../db.js';

const statements = [
`ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS house_marks INTEGER NOT NULL DEFAULT 100`,
`ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS profession TEXT`,
`ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS tutorial_completed_at TIMESTAMPTZ`,
`ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS last_daily_scenario_date DATE`,
`ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS no_lie_since DATE NOT NULL DEFAULT CURRENT_DATE`,
`ALTER TABLE user_moderation ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ`,
`ALTER TABLE user_moderation ADD COLUMN IF NOT EXISTS shadow_muted BOOLEAN NOT NULL DEFAULT FALSE`,
`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`,
`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'pack'`,
`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS available_from TIMESTAMPTZ`,
`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ`,
`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS full_contents JSONB NOT NULL DEFAULT '[]'::jsonb`,
`ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS guest_slots INTEGER NOT NULL DEFAULT 0`,
`CREATE TABLE IF NOT EXISTS buildings (
  id UUID PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, capacity INTEGER NOT NULL DEFAULT 30,
  elder_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, trust_score INTEGER NOT NULL DEFAULT 0,
  shared_progress INTEGER NOT NULL DEFAULT 0, discovered_rooms JSONB NOT NULL DEFAULT '[]'::jsonb,
  consequences JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS building_members (
  building_id UUID REFERENCES buildings(id) ON DELETE CASCADE, user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), contribution INTEGER NOT NULL DEFAULT 0, local_trust INTEGER NOT NULL DEFAULT 0,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(building_id,user_id)
)`,
`CREATE INDEX IF NOT EXISTS building_members_building_idx ON building_members(building_id,last_active_at DESC)`,
`CREATE TABLE IF NOT EXISTS building_posts (
  id UUID PRIMARY KEY, building_id UUID REFERENCES buildings(id) ON DELETE CASCADE, author_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(char_length(body) BETWEEN 1 AND 500), pinned BOOLEAN NOT NULL DEFAULT FALSE,
  hidden BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS building_storage (
  building_id UUID REFERENCES buildings(id) ON DELETE CASCADE, item_id TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(building_id,item_id)
)`,
`CREATE TABLE IF NOT EXISTS building_storage_log (
  id BIGSERIAL PRIMARY KEY, building_id UUID REFERENCES buildings(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  item_id TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS building_votes (
  id UUID PRIMARY KEY, building_id UUID REFERENCES buildings(id) ON DELETE CASCADE, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, options JSONB NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','closed','cancelled')) DEFAULT 'open', closes_at TIMESTAMPTZ NOT NULL,
  result JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS building_vote_ballots (
  vote_id UUID REFERENCES building_votes(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  option_key TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(vote_id,user_id)
)`,
`CREATE TABLE IF NOT EXISTS building_weekly_goals (
  id UUID PRIMARY KEY, building_id UUID REFERENCES buildings(id) ON DELETE CASCADE, week_start DATE NOT NULL,
  goal_key TEXT NOT NULL, title TEXT NOT NULL, target INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
  reward_config JSONB NOT NULL DEFAULT '{}'::jsonb, status TEXT NOT NULL CHECK(status IN ('active','completed','expired')) DEFAULT 'active',
  completed_at TIMESTAMPTZ, UNIQUE(building_id,week_start,goal_key)
)`,
`CREATE TABLE IF NOT EXISTS tutorial_progress (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, step INTEGER NOT NULL DEFAULT 0,
  state JSONB NOT NULL DEFAULT '{}'::jsonb, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ
)`,
`CREATE TABLE IF NOT EXISTS daily_scenarios (
  id UUID PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, teaser TEXT NOT NULL, scenes JSONB NOT NULL,
  reward_config JSONB NOT NULL DEFAULT '{}'::jsonb, active BOOLEAN NOT NULL DEFAULT TRUE, scheduled_date DATE,
  weekday INTEGER CHECK(weekday BETWEEN 0 AND 6), priority INTEGER NOT NULL DEFAULT 0, created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS daily_scenario_progress (
  scenario_id UUID REFERENCES daily_scenarios(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  play_date DATE NOT NULL DEFAULT CURRENT_DATE, step INTEGER NOT NULL DEFAULT 0, state JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ, PRIMARY KEY(scenario_id,user_id,play_date)
)`,
`CREATE TABLE IF NOT EXISTS behavior_events (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, behavior_key TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1, context JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE INDEX IF NOT EXISTS behavior_events_user_idx ON behavior_events(user_id,behavior_key,created_at DESC)`,
`CREATE TABLE IF NOT EXISTS storylines (
  id UUID PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL,
  trigger_rules JSONB NOT NULL, chapters JSONB NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS storyline_assignments (
  storyline_id UUID REFERENCES storylines(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  chapter INTEGER NOT NULL DEFAULT 0, state JSONB NOT NULL DEFAULT '{}'::jsonb, assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ, PRIMARY KEY(storyline_id,user_id)
)`,
`CREATE TABLE IF NOT EXISTS role_progress (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, role_key TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0, quest_step INTEGER NOT NULL DEFAULT 0, selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS market_listings (
  id UUID PRIMARY KEY, seller_id BIGINT REFERENCES users(id) ON DELETE CASCADE, item_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
  remaining INTEGER NOT NULL CHECK(remaining>=0), price_per_unit INTEGER NOT NULL CHECK(price_per_unit>0), anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK(status IN ('active','sold','cancelled','expired')) DEFAULT 'active', expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE INDEX IF NOT EXISTS market_listings_active_idx ON market_listings(status,item_id,price_per_unit,created_at)`,
`CREATE TABLE IF NOT EXISTS market_orders (
  id UUID PRIMARY KEY, buyer_id BIGINT REFERENCES users(id) ON DELETE CASCADE, item_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
  remaining INTEGER NOT NULL CHECK(remaining>=0), max_price INTEGER NOT NULL CHECK(max_price>0), status TEXT NOT NULL CHECK(status IN ('active','filled','cancelled','expired')) DEFAULT 'active',
  reserved_marks INTEGER NOT NULL DEFAULT 0, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS market_trades (
  id UUID PRIMARY KEY, listing_id UUID REFERENCES market_listings(id) ON DELETE SET NULL, order_id UUID REFERENCES market_orders(id) ON DELETE SET NULL,
  seller_id BIGINT REFERENCES users(id) ON DELETE SET NULL, buyer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  item_id TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price INTEGER NOT NULL, commission INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS item_provenance (
  id BIGSERIAL PRIMARY KEY, item_id TEXT NOT NULL, quantity INTEGER NOT NULL, from_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  to_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, source_type TEXT NOT NULL, source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL,
  required_items JSONB NOT NULL, reward_config JSONB NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, seasonal BOOLEAN NOT NULL DEFAULT FALSE
)`,
`CREATE TABLE IF NOT EXISTS collection_claims (
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(collection_id,user_id)
)`,
`CREATE TABLE IF NOT EXISTS achievements (
  id UUID PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL, hidden BOOLEAN NOT NULL DEFAULT TRUE,
  rule JSONB NOT NULL, reward_config JSONB NOT NULL DEFAULT '{}'::jsonb, active BOOLEAN NOT NULL DEFAULT TRUE
)`,
`CREATE TABLE IF NOT EXISTS user_achievements (
  achievement_id UUID REFERENCES achievements(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), context JSONB NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY(achievement_id,user_id)
)`,
`CREATE TABLE IF NOT EXISTS gifts (
  id UUID PRIMARY KEY, purchase_id UUID UNIQUE REFERENCES purchases(id) ON DELETE SET NULL, sender_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  target_id BIGINT REFERENCES users(id) ON DELETE CASCADE, sku TEXT NOT NULL, message TEXT, anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK(status IN ('pending','delivered','claimed','refunded')) DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), claimed_at TIMESTAMPTZ
)`,
`CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, category TEXT NOT NULL, subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','waiting_user','waiting_staff','resolved','closed')) DEFAULT 'open',
  priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')) DEFAULT 'normal', app_version TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY, ticket_id UUID REFERENCES support_tickets(id) ON DELETE CASCADE, author_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  author_admin_id UUID REFERENCES admins(id) ON DELETE SET NULL, body TEXT NOT NULL, screenshot_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK((author_user_id IS NOT NULL) <> (author_admin_id IS NOT NULL))
)`,
`CREATE TABLE IF NOT EXISTS user_reports (
  id UUID PRIMARY KEY, reporter_id BIGINT REFERENCES users(id) ON DELETE CASCADE, target_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, entity_id TEXT, reason TEXT NOT NULL, details TEXT, status TEXT NOT NULL CHECK(status IN ('open','reviewing','actioned','dismissed')) DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_by UUID REFERENCES admins(id) ON DELETE SET NULL, reviewed_at TIMESTAMPTZ
)`,
`CREATE TABLE IF NOT EXISTS moderation_actions (
  id UUID PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  action TEXT NOT NULL, reason TEXT NOT NULL, expires_at TIMESTAMPTZ, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS moderation_terms (
  id UUID PRIMARY KEY, pattern TEXT NOT NULL UNIQUE, severity INTEGER NOT NULL DEFAULT 1, action TEXT NOT NULL DEFAULT 'review', active BOOLEAN NOT NULL DEFAULT TRUE
)`,
`CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, session_id TEXT, event_name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb, app_version TEXT, experiment_assignments JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE INDEX IF NOT EXISTS analytics_events_name_time_idx ON analytics_events(event_name,created_at DESC)`,
`CREATE INDEX IF NOT EXISTS analytics_events_user_time_idx ON analytics_events(user_id,created_at DESC)`,
`CREATE TABLE IF NOT EXISTS ab_experiments (
  id UUID PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','running','paused','completed')),
  allocation INTEGER NOT NULL DEFAULT 100 CHECK(allocation BETWEEN 1 AND 100), targeting JSONB NOT NULL DEFAULT '{}'::jsonb,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS ab_variants (
  id UUID PRIMARY KEY, experiment_id UUID REFERENCES ab_experiments(id) ON DELETE CASCADE, key TEXT NOT NULL,
  weight INTEGER NOT NULL CHECK(weight>0), config JSONB NOT NULL DEFAULT '{}'::jsonb, UNIQUE(experiment_id,key)
)`,
`CREATE TABLE IF NOT EXISTS user_experiment_assignments (
  experiment_id UUID REFERENCES ab_experiments(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES ab_variants(id) ON DELETE CASCADE, assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(experiment_id,user_id)
)`,
`CREATE TABLE IF NOT EXISTS content_documents (
  id UUID PRIMARY KEY, slug TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published','archived')) DEFAULT 'draft',
  current_draft_version INTEGER NOT NULL DEFAULT 1, published_version INTEGER, test_audience JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL, updated_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS content_versions (
  document_id UUID REFERENCES content_documents(id) ON DELETE CASCADE, version INTEGER NOT NULL, graph JSONB NOT NULL,
  change_note TEXT, created_by UUID REFERENCES admins(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(document_id,version)
)`,
`CREATE TABLE IF NOT EXISTS economy_ledger (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, asset_type TEXT NOT NULL, asset_key TEXT NOT NULL,
  delta INTEGER NOT NULL, balance_after INTEGER, reason TEXT NOT NULL, operation_id TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`DROP INDEX IF EXISTS economy_ledger_operation_idx`,
`CREATE UNIQUE INDEX IF NOT EXISTS economy_ledger_operation_idx ON economy_ledger(operation_id,user_id,asset_type,asset_key) WHERE operation_id IS NOT NULL`,
`CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL, operation_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing','completed','failed')), response_status INTEGER, response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(user_id,scope,operation_key)
)`,
`CREATE TABLE IF NOT EXISTS risk_flags (
  id UUID PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, flag_type TEXT NOT NULL, score INTEGER NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb, status TEXT NOT NULL CHECK(status IN ('open','reviewing','cleared','confirmed')) DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ, reviewed_by UUID REFERENCES admins(id) ON DELETE SET NULL
)`,
`CREATE TABLE IF NOT EXISTS device_signals (
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, fingerprint_hash TEXT NOT NULL, network_hash TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), seen_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(user_id,fingerprint_hash)
)`,
`CREATE INDEX IF NOT EXISTS device_signals_fingerprint_idx ON device_signals(fingerprint_hash,last_seen_at DESC)`,
`CREATE TABLE IF NOT EXISTS coop_matches (
  id UUID PRIMARY KEY, code TEXT NOT NULL UNIQUE, host_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  building_id UUID REFERENCES buildings(id) ON DELETE SET NULL, status TEXT NOT NULL CHECK(status IN ('lobby','playing','escaped','lost','cancelled')),
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb, max_players INTEGER NOT NULL DEFAULT 4, scenario_sku TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS coop_members (
  match_id UUID REFERENCES coop_matches(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), left_at TIMESTAMPTZ, secret_objective TEXT, private_hint TEXT,
  contribution INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(match_id,user_id)
)`,
`CREATE TABLE IF NOT EXISTS backup_runs (
  id UUID PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, path TEXT, size_bytes BIGINT, checksum TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ, error TEXT, verified_at TIMESTAMPTZ
)`,
`CREATE TABLE IF NOT EXISTS app_sessions (
  id TEXT PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ended_at TIMESTAMPTZ, app_version TEXT, device_class TEXT
)`
];

const dailyTemplates = [
  ['wall-noise','Шум за стеной','Кто-то трижды постучал из квартиры, которая пустует семь лет.'],
  ['missing-resident','Пропавший жилец','На доске осталось имя соседа, но его квартиры больше нет.'],
  ['swapped-note','Подменённая записка','Ваш почерк появился на записке, которую вы не писали.'],
  ['unknown-key','Неизвестный ключ','Под ковриком лежит ключ с номером вашей квартиры и чужими царапинами.'],
  ['broken-lift','Сломанный лифт','Лифт приезжает пустым, но кнопка восьмого этажа уже нажата.'],
  ['concierge-visit','Визит консьержа','Консьерж просит расписаться в журнале, которого не существует.'],
  ['strange-call','Странный звонок','Телефон звонит из вашей собственной квартиры.'],
  ['temporary-room','Временная комната','На лестничной площадке появилась дверь только до полуночи.'],
  ['other-building-letter','Письмо из другого подъезда','В письме описано событие, которое произойдёт сегодня вечером.']
] as const;

const storylines = [
  ['forged-papers','Поддельные документы','Дом заметил, что вы часто скрываете правду.',{behavior:'lie',threshold:3}],
  ['abandoned-door','Оставленная дверь','Соседи помнят тех, кого вы бросили в коридоре.',{behavior:'abandon',threshold:2}],
  ['requests-for-help','Просьбы о помощи','Жильцы начали доверять вам самые неприятные дела.',{behavior:'rescue',threshold:3}],
  ['radio-amateur','Частота между этажами','Ваше внимание к звукам привлекло радиолюбителя.',{behavior:'listen',threshold:4}],
  ['photographer','Фотограф подъезда','На ваших снимках слишком часто появляется один человек.',{behavior:'photo',threshold:3}]
] as const;

export async function runV2Migrations(): Promise<void> {
  for (const sql of statements) await pool.query(sql);
  await pool.query(`INSERT INTO users(id,username,first_name,referral_code) VALUES(-8008,'concierge','Консьерж','system8008') ON CONFLICT(id) DO NOTHING`);
  await pool.query(`INSERT INTO player_profiles(user_id,apartment_no,trust,intro_seen) VALUES(-8008,8,999,TRUE) ON CONFLICT(user_id) DO NOTHING`);
  for (const [index,[slug,title,teaser]] of dailyTemplates.entries()) {
    const scenes=[
      {id:'notice',text:teaser,actions:[{key:'inspect',label:'Осмотреть место'},{key:'ask',label:'Спросить соседей'}]},
      {id:'trace',text:'След ведёт к лестнице между седьмым и девятым этажами.',actions:[{key:'follow',label:'Пойти по следу'},{key:'mark',label:'Оставить метку'}]},
      {id:'ending',text:'Дом запомнил ваш выбор. Последствия проявятся позже.',actions:[]}
    ];
    await pool.query(`INSERT INTO daily_scenarios(id,slug,title,teaser,scenes,reward_config,weekday,priority)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(slug) DO NOTHING`,[crypto.randomUUID(),slug,title,teaser,JSON.stringify(scenes),JSON.stringify({marks:8,clues:1}),index%7,index]);
  }
  for (const [slug,title,description,rule] of storylines) {
    const chapters=[{title:'Первый знак',text:description},{title:'Личная просьба',text:'Сосед оставил ключ и попросил никому не рассказывать.'},{title:'Последствие',text:'Ваш выбор изменил отношение подъезда.'}];
    await pool.query(`INSERT INTO storylines(id,slug,title,description,trigger_rules,chapters) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(slug) DO NOTHING`,[crypto.randomUUID(),slug,title,description,JSON.stringify(rule),JSON.stringify(chapters)]);
  }
  const collections=[
    ['keys-of-house','Ключи дома','Соберите ключи, которые не подходят ни к одной известной двери',{brass_key:3,spare_key:2},{entitlements:[{key:'room:key-vault',value:{unlocked:true}}]}],
    ['broken-photos','Чужие фотографии','Фотографии жильцов из разных лет',{torn_photo:5},{inventory:[{itemId:'darkroom_wallpaper',quantity:1}]}],
    ['archive-traces','Следы архива','Печати, кассеты и нити из закрытых дел',{archive_stamp:3,cassette:2,black_thread:3},{entitlements:[{key:'story:archive-basement',value:{unlocked:true}}]}]
  ];
  for(const [slug,title,description,required,reward] of collections) await pool.query(`INSERT INTO collections(id,slug,title,description,required_items,reward_config) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(slug) DO NOTHING`,[crypto.randomUUID(),slug,title,description,JSON.stringify(required),JSON.stringify(reward)]);
  const achievements=[
    ['without-light','Не включая свет','Пройти этаж, ни разу не включив источник света',true,{event:'expedition_complete',condition:{lights:0}}],
    ['zero-nerve','На последнем дыхании','Вернуться с нулевым самообладанием',true,{event:'expedition_complete',condition:{nerve:0}}],
    ['impossible-elevator','Несуществующий звонок','Услышать лифт, которого нет в шахте',true,{event:'sound',condition:{key:'impossible_elevator'}}],
    ['stranger-gift','Оставлено незнакомцу','Передать предмет незнакомому жильцу',true,{event:'gift',condition:{stranger:true}}],
    ['room-third-time','Комната помнит','Встретить одну комнату трижды',true,{event:'room_visit',condition:{count:3}}],
    ['old-photo-self','До вашего заселения','Найти себя на старой фотографии',true,{event:'story',condition:{key:'self_photo'}}],
    ['week-no-lies','Семь тихих дней','Не солгать ни разу за неделю',true,{event:'daily',condition:{days:7}}]
  ];
  for(const [slug,title,description,hidden,rule] of achievements) await pool.query(`INSERT INTO achievements(id,slug,title,description,hidden,rule) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(slug) DO NOTHING`,[crypto.randomUUID(),slug,title,description,hidden,JSON.stringify(rule)]);
  const products=[
    ['atelier_chapter','Исчезнувшее ателье','Полная сюжетная глава на 40–60 минут.',89,'✂','chapter',JSON.stringify({entitlements:[{key:'chapter:atelier',value:{unlocked:true}}]}),JSON.stringify(['Сюжетная глава','Новые комнаты','Авторские звуки','Коллекционный предмет']),0],
    ['company_night','Закрытая ночь для компании','Один билет открывает кооперативный сценарий владельцу и двум друзьям.',119,'Ⅲ','coop_chapter',JSON.stringify({inventory:[{itemId:'company_night_ticket',quantity:1}],entitlements:[{key:'coop:company-night',value:{guestSlots:2}}]}),JSON.stringify(['Кооперативная ночь','2 бесплатных гостевых места','Личные тайные цели']),2],
    ['season_interior','Интерьер старого председателя','Ограниченный сезонный интерьер с полным набором предметов.',149,'⌂','limited',JSON.stringify({profile:{apartmentStyle:'chairman'},inventory:[{itemId:'old_door_collection',quantity:1}]}),JSON.stringify(['Стиль квартиры','Старая дверь','Звуки кабинета']),0]
  ];
  for(const [sku,title,description,stars,icon,type,grant,contents,guestSlots] of products) await pool.query(`INSERT INTO shop_products(sku,title,description,stars,icon,product_type,grant_config,full_contents,guest_slots,active,sort_order)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,50) ON CONFLICT(sku) DO NOTHING`,[sku,title,description,stars,icon,type,grant,contents,guestSlots]);
  await pool.query(`INSERT INTO ab_experiments(id,key,title,description,status,allocation,starts_at) VALUES($1,'first-screen','Первый экран','Сравнение формулировок первого входа','running',100,NOW()) ON CONFLICT(key) DO NOTHING`,[crypto.randomUUID()]);
  const experiment=await pool.query(`SELECT id FROM ab_experiments WHERE key='first-screen'`);
  if(experiment.rows[0]){
    await pool.query(`INSERT INTO ab_variants(id,experiment_id,key,weight,config) VALUES($1,$2,'corridor',50,$3),($4,$2,'door-name',50,$5) ON CONFLICT(experiment_id,key) DO NOTHING`,[crypto.randomUUID(),experiment.rows[0].id,JSON.stringify({headline:'Лифт остановился между этажами'}),crypto.randomUUID(),JSON.stringify({headline:'На двери уже написано ваше имя'})]);
  }
  const defaults:Record<string,unknown>={
    realtime_enabled:true,market_enabled:true,daily_scenarios_enabled:true,building_enabled:true,support_enabled:true,readonly_mode:false,
    referral_reward_enabled:true,referral_reward_keys:1,referral_reward_trust:3,new_user_social_limit_hours:6,moderation_auto_hide_score:2
  };
  for(const [key,value] of Object.entries(defaults)) await pool.query(`INSERT INTO system_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING`,[key,JSON.stringify(value)]);
}
