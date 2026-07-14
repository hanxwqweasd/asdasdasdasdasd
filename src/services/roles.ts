import { pool } from '../db.js';
import { AppError } from '../errors.js';

export const ROLES={
  electrician:{title:'Электрик',description:'Видит состояние щитков и безопасно меняет предохранители.',tool:'fuse',benefit:'Снижает опасность при работе со светом.',quest:['Проверить щитовую','Вернуть свет в подъезд','Найти автомат без имени']},
  archivist:{title:'Архивист',description:'Читает закрытые протоколы и замечает подменённые даты.',tool:'archive_stamp',benefit:'Открывает архивные варианты решений.',quest:['Найти ошибку в реестре','Собрать три печати','Открыть дело без номера']},
  locksmith:{title:'Слесарь',description:'Работает с дверями и ремонтирует сломанные механизмы.',tool:'brass_key',benefit:'Создаёт запасные маршруты.',quest:['Починить замок','Открыть техническую дверь','Вернуть ключ владельцу']},
  photographer:{title:'Фотограф',description:'Замечает детали, которые видны только на снимках.',tool:'torn_photo',benefit:'Получает дополнительные улики в визуальных комнатах.',quest:['Снять пустую лестницу','Проявить странный кадр','Найти себя на старом фото']},
  courier:{title:'Курьер',description:'Быстро передаёт вещи между жильцами и подъездами.',tool:'spare_key',benefit:'Меньшая комиссия рынка и расширенные подарки.',quest:['Доставить записку','Передать предмет незнакомцу','Вернуться до закрытия лифта']},
  radio:{title:'Радиолюбитель',description:'Различает частоты и чужие голоса в помехах.',tool:'radio',benefit:'Получает личные звуковые подсказки.',quest:['Записать частоту','Ответить неизвестному','Найти источник голоса']},
  chairman:{title:'Председатель',description:'Организует голосования и видит состояние общего фонда.',tool:'black_thread',benefit:'Создаёт голосования подъезда.',quest:['Созвать собрание','Закрыть общий спор','Выполнить недельную цель']},
  observer:{title:'Наблюдатель',description:'Сопоставляет действия жильцов и камеры наблюдения.',tool:'cassette',benefit:'Раньше видит последствия решений.',quest:['Просмотреть камеры','Найти несостыковку','Предупредить соседа']}
} as const;
export type RoleKey=keyof typeof ROLES;
export async function chooseRole(userId:string|number,role:RoleKey){
  const current=await pool.query(`SELECT role_key FROM role_progress WHERE user_id=$1`,[userId]);
  if(current.rows[0]&&current.rows[0].role_key!==role)throw new AppError('Профессию можно сменить только через сюжетное событие',409,'ROLE_ALREADY_SELECTED');
  await pool.query(`INSERT INTO role_progress(user_id,role_key) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING`,[userId,role]);
  await pool.query(`UPDATE player_profiles SET profession=$2 WHERE user_id=$1`,[userId,role]);return{role,definition:ROLES[role]};
}
export async function getRole(userId:string|number){const r=await pool.query(`SELECT role_key,level,xp,quest_step,selected_at FROM role_progress WHERE user_id=$1`,[userId]);return r.rows[0]?{...r.rows[0],definition:ROLES[r.rows[0].role_key as RoleKey]}:null;}
export function roleChoice(role:string|undefined,roomId:string){
  const map:Record<string,Record<string,{label:string;outcome:string;effects:Record<string,number>}>>={
    electrician:{switchboard:{label:'Проверить схему как электрик',outcome:'Вы нашли безопасный автомат и сняли нагрузку.',effects:{danger:-20,clues:2}}},
    archivist:{archive:{label:'Сверить регистрационные шифры',outcome:'Одна папка зарегистрирована завтрашним числом.',effects:{clues:4}}},
    locksmith:{'corridor-keys':{label:'Определить замок по насечкам',outcome:'Ключ относится к технической двери у лифта.',effects:{keys:1,danger:-8}}},
    photographer:{nursery:{label:'Снять комнату с длинной выдержкой',outcome:'На кадре проявилась дополнительная дверь.',effects:{clues:3,nerve:-4}}},
    radio:{'radio-room':{label:'Отделить голос от несущей частоты',outcome:'Голос принадлежит пропавшему жильцу.',effects:{clues:4,danger:-5}}},
    observer:{'watch-room':{label:'Сравнить временные метки камер',outcome:'Одна камера показывает события на семь минут вперёд.',effects:{clues:3,danger:-7}}}
  };return role?map[role]?.[roomId]??null:null;
}
