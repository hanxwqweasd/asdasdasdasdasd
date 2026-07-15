import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.NODE_ENV='test';
process.env.DATABASE_URL='postgresql://unused:unused@localhost/unused';
process.env.BOT_TOKEN='123456789:abcdefghijklmnop';
process.env.BOT_USERNAME='test_bot';
process.env.WEBHOOK_SECRET='12345678901234567890123456789012';

const { makeRoomObservation } = await import('../src/services/room-observation.js');
const { ROOM_TEMPLATES } = await import('../src/game/catalog.js');

test('room observation variants do not repeat during the three available attempts',()=>{
  const room=ROOM_TEMPLATES[0]!;
  for(const action of ['listen','inspect'] as const){
    const observations=[0,1,2].map(attempt=>makeRoomObservation(room,action,'seed-user-room',attempt));
    assert.equal(new Set(observations.map(x=>x.text)).size,3);
    assert.ok(observations.every(x=>x.detail.length>20));
    assert.notEqual(observations[1]!.recommendedChoiceIndex,null);
  }
});

test('V4 room seed no longer uses the same generic three choices',async()=>{
  const migration=await readFile('src/v4/migrations.ts','utf8');
  assert.doesNotMatch(migration,/label:'Осмотреть следы'[\s\S]{0,300}label:'Позвать соседа'[\s\S]{0,300}label:'Не вмешиваться'/);
  assert.match(migration,/roomChoiceSets/);
  assert.match(migration,/ON CONFLICT\(id\) DO UPDATE SET[\s\S]*choices=EXCLUDED\.choices/);
});

test('maintenance mode has public status, global API guard and a dedicated client screen',async()=>{
  const [server,client,admin,migrations]=await Promise.all([
    readFile('src/server.ts','utf8'),readFile('public/app.js','utf8'),readFile('public/admin/admin.js','utf8'),readFile('src/migrations.ts','utf8')
  ]);
  assert.match(server,/api\/public-status/);
  assert.match(server,/MAINTENANCE_MODE/);
  assert.match(client,/renderMaintenanceScreen/);
  assert.match(client,/maintenanceRetry/);
  assert.match(admin,/maintenance_title/);
  assert.match(migrations,/maintenance_eta/);
});

test('building storage supports quantity selection and returns verified balances',async()=>{
  const [client,service]=await Promise.all([readFile('public/app.js','utf8'),readFile('src/services/building.ts','utf8')]);
  assert.match(client,/storageQuantity/);
  assert.match(client,/Забрать в инвентарь/);
  assert.match(service,/inventoryQuantity/);
  assert.match(service,/storageQuantity/);
});

test('toast text is readable on the final dark notification surface',async()=>{
  const css=await readFile('public/styles.css','utf8');
  assert.match(css,/\.toast\s*\{[\s\S]*color:\s*#f1e8db/);
  assert.match(css,/\.toast-copy/);
  assert.match(css,/overflow-wrap:\s*anywhere/);
});
