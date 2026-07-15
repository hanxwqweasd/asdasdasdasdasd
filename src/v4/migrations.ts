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

const roomChoiceSets: Record<string, Array<Array<{label:string;outcome:string;effects:Record<string,number|string>;requires?:string;tags?:string[]}>>> = {
  boiler: [
    [{label:'Сбросить давление в левом контуре',outcome:'Пар обнажил схему технического прохода.',effects:{danger:-8,clues:2}},{label:'Проверить часы на коллекторе',outcome:'Одна стрелка указала на запертую дверь.',effects:{nerve:-5,clues:2}},{label:'Перекрыть трубу с четвёртым ударом',outcome:'Стук прекратился, но переместился под пол.',effects:{danger:7,noise:-5}}],
    [{label:'Приложить радио к трубе',outcome:'В помехах прозвучал код служебного лифта.',effects:{clues:3,noise:5},requires:'radio'},{label:'Снять бирку с клапана',outcome:'На обороте оказалась фамилия пропавшего жильца.',effects:{clues:2,danger:6}},{label:'Открыть аварийный слив',outcome:'Вода ушла в щель, которой секунду назад не было.',effects:{danger:-4,nerve:-7}}],
    [{label:'Совместить ритм труб с часами',outcome:'Механизм щёлкнул и открыл узкую нишу.',effects:{clues:3,danger:4}},{label:'Погасить горелку',outcome:'В темноте проявилась разметка на полу.',effects:{nerve:-8,danger:-9},tags:['light']},{label:'Отметить безопасный вентиль мелом',outcome:'Метка появилась на другой стороне стены.',effects:{clues:1,danger:-6},requires:'chalk'}],
    [{label:'Запустить резервный насос',outcome:'Лифт ответил снизу двумя короткими звонками.',effects:{keys:1,danger:10}},{label:'Вынуть застрявшую табличку',outcome:'Металл оказался тёплым и сохранил отпечаток пальца.',effects:{clues:2,nerve:-5}},{label:'Уйти по сервисной лестнице',outcome:'Лестница вернула вас к той же трубе, но шум стал тише.',effects:{danger:-10,noise:-8}}]
  ],
  mail: [
    [{label:'Сверить даты на конвертах',outcome:'Три письма отправлены из завтрашнего дня.',effects:{clues:3,nerve:-4}},{label:'Открыть ящик без номера',outcome:'Внутри лежит ключ от квартиры соседа.',effects:{item:'spare_key',itemQty:1,danger:9}},{label:'Подменить обратный адрес',outcome:'Письмо исчезло, а на руке проступил новый номер.',effects:{danger:5,nerve:-8}}],
    [{label:'Просветить письмо вспышкой',outcome:'Между строк проявился план коридора.',effects:{clues:2,danger:3}},{label:'Поставить архивную печать',outcome:'Конверт сам открылся и выпустил холодный воздух.',effects:{clues:3,nerve:-5},requires:'archive_stamp'},{label:'Вернуть письмо отправителю',outcome:'Ящик захлопнулся, а шаги за стеной отдалились.',effects:{danger:-10,noise:2}}],
    [{label:'Собрать порванную записку',outcome:'Текст предупреждает о следующей комнате.',effects:{clues:3,nerve:-3}},{label:'Позвонить по номеру на квитанции',outcome:'Ответил домофон вашей квартиры.',effects:{noise:12,danger:8}},{label:'Спрятать письмо в чужой ящик',outcome:'На доске жильцов изменилось одно имя.',effects:{danger:-2,nerve:-9}}],
    [{label:'Снять почтовый штемпель',outcome:'Под ним обнаружился знак Управляющего.',effects:{clues:2,item:'black_thread',itemQty:1}},{label:'Оставить запасной ключ в ящике',outcome:'Кто-то в доме получил короткий путь домой.',effects:{danger:-12,clues:1},requires:'spare_key'},{label:'Запереть все ящики одновременно',outcome:'Один из них продолжил открываться изнутри.',effects:{danger:8,noise:5}}]
  ],
  atelier: [
    [{label:'Распороть зашитый карман',outcome:'В подкладке нашлась металлическая табличка.',effects:{clues:2,danger:7}},{label:'Повернуть манекены к стене',outcome:'Один из них продолжил смотреть на вас в зеркале.',effects:{nerve:-10,danger:-3}},{label:'Проследить за чёрной нитью',outcome:'Нить привела к узкой двери за ширмой.',effects:{clues:3,noise:3}}],
    [{label:'Надеть пальто с вашим именем',outcome:'На секунду вы увидели комнату глазами прошлого владельца.',effects:{clues:3,nerve:-12}},{label:'Срезать бирку ножницами',outcome:'На обратной стороне записан код лифта.',effects:{keys:1,danger:5}},{label:'Завести швейную машину',outcome:'Строчка сложилась в слово «БЕГИ».',effects:{danger:12,noise:15}}],
    [{label:'Закрыть зеркало тканью',outcome:'Отражение осталось снаружи и указало на пол.',effects:{danger:-7,clues:2}},{label:'Сфотографировать выкройку',outcome:'На снимке появился силуэт скрытого жильца.',effects:{item:'torn_photo',itemQty:1,clues:1}},{label:'Спрятаться за ширмой',outcome:'Мимо прошёл человек в вашей одежде.',effects:{nerve:-9,danger:-5}}],
    [{label:'Собрать ключи из карманов',outcome:'Только один ключ не отражается в зеркале.',effects:{item:'brass_key',itemQty:1,danger:9}},{label:'Переставить манекен к двери',outcome:'Он удержал дверь, пока коридор менялся.',effects:{danger:-11,noise:4}},{label:'Обрезать все чёрные нити',outcome:'Где-то одновременно закрылись несколько квартир.',effects:{clues:4,danger:14},requires:'black_thread'}]
  ],
  cinema: [
    [{label:'Остановить плёнку на восьмом кадре',outcome:'Кадр показал дверь за вашей спиной.',effects:{clues:3,nerve:-6}},{label:'Сесть в тёплое кресло',outcome:'На экране началась запись вашего следующего шага.',effects:{danger:8,clues:2}},{label:'Выключить проектор',outcome:'Тени зрителей остались на экране.',effects:{danger:-5,nerve:-8}}],
    [{label:'Перемотать аплодисменты назад',outcome:'Среди шума прозвучало имя Управляющего.',effects:{clues:3,noise:8}},{label:'Проверить аппаратную',outcome:'В монтажном листе вычеркнут восьмой эпизод.',effects:{clues:2,danger:6}},{label:'Открыть аварийный выход',outcome:'За дверью оказался тот же зал, но без кресел.',effects:{nerve:-8,danger:-4}}],
    [{label:'Снять плёнку с проектора',outcome:'На ней записан маршрут другого игрока.',effects:{item:'camera_reel',itemQty:1,clues:2}},{label:'Поменяться местом с тенью',outcome:'Несколько секунд комната вас не замечала.',effects:{danger:-14,nerve:-5}},{label:'Включить свет в зале',outcome:'Все пустые кресла повернулись к вам.',effects:{danger:16,noise:10},tags:['light']}],
    [{label:'Просмотреть последний кадр',outcome:'Финал показывает лифт, закрывающийся без вас.',effects:{clues:4,nerve:-10}},{label:'Оставить кассету в аппаратной',outcome:'Звук фильма записался поверх чужого голоса.',effects:{clues:3,danger:-5},requires:'cassette'},{label:'Разрезать экран',outcome:'За тканью оказался технический коридор.',effects:{danger:10,keys:1}}]
  ],
  clinic: [
    [{label:'Сверить пульс с лампой',outcome:'Расхождение указывает на скрытый источник питания.',effects:{clues:2,danger:-4}},{label:'Открыть карту пациента',outcome:'Под вашей подписью стоит завтрашняя дата.',effects:{clues:3,nerve:-7}},{label:'Заглянуть за ширму',outcome:'Каталка пуста, но ремни только что затянулись.',effects:{danger:12,nerve:-8}}],
    [{label:'Перевязать провод монитора',outcome:'Экран показал план служебного этажа.',effects:{clues:3,danger:4}},{label:'Взять дежурный ключ',outcome:'На бирке написано «выход только для одного».',effects:{item:'service_key',itemQty:1,danger:8}},{label:'Позвать дежурную',outcome:'Ответ пришёл из шкафа с медикаментами.',effects:{noise:12,nerve:-9}}],
    [{label:'Погасить монитор',outcome:'Пульс продолжил звучать из стены.',effects:{danger:-5,nerve:-6}},{label:'Снять бинты с ящика',outcome:'Внутри лежит карточка пропавшего соседа.',effects:{clues:3,danger:6}},{label:'Открыть окно палаты',outcome:'За окном оказался внутренний коридор дома.',effects:{keys:1,nerve:-7}}],
    [{label:'Исправить запись в журнале',outcome:'Ваш статус сменился с «выбыл» на «наблюдается».',effects:{danger:-12,clues:2}},{label:'Забрать пустую ампулу',outcome:'В стекле отражается номер следующей комнаты.',effects:{clues:2,item:'glass_key',itemQty:1}},{label:'Нажать кнопку вызова',outcome:'Лифт открылся в конце палаты.',effects:{danger:7,noise:14}}]
  ],
  library: [
    [{label:'Сложить корешки по цвету',outcome:'Названия книг образовали инструкцию к двери.',effects:{clues:3,danger:-3}},{label:'Подняться по лишней ступени',outcome:'Сверху виден план комнат, которых нет внизу.',effects:{clues:3,nerve:-7}},{label:'Открыть книгу без названия',outcome:'Первая строка описывает ваше присутствие сейчас.',effects:{danger:8,nerve:-9}}],
    [{label:'Найти карточку своей квартиры',outcome:'Предыдущий читатель указан как ваш сосед.',effects:{clues:2,danger:4}},{label:'Перерисовать план мелом',outcome:'На полу появилась короткая безопасная линия.',effects:{danger:-12,clues:1},requires:'chalk'},{label:'Вернуть вырванную страницу',outcome:'Стеллажи сдвинулись и закрыли обратный путь.',effects:{danger:13,noise:5}}],
    [{label:'Прочитать пометки на полях',outcome:'Записи предупреждают о ложном голосе справа.',effects:{clues:3,nerve:-3}},{label:'Поставить архивную печать',outcome:'Открылась секция с документами Управляющего.',effects:{clues:4,danger:7},requires:'archive_stamp'},{label:'Задвинуть лестницу',outcome:'Скрип наверху прекратился.',effects:{danger:-8,noise:-4}}],
    [{label:'Забрать книгу маршрутов',outcome:'Страницы запомнили пройденные вами комнаты.',effects:{item:'floor_map',itemQty:1,clues:2}},{label:'Погасить читальный свет',outcome:'Светящиеся буквы указали на потайную дверь.',effects:{clues:3,nerve:-5},tags:['light']},{label:'Позвать библиотекаря',outcome:'Штамп ударил по столу прямо за вашей спиной.',effects:{danger:10,noise:9}}]
  ],
  coldroom: [
    [{label:'Согреть латунную табличку',outcome:'Под инеем проступил номер технической двери.',effects:{clues:2,danger:5}},{label:'Идти по следам босых ног',outcome:'Следы привели к стене и продолжились вертикально.',effects:{clues:3,nerve:-8}},{label:'Остановить компрессор',outcome:'В тишине стало слышно движение внутри камеры.',effects:{danger:10,noise:-8}}],
    [{label:'Соскоблить иней с замка',outcome:'Замок оказался тёплым и уже открытым.',effects:{keys:1,danger:6}},{label:'Поднести спичку к цепочке следов',outcome:'Пламя наклонилось к невидимому проходу.',effects:{danger:-9,clues:2},requires:'matchbox'},{label:'Закрыться в морозильнике',outcome:'Снаружи кто-то прошёл и не заметил вас.',effects:{danger:-12,nerve:-10}}],
    [{label:'Разбить лёд у стены',outcome:'Внутри замёрзла кассета с рабочей записью.',effects:{item:'cassette',itemQty:1,clues:2}},{label:'Проверить внутреннюю ручку',outcome:'Она открывает дверь в другую комнату.',effects:{danger:8,keys:1}},{label:'Оставить холодную монету',outcome:'Комната приняла плату и перестала сужаться.',effects:{danger:-15},requires:'cold_coin'}],
    [{label:'Сверить температуру дверей',outcome:'Самая холодная дверь ведёт наружу.',effects:{danger:-10,clues:2}},{label:'Снять номер со стены',outcome:'Иней мгновенно покрыл ваши следы.',effects:{item:'brass_number',itemQty:1,nerve:-5}},{label:'Включить аварийный свет',outcome:'В прозрачном льду стали видны чужие лица.',effects:{clues:4,danger:15},tags:['light']}]
  ],
  workshop: [
    [{label:'Ответить на вызов домофона',outcome:'В трубке прозвучал голос из вашей квартиры.',effects:{clues:2,nerve:-8}},{label:'Проследить обрезанный провод',outcome:'Провод уходит в панель скрытой двери.',effects:{clues:3,danger:4}},{label:'Разобрать кнопку без номера',outcome:'Внутри лежит маленький латунный ключ.',effects:{item:'brass_key',itemQty:1,danger:7}}],
    [{label:'Настроить паяльник по ритму',outcome:'Азбука Морзе складывается в слово «СЛЕВА».',effects:{clues:3,noise:4}},{label:'Вставить предохранитель',outcome:'Один домофон показал изображение лестницы.',effects:{danger:-8,keys:1},requires:'fuse'},{label:'Включить все трубки',outcome:'Комната наполнилась голосами соседей.',effects:{danger:14,noise:18}}],
    [{label:'Записать сигнал на кассету',outcome:'На записи слышен код доступа и второй голос.',effects:{clues:4,danger:5},requires:'cassette'},{label:'Отключить красный провод',outcome:'Камеры на этаже погасли на несколько секунд.',effects:{danger:-13,noise:3}},{label:'Нажать кнопку вашей квартиры',outcome:'За стеной кто-то открыл дверь.',effects:{nerve:-9,danger:8}}],
    [{label:'Собрать переносной приёмник',outcome:'Устройство отмечает ближайший безопасный выход.',effects:{item:'radio',itemQty:1,clues:2}},{label:'Стереть список «слышит»',outcome:'Один из голосов исчез из всех динамиков.',effects:{danger:-7,nerve:-4}},{label:'Замкнуть контакты лифта',outcome:'Кабина остановилась рядом, но двери не открылись.',effects:{danger:12,keys:1}}]
  ],
  clock: [
    [{label:'Остановить часы без восьмёрки',outcome:'Остальные механизмы на секунду показали выход.',effects:{clues:3,danger:-5}},{label:'Заглянуть в дверной глазок циферблата',outcome:'За ним виден коридор несколькими минутами позже.',effects:{clues:3,nerve:-8}},{label:'Перевести все стрелки на 00:08',outcome:'Комната стала старше на несколько десятилетий.',effects:{danger:12,noise:6}}],
    [{label:'Завести отстающие часы',outcome:'Внутри механизма нашлась записка с кодом.',effects:{clues:2,keys:1}},{label:'Снять маятник со штукатуркой',outcome:'Под ним виден отпечаток скрытой двери.',effects:{clues:3,danger:5}},{label:'Разбить будильник под столом',outcome:'Пол перестал дрожать, но лифт начал двигаться.',effects:{danger:-7,noise:15}}],
    [{label:'Синхронизировать часы с пульсом',outcome:'Один механизм открыл маленький сейф.',effects:{clues:3,item:'watch_0008',itemQty:1}},{label:'Повернуть время назад',outcome:'Следы на полу снова стали свежими.',effects:{clues:2,nerve:-6}},{label:'Вытащить заводной ключ',outcome:'Все часы замолчали, и за стеной зашагали.',effects:{danger:9,noise:-7}}],
    [{label:'Дождаться восьмого удара',outcome:'На ударе открылась дверь, отсутствующая между тиками.',effects:{keys:1,danger:-8}},{label:'Закрыть глазок монетой',outcome:'Будущее перестало смотреть в комнату.',effects:{danger:-12},requires:'cold_coin'},{label:'Перевести одни часы вперёд',outcome:'Вы услышали собственное возвращение из вылазки.',effects:{clues:4,nerve:-10}}]
  ],
  balcony: [
    [{label:'Сравнить окна соседей',outcome:'В одном окне ваша квартира показана без двери.',effects:{clues:3,nerve:-5}},{label:'Поднять мокрую квитанцию',outcome:'Платёж оформлен за несуществующий этаж.',effects:{clues:2,item:'tenant_receipt',itemQty:1}},{label:'Позвать силуэт напротив',outcome:'Он ответил вашим голосом.',effects:{danger:10,noise:12}}],
    [{label:'Провести ключом по батарее',outcome:'Из другого подъезда ответили тем же ритмом.',effects:{clues:3,noise:8},requires:'brass_key'},{label:'Закрыть окно, где дождь идёт вверх',outcome:'Сквозняк ослаб, а коридор перестал меняться.',effects:{danger:-12}},{label:'Посмотреть вниз через камеру',outcome:'На снимке этажей больше, чем у дома.',effects:{item:'rain_photo',itemQty:1,clues:2}}],
    [{label:'Перелезть к соседнему окну',outcome:'За ним находится ваша квартира несколько лет назад.',effects:{clues:4,danger:14}},{label:'Стереть след с перил',outcome:'Холодная ладонь на секунду сжала вашу руку.',effects:{nerve:-12,danger:-3}},{label:'Отметить безопасное окно мелом',outcome:'Метка появилась на стекле изнутри.',effects:{danger:-9,clues:1},requires:'chalk'}],
    [{label:'Открыть внутреннюю форточку',outcome:'За ней обнаружился узкий проход к лифту.',effects:{keys:1,danger:5}},{label:'Оставить сообщение в окне',outcome:'Другой подъезд ответил короткой запиской.',effects:{clues:2,noise:4}},{label:'Задёрнуть все шторы',outcome:'Силуэты напротив продолжили наблюдать сквозь ткань.',effects:{danger:-5,nerve:-8}}]
  ],
  registry: [
    [{label:'Сверить подпись в журнале',outcome:'Подпись ваша, но чернила ещё не высохли.',effects:{clues:3,nerve:-6}},{label:'Найти карточку пропавшего соседа',outcome:'В графе «выбыл» стоит сегодняшнее время.',effects:{clues:3,danger:5}},{label:'Спрятать реестр под столом',outcome:'Шкафы начали искать документ сами.',effects:{danger:10,noise:8}}],
    [{label:'Поставить печать на своей карточке',outcome:'Статус изменился на «имеет право вернуться».',effects:{danger:-12,keys:1},requires:'archive_stamp'},{label:'Переписать номер квартиры',outcome:'Несколько секунд дом вас не узнавал.',effects:{danger:-8,nerve:-7}},{label:'Включить переговорное устройство',outcome:'Дежурный назвал дату вашего исчезновения.',effects:{clues:3,nerve:-10}}],
    [{label:'Снять копию технического плана',outcome:'На плане отмечен путь за стеной архива.',effects:{item:'floor_map',itemQty:1,clues:2}},{label:'Удалить запись Управляющего',outcome:'Красная лампа над дверью погасла.',effects:{danger:-10,clues:2}},{label:'Открыть шкаф без индекса',outcome:'Внутри лежат карточки ещё не родившихся жильцов.',effects:{danger:14,nerve:-9}}],
    [{label:'Закрыть журнал чёрной нитью',outcome:'Страницы перестали переписывать себя.',effects:{danger:-13},requires:'black_thread'},{label:'Забрать служебный пропуск',outcome:'Пропуск открывает дверь с символом Управляющего.',effects:{item:'visitor_pass',itemQty:1,danger:7}},{label:'Позвонить в архив',outcome:'Телефон зазвонил в вашей квартире.',effects:{noise:14,clues:2}}]
  ],
  wardrobe: [
    [{label:'Проверить карман звенящего пальто',outcome:'Внутри лежит билет на лифт с отметкой 00:08.',effects:{item:'stair_ticket',itemQty:1,clues:2}},{label:'Отодвинуть ряд вешалок',outcome:'За одеждой обнаружилась служебная дверь.',effects:{keys:1,danger:5}},{label:'Надеть вещь без отражения',outcome:'Зеркало перестало замечать вас.',effects:{danger:-10,nerve:-8}}],
    [{label:'Собрать связку ключей',outcome:'Один ключ подходит к замку за задней стенкой.',effects:{item:'service_key',itemQty:1,danger:8}},{label:'Прочитать бирки по порядку',outcome:'Имена складываются в предупреждение.',effects:{clues:3,nerve:-4}},{label:'Застегнуть молнию изнутри',outcome:'Кто-то снаружи попытался открыть тот же карман.',effects:{danger:9,nerve:-9}}],
    [{label:'Повесить своё пальто среди остальных',outcome:'Комната приняла вас за прежнего жильца.',effects:{danger:-14,clues:2}},{label:'Снять дверную цепочку',outcome:'За шкафом открылась узкая щель.',effects:{item:'door_chain',itemQty:1,danger:6}},{label:'Позвать владельца одежды',outcome:'Все вешалки одновременно повернулись.',effects:{noise:15,danger:12}}],
    [{label:'Спрятать кассету в кармане',outcome:'Она записала разговор из соседней комнаты.',effects:{clues:4,danger:-3},requires:'cassette'},{label:'Закрыть зеркало пальто',outcome:'Отражение не смогло повторить следующий шаг.',effects:{danger:-11,nerve:-4}},{label:'Открыть техническую дверь',outcome:'За ней шумит шахта лифта.',effects:{keys:1,danger:10}}]
  ]
};

async function seedV4Content(){
  let order=100;
  for(let cycle=0;cycle<4;cycle++)for(const [base,title,description] of roomThemes){
    const id=`v4-${base}-${cycle+1}`;
    const choices=roomChoiceSets[base]?.[cycle] ?? roomChoiceSets[base]?.[0] ?? [];
    await pool.query(`INSERT INTO game_rooms(id,title,description,ambience,accent,choices,enabled,sort_order) VALUES($1,$2,$3,$4,$5,$6,TRUE,$7)
      ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,ambience=EXCLUDED.ambience,accent=EXCLUDED.accent,choices=EXCLUDED.choices,enabled=TRUE,sort_order=EXCLUDED.sort_order,updated_at=NOW()`,
      [id,`${title} · ${cycle+1}`,description,['pipes','wind','camera','voices'][cycle]??'wind',['#80664f','#61716e','#765d66','#806f4d'][cycle]??'#806f4d',JSON.stringify(choices),order++]);
  }
  await pool.query(`UPDATE expeditions SET status='cancelled',completed_at=NOW() WHERE status='active' AND state::text LIKE '%Осмотреть следы%' AND state::text LIKE '%Позвать соседа%' AND state::text LIKE '%Не вмешиваться%'`);
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
