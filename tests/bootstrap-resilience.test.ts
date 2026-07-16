import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('public bootstrap retries transient Railway failures and preserves Telegram init data', async()=>{
  const app=await readFile('public/app.js','utf8');
  assert.match(app,/async function publicStatus\(\)/);
  assert.match(app,/for \(let attempt = 0; attempt < 4;/);
  assert.match(app,/PUBLIC_STATUS_NETWORK_ERROR/);
  assert.match(app,/PUBLIC_STATUS_UNAVAILABLE/);
  assert.match(app,/\[408, 425, 429, 500, 502, 503, 504\]/);
  assert.doesNotMatch(app,/authRetry[\s\S]{0,180}sessionStorage\.removeItem\("ef_tg_init_data"\)/);
});

test('public status is excluded from local and Redis rate limiting', async()=>{
  const server=await readFile('src/server.ts','utf8');
  assert.match(server,/allowList:\(request\)=>[\s\S]*\/api\/public-status/);
  assert.match(server,/!request\.url\.startsWith\('\/api\/'\)/);
  assert.match(server,/request\.url\.startsWith\('\/api\/public-status'\)/);
  assert.match(server,/Distributed rate limit unavailable; continuing with local limiter/);
  assert.match(server,/app\.get\('\/api\/public-status',\{config:\{rateLimit:false\}\}/);
});
