import 'dotenv/config';
import { z } from 'zod';

function optionalEnv(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length ? normalized : undefined;
}
function encode(value: string): string { return encodeURIComponent(value); }
function connectionUrl(env: NodeJS.ProcessEnv, kind: 'postgres' | 'redis'): string | undefined {
  const candidates = kind === 'postgres'
    ? [env.DATABASE_URL, env.DATABASE_PRIVATE_URL, env.DATABASE_PUBLIC_URL, env.POSTGRES_URL, env.POSTGRESQL_URL, env.POSTGRES_DATABASE_URL]
    : [env.REDIS_URL, env.REDIS_PRIVATE_URL, env.REDIS_PUBLIC_URL, env.REDIS_TLS_URL, env.REDIS_URI, env.REDIS_CONNECTION_STRING];
  for (const candidate of candidates) { const value = optionalEnv(candidate); if (value) return value; }
  if (kind === 'redis') {
    const host=optionalEnv(env.REDISHOST)??optionalEnv(env.REDIS_HOST);
    const port=optionalEnv(env.REDISPORT)??optionalEnv(env.REDIS_PORT)??'6379';
    const user=optionalEnv(env.REDISUSER)??optionalEnv(env.REDIS_USER)??'default';
    const password=optionalEnv(env.REDISPASSWORD)??optionalEnv(env.REDIS_PASSWORD);
    if (!host) return undefined;
    return `redis://${password?`${encode(user)}:${encode(password)}@`:''}${host}:${port}`;
  }
  const host=optionalEnv(env.PGHOST)??optionalEnv(env.POSTGRES_HOST);
  const port=optionalEnv(env.PGPORT)??optionalEnv(env.POSTGRES_PORT)??'5432';
  const user=optionalEnv(env.PGUSER)??optionalEnv(env.POSTGRES_USER);
  const password=optionalEnv(env.PGPASSWORD)??optionalEnv(env.POSTGRES_PASSWORD)??'';
  const database=optionalEnv(env.PGDATABASE)??optionalEnv(env.POSTGRES_DB)??optionalEnv(env.POSTGRES_DATABASE);
  if(!host||!user||!database) return undefined;
  return `postgresql://${encode(user)}${password?`:${encode(password)}`:''}@${host}:${port}/${encode(database)}`;
}
const bool=(defaultValue:boolean)=>z.preprocess(v=>optionalEnv(v)??String(defaultValue),z.string()).transform(v=>v==='true'||v==='1');
const optionalUrl=z.preprocess(optionalEnv,z.string().url().optional());
const raw={
  ...process.env,
  DATABASE_URL:connectionUrl(process.env,'postgres'),
  REDIS_URL:connectionUrl(process.env,'redis'),
  PUBLIC_URL:optionalEnv(process.env.PUBLIC_URL),
  BOT_TOKEN:optionalEnv(process.env.BOT_TOKEN),BOT_USERNAME:optionalEnv(process.env.BOT_USERNAME),WEBHOOK_SECRET:optionalEnv(process.env.WEBHOOK_SECRET),
  ADMIN_USERNAME:optionalEnv(process.env.ADMIN_USERNAME),ADMIN_PASSWORD:optionalEnv(process.env.ADMIN_PASSWORD),ADMIN_SESSION_SECRET:optionalEnv(process.env.ADMIN_SESSION_SECRET),
  SENTRY_DSN:optionalEnv(process.env.SENTRY_DSN),METRICS_TOKEN:optionalEnv(process.env.METRICS_TOKEN),BACKUP_WEBHOOK_URL:optionalEnv(process.env.BACKUP_WEBHOOK_URL)
};
const schema=z.object({
  NODE_ENV:z.enum(['development','test','production']).default('development'),PORT:z.coerce.number().int().positive().default(8080),PUBLIC_URL:optionalUrl,
  DATABASE_URL:z.string().min(1).optional(),
  REDIS_URL:z.string().min(1).optional(),REDIS_REQUIRED_IN_PRODUCTION:bool(true),
  BOT_TOKEN:z.string().min(10),BOT_USERNAME:z.string().min(3),WEBHOOK_SECRET:z.string().min(16),AUTH_MAX_AGE_SECONDS:z.coerce.number().int().positive().default(86400),
  ALLOW_DEV_AUTH:bool(false),DEV_USER_ID:z.coerce.number().int().positive().default(10001),
  ADMIN_USERNAME:z.string().min(3).max(64).default('admin'),ADMIN_PASSWORD:z.string().min(12).max(256).optional(),ADMIN_SESSION_SECRET:z.string().min(32).optional(),ADMIN_SESSION_HOURS:z.coerce.number().int().min(1).max(168).default(24),
  BROADCAST_BATCH_SIZE:z.coerce.number().int().min(1).max(100).default(20),COOP_MATCH_TTL_SECONDS:z.coerce.number().int().min(300).max(86400).default(7200),COOP_TURN_SECONDS:z.coerce.number().int().min(20).max(300).default(75),COOP_ELEVATOR_SECONDS:z.coerce.number().int().min(180).max(3600).default(720),
  PRESENCE_TTL_SECONDS:z.coerce.number().int().min(30).max(600).default(90),IDEMPOTENCY_TTL_SECONDS:z.coerce.number().int().min(300).max(86400).default(21600),RATE_LIMIT_MAX:z.coerce.number().int().min(10).max(5000).default(180),
  SENTRY_DSN:optionalUrl,SENTRY_TRACES_SAMPLE_RATE:z.coerce.number().min(0).max(1).default(.1),ENABLE_METRICS:bool(true),METRICS_TOKEN:z.string().min(16).optional(),APP_VERSION:z.string().default('2.0.5'),
  BACKUP_ENABLED:bool(false),BACKUP_DIR:z.string().default('/backups'),BACKUP_RETENTION_DAYS:z.coerce.number().int().min(2).max(365).default(14),BACKUP_HOUR_UTC:z.coerce.number().int().min(0).max(23).default(2),PRE_MIGRATION_BACKUP:bool(false),PRE_MIGRATION_BACKUP_REQUIRED:bool(false),BACKUP_WEBHOOK_URL:optionalUrl,
  SUPPORT_SCREENSHOT_MAX_BYTES:z.coerce.number().int().min(100000).max(5000000).default(1500000),MARKET_COMMISSION_PERCENT:z.coerce.number().int().min(0).max(30).default(5),BUILDING_CAPACITY:z.coerce.number().int().min(10).max(50).default(30)
});
export type AppConfig=z.infer<typeof schema>;
let parsed:AppConfig;
try{parsed=schema.parse(raw);}catch(error){if(error instanceof z.ZodError){throw new Error(`Некорректные переменные окружения: ${error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')}`,{cause:error});}throw error;}
export const config=parsed;
