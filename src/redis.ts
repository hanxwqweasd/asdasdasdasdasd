import crypto from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { config } from './config.js';

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;

export async function getRedis(): Promise<RedisClientType | null> {
  if (!config.REDIS_URL) return null;
  if (client?.isReady) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    const next = createClient({ url: config.REDIS_URL });
    next.on('error', error => console.error('[redis]', error));
    await next.connect();
    client = next as RedisClientType;
    return client;
  })().finally(() => { connecting = null; });
  return connecting;
}

export async function requireRedis(): Promise<RedisClientType> {
  const redis = await getRedis();
  if (!redis) throw new Error('REDIS_URL is required for this feature');
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (client?.isOpen) await client.quit();
  client = null;
}

export async function redisHealth(): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) return false;
    return await redis.ping() === 'PONG';
  } catch {
    return false;
  }
}

export async function withRedisLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const redis = await getRedis();
  if (!redis) return fn();
  const token = crypto.randomUUID();
  const acquired = await redis.set(`lock:${key}`, token, { NX: true, PX: ttlMs });
  if (!acquired) return null;
  try {
    return await fn();
  } finally {
    await redis.eval(
      "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
      { keys: [`lock:${key}`], arguments: [token] }
    ).catch(() => undefined);
  }
}
