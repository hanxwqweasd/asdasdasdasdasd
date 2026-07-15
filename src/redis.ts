import crypto from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { config } from './config.js';

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;
let retryAfter = 0;
let lastError: string | null = null;

export interface RedisDiagnostic {
  configured: boolean;
  connected: boolean;
  lastError: string | null;
  retryAfter: string | null;
}

export async function getRedis(): Promise<RedisClientType | null> {
  if (!config.REDIS_URL) {
    lastError = 'REDIS_URL is not configured';
    return null;
  }
  if (client?.isReady) return client;
  if (Date.now() < retryAfter) return null;
  if (connecting) return connecting;

  connecting = (async () => {
    const next = createClient({
      url: config.REDIS_URL,
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy: false
      }
    });
    next.on('error', error => {
      lastError = error instanceof Error ? error.message : String(error);
      console.error('[redis]', lastError);
    });
    try {
      await next.connect();
      client = next as RedisClientType;
      lastError = null;
      retryAfter = 0;
      return client;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      retryAfter = Date.now() + 30_000;
      if (next.isOpen) await next.disconnect().catch(() => undefined);
      return null;
    }
  })().finally(() => { connecting = null; });

  return connecting;
}

export async function requireRedis(): Promise<RedisClientType> {
  const redis = await getRedis();
  if (!redis) throw new Error('Realtime временно недоступен: Redis не подключён');
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (client?.isOpen) await client.quit().catch(() => undefined);
  client = null;
}

export async function redisHealth(): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) return false;
    return await redis.ping() === 'PONG';
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

export function redisDiagnostic(): RedisDiagnostic {
  return {
    configured: Boolean(config.REDIS_URL),
    connected: Boolean(client?.isReady),
    lastError,
    retryAfter: retryAfter > Date.now() ? new Date(retryAfter).toISOString() : null
  };
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
