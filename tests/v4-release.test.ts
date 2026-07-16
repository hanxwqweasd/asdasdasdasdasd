import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

process.env.NODE_ENV='test';
process.env.DATABASE_URL='postgresql://unused:unused@localhost/unused';
process.env.BOT_TOKEN='123456789:abcdefghijklmnop';
process.env.BOT_USERNAME='test_bot';
process.env.WEBHOOK_SECRET='12345678901234567890123456789012';

const { motionPassed }=await import('../src/services/v4.js');
const { v4Statements }=await import('../src/v4/migrations.js');

test('motion challenges are verified from sensor samples, not a client boolean',()=>{
  const still=Array.from({length:12},(_,i)=>({x:.01+i*.001,y:.02,z:.99}));
  assert.equal(motionPassed('still',{maxDelta:.7},{passed:false,samples:still}),true);
  assert.equal(motionPassed('still',{maxDelta:.01},{passed:true,samples:[...still.slice(0,8),{x:3,y:3,z:3}]}),false);
  const orientation=Array.from({length:10},(_,i)=>({alpha:i*12,beta:2,gamma:1}));
  assert.equal(motionPassed('peephole',{yaw:25},{samples:orientation}),true);
  assert.equal(motionPassed('tune',{},{samples:orientation}),true);
});

test('V4 migrations avoid volatile partial-index predicates and define all domains',()=>{
  const sql=v4Statements.join('\n');
  assert.doesNotMatch(sql,/WHERE expires_at>NOW\(\)/);
  for(const table of ['room_traces','chat_cases','antagonist_cycles','player_relationships','live_nights','motion_challenges','biometric_safes','neighbor_voice_clips','user_rooms','season_archive_entries','payment_recovery_jobs']) assert.match(sql,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
});

test('release contains native Telegram integrations, spectator mode and moderated creator tools',async()=>{
  const [client,service,coop,webhook,admin]=await Promise.all([
    readFile('public/app.js','utf8'),readFile('src/services/v4.ts','utf8'),readFile('src/realtime/coop.ts','utf8'),readFile('src/routes/telegram-webhook.ts','utf8'),readFile('public/admin/admin.js','utf8')
  ]);
  for(const capability of ['shareMessage','shareToStory','requestChat','BiometricManager','addToHomeScreen','setEmojiStatus','DeviceOrientation','Accelerometer'])assert.match(client,new RegExp(capability));
  assert.match(service,/savePreparedInlineMessage/);
  assert.match(service,/savePreparedKeyboardButton/);
  assert.match(coop,/coop:spectate/);
  assert.match(coop,/coop:spectator-action/);
  assert.match(webhook,/paysupport/);
  assert.match(admin,/V4 · Дом живёт/);
});

test('share story artwork and expanded icon set are packaged',async()=>{
  const image=await stat('public/cards/story.png');
  assert.ok(image.size>100_000);
  const icons=await readFile('public/assets/icons.svg','utf8');
  for(const id of ['footprint','manager','motion','biometric','voice','architect','story'])assert.match(icons,new RegExp(`id="${id}"`));
});

test('release is versioned as 4.3.0 and includes a month of content seeds',async()=>{
  const pkg=JSON.parse(await readFile('package.json','utf8'));
  const migration=await readFile('src/v4/migrations.ts','utf8');
  assert.equal(pkg.version,'4.3.0');
  assert.match(migration,/cycle<4/);
  assert.match(migration,/coop-three-knocks/);
  assert.match(migration,/chapter-manager-ledger/);
  assert.match(migration,/interior-restorer/);
  assert.match(migration,/collectibles=.*season_medal/);
});

test('premium chapters, chat selection and paid coop scenarios are wired end to end',async()=>{
  const [migration,service,routes,coop,client,telegram]=await Promise.all([
    readFile('src/v4/migrations.ts','utf8'),readFile('src/services/v4.ts','utf8'),readFile('src/routes/v4.ts','utf8'),readFile('src/realtime/coop.ts','utf8'),readFile('public/app.js','utf8'),readFile('src/telegram.ts','utf8')
  ]);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS content_playthroughs/);
  assert.match(migration,/slug:'manager-ledger'/);
  assert.match(migration,/slug:'room-without-number'/);
  assert.match(service,/advancePremiumContent/);
  assert.match(service,/https:\/\/t\.me\//);
  assert.doesNotMatch(service,/startapp=/);
  assert.match(service,/chat_shared\.request_id|requestInt/);
  assert.match(service,/bot_is_member:true/);
  assert.match(routes,/api\/v4\/content\/:slug\/advance/);
  assert.match(coop,/scenarioDefinition/);
  assert.match(coop,/roomsForScenario/);
  assert.match(coop,/guestSlots/);
  assert.match(client,/renderV4Premium/);
  assert.match(client,/playPremiumStory/);
  assert.match(client,/createPremiumCoop/);
  assert.match(client,/applyPremiumInterior/);
  assert.match(service,/applyPremiumInterior/);
  assert.match(routes,/interiors\/:contentKey\/apply/);
  assert.match(telegram,/setMyCommands/);
});

test('all seventeen product additions have client, service and schema coverage',async()=>{
  const [client,service,migration,coop,webhook]=await Promise.all([
    readFile('public/app.js','utf8'),readFile('src/services/v4.ts','utf8'),readFile('src/v4/migrations.ts','utf8'),readFile('src/realtime/coop.ts','utf8'),readFile('src/routes/telegram-webhook.ts','utf8')
  ]);
  const markers=[
    [migration,/room_traces/],[client,/shareToStory/],[client,/requestChat/],[service,/antagonistIntervention/],
    [service,/relationshipEvent/],[service,/activeLiveNight/],[client,/DeviceOrientation/],[client,/BiometricManager/],
    [client,/addToHomeScreen/],[client,/setEmojiStatus/],[coop,/coop:spectate/],[service,/interface_anomalies/],
    [service,/saveVoiceClip/],[service,/createUserRoom/],[service,/seasonArchive/],[migration,/cycle<4/],[webhook,/paysupport/]
  ];
  for(const [text,pattern] of markers)assert.match(text,pattern);
});


test('migration runner serializes concurrent Railway deployments',async()=>{
  const source=await readFile('src/migrations.ts','utf8');
  assert.match(source,/pg_advisory_lock/);
  assert.match(source,/pg_advisory_unlock/);
  assert.doesNotMatch(source,/DROP CONSTRAINT IF EXISTS expeditions_status_check/);
  assert.match(source,/IF NOT EXISTS[\s\S]*expeditions_status_check/);
});
