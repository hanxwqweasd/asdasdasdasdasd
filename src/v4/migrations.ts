import crypto from 'node:crypto';
import { pool } from '../db.js';

export const v4Statements = [
`ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS install_prompted_at TIMESTAMPTZ`,
`ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS home_screen_added_at TIMESTAMPTZ`,
`ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS emoji_status_access BOOLEAN NOT NULL DEFAULT FALSE`,
`ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS relationship_score INTEGER NOT NULL DEFAULT 0`,
`CREATE TABLE IF NOT EXISTS room_traces (
 id UUID PRIMARY KEY, room_id TEXT NOT NULL, user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 trace_type TEXT NOT NULL CHECK(trace_type IN ('silhouette','sound','message','object','camera','warning')),
 payload JSONB NOT NULL DEFAULT '{}'::jsonb, visibility TEXT NOT NULL DEFAULT 'anonymous',
 expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '30 days', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE INDEX IF NOT EXISTS room_traces_room_idx ON room_traces(room_id,created_at DESC)`,
`CREATE TABLE IF NOT EXISTS share_cards (
 id UUID PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT NOT NULL, facts JSONB NOT NULL DEFAULT '[]'::jsonb,
 prepared_message_id TEXT, expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '24 hours', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS chat_cases (
 id UUID PRIMARY KEY, owner_id BIGINT REFERENCES users(id) ON DELETE CASCADE, request_id TEXT UNIQUE,
 chat_id BIGINT, chat_title TEXT, invite_code TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('preparing','active','completed','expired')) DEFAULT 'preparing',
 scenario_key TEXT NOT NULL DEFAULT 'missing-tenant', state JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '7 days', completed_at TIMESTAMPTZ
)`,
`CREATE TABLE IF NOT EXISTS chat_case_members (
 case_id UUID REFERENCES chat_cases(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 role_key TEXT NOT NULL, clues JSONB NOT NULL DEFAULT '[]'::jsonb, joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(case_id,user_id)
)`,
`CREATE TABLE IF NOT EXISTS antagonist_cycles (
 id UUID PRIMARY KEY, building_id UUID REFERENCES buildings(id) ON DELETE CASCADE, week_start DATE NOT NULL,
 antagonist_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, mode TEXT NOT NULL CHECK(mode IN ('system','player')),
 state JSONB NOT NULL DEFAULT '{}'::jsonb, status TEXT NOT NULL DEFAULT 'active', UNIQUE(building_id,week_start)
)`,
`CREATE TABLE IF NOT EXISTS player_relationships (
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, other_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 trust INTEGER NOT NULL DEFAULT 0, debt INTEGER NOT NULL DEFAULT 0, rescues INTEGER NOT NULL DEFAULT 0, abandonments INTEGER NOT NULL DEFAULT 0,
 labels JSONB NOT NULL DEFAULT '[]'::jsonb, secrets JSONB NOT NULL DEFAULT '[]'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(user_id,other_user_id), CHECK(user_id<>other_user_id)
)`,
`CREATE TABLE IF NOT EXISTS live_nights (
 id UUID PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
 phase TEXT NOT NULL DEFAULT 'scheduled', global_target INTEGER NOT NULL DEFAULT 1000, global_progress INTEGER NOT NULL DEFAULT 0,
 config JSONB NOT NULL DEFAULT '{}'::jsonb, result JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS live_night_contributions (
 night_id UUID REFERENCES live_nights(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 building_id UUID REFERENCES buildings(id) ON DELETE SET NULL, contribution INTEGER NOT NULL DEFAULT 0,
 fragments JSONB NOT NULL DEFAULT '[]'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(night_id,user_id)
)`,
`CREATE TABLE IF NOT EXISTS motion_challenges (
 id UUID PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, challenge_type TEXT NOT NULL,
 target JSONB NOT NULL, fallback_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', expires_at TIMESTAMPTZ NOT NULL,
 result JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS biometric_safes (
 user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, device_id TEXT, token_hash TEXT,
 recovery_code_hash TEXT NOT NULL, secret_payload JSONB NOT NULL DEFAULT '{}'::jsonb, unlocked_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS emoji_status_catalog (
 key TEXT PRIMARY KEY, title TEXT NOT NULL, custom_emoji_id TEXT, duration_seconds INTEGER, unlock_rule JSONB NOT NULL DEFAULT '{}'::jsonb, active BOOLEAN NOT NULL DEFAULT TRUE
)`,
`CREATE TABLE IF NOT EXISTS interface_anomalies (
 id UUID PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, anomaly_type TEXT NOT NULL,
 payload JSONB NOT NULL DEFAULT '{}'::jsonb, starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ends_at TIMESTAMPTZ NOT NULL, acknowledged_at TIMESTAMPTZ
)`,
`CREATE TABLE IF NOT EXISTS neighbor_voice_clips (
 id UUID PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, phrase_key TEXT NOT NULL,
 mime_type TEXT NOT NULL, audio BYTEA NOT NULL, duration_ms INTEGER NOT NULL, consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','deleted')) DEFAULT 'pending', moderator_id UUID REFERENCES admins(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ
)`,
`CREATE TABLE IF NOT EXISTS user_rooms (
 id UUID PRIMARY KEY, author_id BIGINT REFERENCES users(id) ON DELETE CASCADE, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 template JSONB NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','review','published','rejected','archived')) DEFAULT 'draft',
 plays INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, moderation_note TEXT, published_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS user_room_reviews (
 room_id UUID REFERENCES user_rooms(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 liked BOOLEAN NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(room_id,user_id)
)`,
`CREATE TABLE IF NOT EXISTS season_archive_entries (
 id UUID PRIMARY KEY, season_id UUID REFERENCES seasons(id) ON DELETE CASCADE, entry_date DATE NOT NULL, entry_type TEXT NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL, media JSONB NOT NULL DEFAULT '{}'::jsonb, community_result JSONB NOT NULL DEFAULT '{}'::jsonb,
 sort_order INTEGER NOT NULL DEFAULT 0, published BOOLEAN NOT NULL DEFAULT TRUE
)`,
`CREATE TABLE IF NOT EXISTS player_archive_memories (
 entry_id UUID REFERENCES season_archive_entries(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 personal_state JSONB NOT NULL DEFAULT '{}'::jsonb, discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(entry_id,user_id)
)`,
`CREATE TABLE IF NOT EXISTS payment_recovery_jobs (
 id UUID PRIMARY KEY, purchase_id UUID REFERENCES purchases(id) ON DELETE CASCADE, job_type TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(purchase_id,job_type)
)`,
`CREATE TABLE IF NOT EXISTS payment_support_requests (
 id UUID PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
 body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ
)`,
`CREATE TABLE IF NOT EXISTS content_inventory (
 content_key TEXT PRIMARY KEY, content_type TEXT NOT NULL, title TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, active BOOLEAN NOT NULL DEFAULT TRUE
)`,
`CREATE TABLE IF NOT EXISTS content_playthroughs (
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, slug TEXT NOT NULL, current_node_id TEXT NOT NULL, choices JSONB NOT NULL DEFAULT '[]'::jsonb,
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ, PRIMARY KEY(user_id,slug)
)`
];

const roomThemes = [
 ['boiler','Котельная с чужими часами','Трубы стучат в ритме чьего-то пульса.'],['mail','Почтовая комната','Письма подписаны именами ещё не заселившихся людей.'],['atelier','Закрытое ателье','Манекены повторяют позы жильцов.'],['cinema','Кинозал без экрана','Проектор показывает только тени зрителей.'],['clinic','Комната дежурной','Карточка пациента заполнена вашим почерком.'],['library','Библиотека лестниц','Книги открываются на плане дома.'],['coldroom','Холодная кладовая','Иней складывается в номера квартир.'],['workshop','Мастерская звонков','На столе разобраны десятки домофонов.'],['clock','Часовая комната','Все часы показывают 00:08, кроме одного.'],['balcony','Балкон внутрь дома','За перилами видны окна соседей изнутри.'],['registry','Регистратура жильцов','В журнале ваша подпись стоит рядом с датой исчезновения.'],['wardrobe','Гардероб забытых пальто','В карманах лежат ключи от несуществующих дверей.']
] as const;

async function seedV4Content(){
  let order=100;
  for(let cycle=0;cycle<4;cycle++)for(const [base,title,description] of roomThemes){
    const id=`v4-${base}-${cycle+1}`;
    const choices=[
      {label:'Осмотреть следы',outcome:'Дом оставил вам фрагмент чужого маршрута.',effects:{clues:1,danger:4},tags:['trace']},
      {label:'Позвать соседа',outcome:'Ответ пришёл из стены, а не из телефона.',effects:{nerve:-3,clues:2},tags:['relationship']},
      {label:'Не вмешиваться',outcome:'Комната запомнила ваше молчание.',effects:{danger:-3,noise:2},tags:['silence']}
    ];
    await pool.query(`INSERT INTO game_rooms(id,title,description,ambience,accent,choices,enabled,sort_order) VALUES($1,$2,$3,$4,$5,$6,TRUE,$7) ON CONFLICT(id) DO NOTHING`,[id,`${title} · ${cycle+1}`,description,['pipes','wind','camera','voices'][cycle]??'wind',['#80664f','#61716e','#765d66','#806f4d'][cycle]??'#80664f',JSON.stringify(choices),order++]);
  }
  const collectibles=['door_plate_8','old_newspaper','red_cassette','tenant_card','glass_key','service_badge','elevator_token','photo_negative','radio_coil','manager_stamp','blue_wallpaper','archive_ribbon','broken_bell','floor_map','window_handle','watch_0008','tenant_receipt','black_envelope','camera_reel','brass_number','service_key','green_lamp','mirror_shard','cold_coin','visitor_pass','boiler_tag','mail_stamp','stair_ticket','attic_thread','silent_record','door_chain','electric_label','old_switch','caretaker_note','rain_photo','lift_button','tenant_pin','ledger_page','room_sketch','season_medal'];
  for(const key of collectibles)await pool.query(`INSERT INTO content_inventory(content_key,content_type,title,metadata) VALUES($1,'collectible',$2,$3) ON CONFLICT DO NOTHING`,[key,key.split('_').map(x=>x[0]?.toUpperCase()+x.slice(1)).join(' '),JSON.stringify({rarity:key.includes('season')?'seasonal':'uncommon'})]);
  const releaseContent=[
    ['coop-three-knocks','coop_case','Три стука',{durationMinutes:35,guestSlots:2,rooms:['mail','registry','wardrobe']}],
    ['coop-silent-lift','coop_case','Молчаливый лифт',{durationMinutes:40,guestSlots:2,rooms:['clock','workshop','cinema']}],
    ['coop-last-tenant','coop_case','Последний жилец',{durationMinutes:55,guestSlots:2,rooms:['clinic','balcony','archive']}],
    ['chapter-manager-ledger','story_chapter','Журнал Управляющего',{durationMinutes:55,scenes:14,voiceScenes:4}],
    ['chapter-room-without-number','story_chapter','Квартира без номера',{durationMinutes:50,scenes:12,voiceScenes:3}],
    ['interior-restorer','interior','Квартира реставратора',{objects:18,audioScene:'workshop'}],
    ['interior-radio','interior','Комната радиолюбителя',{objects:16,audioScene:'radio'}],
    ['interior-darkroom','interior','Старая фотолаборатория',{objects:20,audioScene:'camera'}]
  ];
  for(const [key,type,title,metadata] of releaseContent)await pool.query(`INSERT INTO content_inventory(content_key,content_type,title,metadata) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[key,type,title,JSON.stringify(metadata)]);
  const premiumProducts=[
    ['three_knocks_case','Три стука','Кооперативное дело для владельца и двух друзей.',99,'⌁','coop_chapter',{entitlements:[{key:'coop:three-knocks',value:{guestSlots:2}}]},['35 минут','2 гостевых места','Разные подсказки'],2],
    ['silent_lift_case','Молчаливый лифт','История, где голосование проходит без слов.',109,'▥','coop_chapter',{entitlements:[{key:'coop:silent-lift',value:{guestSlots:2}}]},['40 минут','2 гостевых места','Режим тишины'],2],
    ['last_tenant_case','Последний жилец','Большое дело для компании с несколькими концовками.',139,'⌂','coop_chapter',{entitlements:[{key:'coop:last-tenant',value:{guestSlots:2}}]},['55 минут','2 гостевых места','4 финала'],2],
    ['manager_ledger_chapter','Журнал Управляющего','Полная сюжетная глава с озвученными сценами.',119,'▤','chapter',{entitlements:[{key:'chapter:manager-ledger',value:{unlocked:true}}]},['14 сцен','4 аудиосцены','Архивный предмет'],0],
    ['room_without_number_chapter','Квартира без номера','Полная глава о двери, которой нет на плане.',109,'▧','chapter',{entitlements:[{key:'chapter:room-without-number',value:{unlocked:true}}]},['12 сцен','3 аудиосцены','Редкая табличка'],0],
    ['restorer_interior','Квартира реставратора','Авторский интерьер с интерактивными объектами.',89,'⌂','interior',{profile:{apartmentStyle:'restorer'},entitlements:[{key:'interior:restorer',value:{unlocked:true}}]},['18 объектов','Звуковая сцена','Особое освещение'],0],
    ['radio_interior','Комната радиолюбителя','Интерьер с рабочим радиостолом и сигналами.',99,'⌁','interior',{profile:{apartmentStyle:'radio'},entitlements:[{key:'interior:radio',value:{unlocked:true}}]},['16 объектов','Радиоритуал','Редкие сигналы'],0],
    ['darkroom_interior','Старая фотолаборатория','Тёмная комната с проявкой скрытых снимков.',99,'◫','interior',{profile:{apartmentStyle:'darkroom'},entitlements:[{key:'interior:darkroom',value:{unlocked:true}}]},['20 объектов','Проявка фото','Красный свет'],0]
  ];
  for(const [sku,title,description,stars,icon,type,grant,contents,guestSlots] of premiumProducts)await pool.query(`INSERT INTO shop_products(sku,title,description,stars,icon,product_type,grant_config,full_contents,guest_slots,active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,80) ON CONFLICT(sku) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,stars=EXCLUDED.stars,icon=EXCLUDED.icon,product_type=EXCLUDED.product_type,grant_config=EXCLUDED.grant_config,full_contents=EXCLUDED.full_contents,guest_slots=EXCLUDED.guest_slots,active=TRUE`,[sku,title,description,stars,icon,type,JSON.stringify(grant),JSON.stringify(contents),guestSlots]);
  const chapterDefinitions=[
    {slug:'manager-ledger',title:'Журнал Управляющего',estimatedMinutes:55,scenes:[
      ['Журнал на подоконнике','Переплёт сухой, хотя по стеклу идёт дождь. На первой странице записан номер вашей квартиры.'],
      ['Список отсутствующих','В журнале перечислены жильцы, которых соседи продолжают встречать по утрам.'],
      ['Красная правка','Чужая рука вычеркнула восьмой этаж, но продавила бумагу ещё на семь страниц.'],
      ['Комната председателя','Печать дома лежит рядом с фотографией человека без лица.'],
      ['Запись 00:08','Каждую субботу Управляющий отмечал, какой подъезд первым выключил свет.'],
      ['Неполный договор','Последняя страница договора обещает жильцу квартиру в обмен на одно чужое имя.'],
      ['Телефон без провода','Аппарат звонит, когда вы читаете собственную фамилию.'],
      ['Четыре ключа','Три ключа открывают двери. Четвёртый открывает запись в реестре.'],
      ['Подпись консьержа','Подпись совпадает с вашей, но сделана за много лет до заселения.'],
      ['Ложное собрание','В протоколе указано, что все жильцы единогласно выбрали Управляющего.'],
      ['Служебный коридор','За архивным шкафом находится проход к обратной стороне квартирных дверей.'],
      ['Имя без квартиры','Управляющий зарегистрирован в доме, но номер его квартиры оставлен пустым.'],
      ['Последняя правка','Вы можете вернуть имя в реестр или оставить пустую строку для следующего жильца.'],
      ['Печать дома','Журнал закрывается сам. В кармане остаётся тяжёлая латунная печать.']
    ]},
    {slug:'room-without-number',title:'Квартира без номера',estimatedMinutes:50,scenes:[
      ['Дверь между квартирами','Между 47-й и 48-й появилась узкая дверь без таблички. Соседи утверждают, что она была всегда.'],
      ['Прихожая наоборот','Крючки висят внутри стены, а мокрые следы начинаются у потолка.'],
      ['Чужой календарь','Все дни зачёркнуты, кроме сегодняшнего. Возле даты написано ваше имя.'],
      ['Комната ожидания','На стульях лежат вещи жильцов, которые ещё не заходили сюда.'],
      ['Окно в подъезд','За стеклом виден ваш коридор, но по нему проходит человек в вашей одежде.'],
      ['Номер под обоями','Под каждым слоем обоев находится новая табличка с другим номером квартиры.'],
      ['Кухонный звонок','Телефон просит назвать адрес, но не принимает ни один существующий этаж.'],
      ['Семейная фотография','На снимке незнакомая семья держит ключ от вашей квартиры.'],
      ['Запертая спальня','Изнутри кто-то повторяет решения, которые вы ещё не приняли.'],
      ['План эвакуации','На плане эта квартира обозначена как выход из дома, а лестница — как тупик.'],
      ['Выбор номера','Можно вернуть двери старый номер или оставить квартиру без адреса.'],
      ['Латунная табличка','После закрытия дверь исчезает. На ладони остаётся табличка без цифр.']
    ]}
  ];
  await pool.query(`INSERT INTO entitlements(user_id,entitlement_key,value)
    SELECT user_id,'interior:'||apartment_style,jsonb_build_object('unlocked',TRUE,'backfilled',TRUE)
    FROM player_profiles WHERE apartment_style IN ('restorer','radio','darkroom')
    ON CONFLICT(user_id,entitlement_key) DO NOTHING`);
  for(const chapter of chapterDefinitions){
    const nodes=chapter.scenes.map(([title,text],index)=>({id:`scene-${index+1}`,type:index===chapter.scenes.length-1?'ending':'scene',title,text,x:80+index*180,y:80+(index%2)*90,config:{audio:index%4===0?'whisper':index%3===0?'pipes':'floor-ambience',rewards:index===chapter.scenes.length-1?{collectible:chapter.slug==='manager-ledger'?'manager_stamp':'brass_number'}:{}}}));
    const edges=chapter.scenes.slice(0,-1).map((_,index)=>({id:`edge-${index+1}`,from:`scene-${index+1}`,to:`scene-${index+2}`,label:index%3===0?'Продолжить и не оглядываться':index%3===1?'Проверить запись':'Открыть следующую дверь',condition:{}}));
    const graph={startNodeId:'scene-1',nodes,edges,metadata:{estimatedMinutes:chapter.estimatedMinutes,release:'4.0.0'}};
    let doc=(await pool.query(`SELECT id FROM content_documents WHERE slug=$1`,[chapter.slug])).rows[0];
    if(!doc){const id=crypto.randomUUID();await pool.query(`INSERT INTO content_documents(id,slug,content_type,title,status,current_draft_version,published_version,test_audience) VALUES($1,$2,'story_chapter',$3,'published',1,1,'{}')`,[id,chapter.slug,chapter.title]);await pool.query(`INSERT INTO content_versions(document_id,version,graph,change_note) VALUES($1,1,$2,'Релизная сюжетная глава')`,[id,JSON.stringify(graph)]);doc={id};}
  }
  for(const [key,title] of [['key','Ключ подъезда'],['eye','Наблюдатель'],['cassette','Хранитель кассет'],['electric','Электрик'],['archive','Архивист']])await pool.query(`INSERT INTO emoji_status_catalog(key,title,unlock_rule) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[key,title,JSON.stringify({achievement:key})]);
  const season=await pool.query(`SELECT id FROM seasons WHERE slug='house-awakening'`);
  let seasonId=season.rows[0]?.id;
  if(!seasonId){seasonId=crypto.randomUUID();await pool.query(`INSERT INTO seasons(id,slug,title,description,status,starts_at,metadata) VALUES($1,'house-awakening','Дом просыпается','Первый архивный сезон дома.','active',NOW(),$2)`,[seasonId,JSON.stringify({chapterCount:2})]);}
  const entries=[['arrival','Первое заселение','Лифт впервые остановился между седьмым и девятым этажами.'],['blackout','Ночь без света','Все подъезды услышали один и тот же звонок.'],['manager','Запись Управляющего','В реестре появился человек без квартиры.']];
  for(let i=0;i<entries.length;i++){const [type,title,body]=entries[i]!;await pool.query(`INSERT INTO season_archive_entries(id,season_id,entry_date,entry_type,title,body,sort_order) SELECT $1,$2,CURRENT_DATE-$3::int,$4,$5,$6,$7 WHERE NOT EXISTS(SELECT 1 FROM season_archive_entries WHERE season_id=$2 AND entry_type=$4)`,[crypto.randomUUID(),seasonId,entries.length-i,type,title,body,i]);}
}

export async function runV4Migrations(){for(const sql of v4Statements)await pool.query(sql);await seedV4Content();}
