import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV='test';
process.env.DATABASE_URL='postgresql://unused:unused@localhost/unused';
process.env.BOT_TOKEN='123456789:abcdefghijklmnop';
process.env.BOT_USERNAME='test_bot';
process.env.WEBHOOK_SECRET='12345678901234567890123456789012';
process.env.AUTH_MAX_AGE_SECONDS='86400';

function signedInitData(user: Record<string, unknown>): string {
  const params=new URLSearchParams({
    auth_date:String(Math.floor(Date.now()/1000)),
    query_id:'AAE-test-query',
    start_param:'ref-code',
    user:JSON.stringify(user)
  });
  const dataCheck=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN!).digest();
  params.set('hash',crypto.createHmac('sha256',secret).update(dataCheck).digest('hex'));
  return params.toString();
}

test('valid Telegram initData is accepted', async () => {
  const { validateInitData }=await import('../src/auth.js');
  const data=signedInitData({id:777,first_name:'Жилец',username:'resident'});
  assert.equal(validateInitData(data).id,777);
});

test('tampered Telegram initData is rejected', async () => {
  const { validateInitData }=await import('../src/auth.js');
  const params=new URLSearchParams(signedInitData({id:777,first_name:'Жилец'}));
  params.set('user',JSON.stringify({id:777,first_name:'Подмена'}));
  assert.throws(()=>validateInitData(params.toString()),error=>error instanceof Error && error.message==='Подпись Telegram недействительна');
});
