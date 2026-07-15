import { pool } from './db.js';
import { ROOM_TEMPLATES, SHOP } from './game/catalog.js';
import { runV2Migrations } from './v2/migrations.js';
import { runV4Migrations } from './v4/migrations.js';

export const migrationStatements = [
`CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  photo_url TEXT,
  language_code TEXT,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS player_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  apartment_no INTEGER NOT NULL,
  apartment_style TEXT NOT NULL DEFAULT 'tenant',
  nerve INTEGER NOT NULL DEFAULT 100 CHECK (nerve BETWEEN 0 AND 100),
  trust INTEGER NOT NULL DEFAULT 0,
  clues INTEGER NOT NULL DEFAULT 0,
  keys_count INTEGER NOT NULL DEFAULT 1,
  chapter INTEGER NOT NULL DEFAULT 1,
  intro_seen BOOLEAN NOT NULL DEFAULT FALSE,
  club_until TIMESTAMPTZ,
  stars_spent INTEGER NOT NULL DEFAULT 0,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS inventory (
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, item_id)
)`,
`CREATE TABLE IF NOT EXISTS apartment_items (
  id UUID PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 11),
  rotation INTEGER NOT NULL DEFAULT 0,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, slot)
)`,
`CREATE TABLE IF NOT EXISTS expeditions (
  id UUID PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  seed INTEGER NOT NULL,
  room_index INTEGER NOT NULL DEFAULT 0,
  state JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','escaped','lost','cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
)`,
`ALTER TABLE expeditions DROP CONSTRAINT IF EXISTS expeditions_status_check`,
`ALTER TABLE expeditions ADD CONSTRAINT expeditions_status_check CHECK (status IN ('active','escaped','lost','cancelled'))`,
`CREATE UNIQUE INDEX IF NOT EXISTS one_active_expedition_per_user ON expeditions(user_id) WHERE status='active'`,
`CREATE TABLE IF NOT EXISTS building_events (
  event_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL,
  active_from TIMESTAMPTZ NOT NULL,
  active_until TIMESTAMPTZ NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS neighbor_notes (
  id UUID PRIMARY KEY,
  author_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  target_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
  mood TEXT NOT NULL DEFAULT 'neutral',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars > 0),
  status TEXT NOT NULL CHECK (status IN ('pending','paid','cancelled','refunded')),
  telegram_charge_id TEXT UNIQUE,
  provider_charge_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ
)`,
`CREATE TABLE IF NOT EXISTS entitlements (
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  entitlement_key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id, entitlement_key)
)`,
`CREATE TABLE IF NOT EXISTS referral_rewards (
  inviter_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  invited_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rewarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS user_moderation (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  banned BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  banned_until TIMESTAMPTZ,
  banned_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin','manager','operator','moderator','content','analyst')),
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  session_version INTEGER NOT NULL DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE UNIQUE INDEX IF NOT EXISTS admins_username_lower_idx ON admins(lower(username))`,
`CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log(created_at DESC)`,
`CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS game_rooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  ambience TEXT NOT NULL,
  accent TEXT NOT NULL,
  choices JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS shop_products (
  sku TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars > 0),
  icon TEXT NOT NULL DEFAULT '✦',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  grant_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS purchase_fulfillments (
  purchase_id UUID PRIMARY KEY REFERENCES purchases(id) ON DELETE CASCADE,
  grants JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
)`,
`CREATE TABLE IF NOT EXISTS seasons (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','archived')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  button_text TEXT,
  button_url TEXT,
  audience JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('draft','queued','running','paused','completed','cancelled')),
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
)`,
`CREATE TABLE IF NOT EXISTS broadcast_deliveries (
  broadcast_id UUID REFERENCES broadcasts(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','failed')) DEFAULT 'pending',
  error TEXT,
  sent_at TIMESTAMPTZ,
  PRIMARY KEY(broadcast_id,user_id)
)`,
`CREATE INDEX IF NOT EXISTS broadcast_pending_idx ON broadcast_deliveries(broadcast_id,status)`,
`CREATE INDEX IF NOT EXISTS users_created_idx ON users(created_at DESC)`,
`CREATE INDEX IF NOT EXISTS profiles_last_seen_idx ON player_profiles(last_seen DESC)`,
`CREATE INDEX IF NOT EXISTS purchases_created_idx ON purchases(created_at DESC)`,
`CREATE INDEX IF NOT EXISTS expeditions_started_idx ON expeditions(started_at DESC)`
];

export const seedEventSql = `INSERT INTO building_events(event_key,title,body,severity,active_from,active_until)
    VALUES ('power_flicker','В доме мигает свет','Электрик просит не пользоваться лифтом в одиночку. На восьмом этаже открылись двери, которых вчера не было.','warning',NOW(),NOW()+INTERVAL '7 days')
    ON CONFLICT (event_key) DO UPDATE SET active_until=GREATEST(building_events.active_until, NOW()+INTERVAL '1 day')`;

const grants: Record<string, unknown> = {
  blackout_ticket:{inventory:[{itemId:'blackout_ticket',quantity:1}]},
  archive_case:{inventory:[{itemId:'archive_stamp',quantity:3},{itemId:'cassette',quantity:1}]},
  restorer_pack:{inventory:[{itemId:'plant_fern',quantity:1},{itemId:'radio',quantity:1}],profile:{apartmentStyle:'restorer'}},
  residents_club:{clubDays:30,entitlements:[{key:'residents_club',value:{active:true}}]}
};

async function seedContent(): Promise<void> {
  for(const [index,room] of ROOM_TEMPLATES.entries()) {
    await pool.query(`INSERT INTO game_rooms(id,title,description,ambience,accent,choices,enabled,sort_order)
      VALUES($1,$2,$3,$4,$5,$6,TRUE,$7) ON CONFLICT(id) DO NOTHING`,
      [room.id,room.title,room.description,room.ambience,room.accent,JSON.stringify(room.choices),index]);
  }
  for(const [index,item] of SHOP.entries()) {
    await pool.query(`INSERT INTO shop_products(sku,title,description,stars,icon,active,grant_config,sort_order)
      VALUES($1,$2,$3,$4,$5,TRUE,$6,$7) ON CONFLICT(sku) DO NOTHING`,
      [item.sku,item.title,item.description,item.stars,item.icon,JSON.stringify(grants[item.sku] ?? {}),index]);
  }
  const defaults: Record<string,unknown>={maintenance_mode:false,maintenance_message:'Дом временно закрыт. Лифт снова откроется позже.',expeditions_enabled:true,notes_enabled:true,shop_enabled:true,max_expedition_rooms:6};
  for(const [key,value] of Object.entries(defaults)) await pool.query(`INSERT INTO system_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING`,[key,JSON.stringify(value)]);
}

export async function runMigrations(): Promise<void> {
  for (const sql of migrationStatements) await pool.query(sql);
  await pool.query(seedEventSql);
  await seedContent();
  await runV2Migrations();
  await runV4Migrations();
}
