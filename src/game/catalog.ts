export type Effect = { nerve?: number; danger?: number; noise?: number; clues?: number; keys?: number; item?: string; itemQty?: number };
export type Choice = { label: string; outcome: string; effects: Effect; requires?: string; tags?: string[] };
export type RoomTemplate = { id: string; title: string; description: string; ambience: string; accent: string; choices: Choice[] };

export const ITEM_CATALOG: Record<string, { name: string; description: string; icon: string }> = {
  matchbox: { name: 'Коробок спичек', description: 'Короткий тёплый свет. Иногда этого достаточно.', icon: '▥' },
  chalk: { name: 'Мел', description: 'Оставляет метки, которые видят другие жильцы.', icon: '⌁' },
  cassette: { name: 'Немая кассета', description: 'На записи слышно то, чего не было рядом.', icon: '▰' },
  brass_key: { name: 'Латунный ключ', description: 'Номер квартиры спилен.', icon: '⚿' },
  torn_photo: { name: 'Разорванная фотография', description: 'На обороте дата, которой ещё не было.', icon: '▧' },
  fuse: { name: 'Предохранитель', description: 'Подходит к старому щитку.', icon: 'ϟ' },
  spare_key: { name: 'Запасной ключ', description: 'Позволяет помочь соседу или открыть запасной маршрут.', icon: '⌘' },
  black_thread: { name: 'Чёрная нить', description: 'Ею соединяют улики на доске.', icon: '∿' },
  archive_stamp: { name: 'Печать архива', description: 'Открывает закрытое дело.', icon: '◉' },
  blackout_ticket: { name: 'Билет тёмной ночи', description: 'Запускает особый кооперативный сценарий.', icon: '▣' },
  radio: { name: 'Карманное радио', description: 'Ловит разговоры между этажами.', icon: '⌁' },
  plant_fern: { name: 'Папоротник из прачечной', description: 'Декор квартиры; листья шевелятся без ветра.', icon: '♧' }
};

export const ROOM_TEMPLATES: RoomTemplate[] = [
  { id:'corridor-keys', title:'Коридор потерянных ключей', ambience:'metal', accent:'#b88345',
    description:'С потолка на тонких нитях свисают сотни ключей. Один из них тихо поворачивается сам.',
    choices:[
      {label:'Поймать вращающийся ключ',outcome:'Ключ оказался тёплым, будто его только что держали.',effects:{danger:15,nerve:-4,item:'brass_key',itemQty:1}},
      {label:'Пометить путь мелом',outcome:'Метка проступила и на противоположной стене.',effects:{danger:-5,clues:1},requires:'chalk'},
      {label:'Пройти, не касаясь ключей',outcome:'За спиной всё равно звякнула одна связка.',effects:{noise:8,danger:5}}
    ]},
  { id:'laundry', title:'Прачечная без окон', ambience:'water', accent:'#67857a',
    description:'Стиральные машины работают без электричества. В одной из них крутится чужое пальто.',
    choices:[
      {label:'Остановить барабан',outcome:'В кармане пальто нашлась фотография подъезда.',effects:{nerve:-6,danger:10,item:'torn_photo',itemQty:1,clues:1}},
      {label:'Открыть слив',outcome:'Вода ушла, обнажив предохранитель и следы босых ног.',effects:{item:'fuse',itemQty:1,danger:8}},
      {label:'Послушать трубы',outcome:'Кто-то назвал номер вашей квартиры.',effects:{nerve:-10,clues:2}}
    ]},
  { id:'archive', title:'Архив жильцов', ambience:'paper', accent:'#8d7663',
    description:'Папки расставлены по квартирам. Между вашими документами лежит протокол завтрашнего дня.',
    choices:[
      {label:'Забрать протокол',outcome:'Чернила ещё не высохли. В списке свидетелей есть вы.',effects:{clues:3,danger:12,item:'black_thread',itemQty:1}},
      {label:'Поставить печать',outcome:'Шкаф за спиной открылся без звука.',effects:{clues:2,item:'archive_stamp',itemQty:1},requires:'brass_key'},
      {label:'Переписать номер квартиры',outcome:'На несколько секунд вы забыли, где живёте.',effects:{nerve:-13,danger:-3}}
    ]},
  { id:'nursery', title:'Детская с двумя дверями', ambience:'musicbox', accent:'#9b777f',
    description:'На ковре разложен дом из кубиков. В нём есть ваш подъезд и лишнее окно.',
    choices:[
      {label:'Переставить лишнее окно',outcome:'В коридоре рядом появилась новая дверь.',effects:{danger:18,clues:2}},
      {label:'Завести музыкальную шкатулку',outcome:'Мелодия заставила шаги за стеной отдалиться.',effects:{danger:-12,noise:10}},
      {label:'Сфотографировать дом',outcome:'На снимке за вами стоит ребёнок без лица.',effects:{nerve:-12,item:'torn_photo',itemQty:1}}
    ]},
  { id:'switchboard', title:'Щитовая', ambience:'electric', accent:'#bda258',
    description:'Автоматы подписаны именами жильцов, а не номерами квартир. Ваш выключен.',
    choices:[
      {label:'Включить свой автомат',tags:['light'],outcome:'В квартире за сотни метров зажёгся свет. Здесь стало темнее.',effects:{danger:20,nerve:-8,clues:1}},
      {label:'Заменить предохранитель',outcome:'Лифт ответил коротким звонком.',effects:{danger:-18,keys:1},requires:'fuse'},
      {label:'Выключить чужой автомат',outcome:'В общем чате появилось сообщение: «Кто это сделал?»',effects:{danger:-5,nerve:-3}}
    ]},
  { id:'mirror-flat', title:'Квартира наоборот', ambience:'glass', accent:'#68849b',
    description:'Планировка повторяет вашу квартиру, но все вещи стоят зеркально. На столе лежит включённый диктофон.',
    choices:[
      {label:'Прослушать запись',outcome:'Записан ваш голос, предупреждающий не слушать запись.',effects:{nerve:-15,clues:3,item:'cassette',itemQty:1}},
      {label:'Забрать вещь со стола',outcome:'В вашей настоящей квартире освободилось пустое место.',effects:{item:'radio',itemQty:1,danger:15}},
      {label:'Закрыть все зеркала',outcome:'Отражения продолжили двигаться под тканью.',effects:{danger:-8,nerve:-5}}
    ]},
  { id:'kitchen', title:'Коммунальная кухня', ambience:'voices', accent:'#9a6548',
    description:'За столом спорят люди, лица которых закрыты газетами. Для вас оставлен пустой стул.',
    choices:[
      {label:'Сесть и молчать',outcome:'Вам передали записку с чужим алиби.',effects:{clues:2,nerve:-4}},
      {label:'Спросить о восьмом этаже',outcome:'Все газеты одновременно повернулись к вам.',effects:{danger:20,nerve:-12,clues:2}},
      {label:'Оставить кассету на столе',outcome:'Голоса записались. Один принадлежит соседу.',effects:{danger:-8,clues:3},requires:'cassette'}
    ]},
  { id:'watch-room', title:'Комната наблюдения', ambience:'camera', accent:'#687069',
    description:'На старых мониторах видны квартиры жильцов. Один экран показывает вас с задержкой в десять секунд.',
    choices:[
      {label:'Подождать у экрана',outcome:'Будущая версия вас указала на дверь слева.',effects:{danger:-10,clues:2}},
      {label:'Переключить камеру',outcome:'Вы увидели соседа, оставляющего ключ у вашей двери.',effects:{item:'spare_key',itemQty:1,clues:1}},
      {label:'Отключить запись',outcome:'Красный индикатор погас не на всех камерах.',effects:{danger:8,nerve:-4}}
    ]},
  { id:'stairwell', title:'Лестница с лишней площадкой', ambience:'wind', accent:'#5f7381',
    description:'Между этажами появилась площадка 7½. На ней стоит одинокий почтовый ящик.',
    choices:[
      {label:'Открыть ящик',outcome:'Внутри лежит приглашение, адресованное вашему другу.',effects:{clues:1,item:'black_thread',itemQty:1,danger:8}},
      {label:'Спуститься ниже',outcome:'Через минуту вы снова оказались на той же площадке.',effects:{nerve:-8,danger:6}},
      {label:'Оставить запасной ключ',outcome:'Кто-то в доме получил новый путь домой.',effects:{danger:-15,clues:2},requires:'spare_key'}
    ]},
  { id:'greenhouse', title:'Запертая оранжерея', ambience:'leaves', accent:'#667b55',
    description:'Влажные растения проросли сквозь кафель. Все листья повёрнуты к закрытой двери.',
    choices:[
      {label:'Открыть дверь',outcome:'За ней оказалась стена с вашим именем, выцарапанным в штукатурке.',effects:{danger:15,nerve:-10,clues:2}},
      {label:'Срезать папоротник',outcome:'Растение свернулось в ладони и затихло.',effects:{item:'plant_fern',itemQty:1,danger:5}},
      {label:'Посыпать тропу мелом',outcome:'На полу проявились следы, ведущие наружу.',effects:{danger:-14},requires:'chalk'}
    ]},
  { id:'radio-room', title:'Радиорубка', ambience:'radio', accent:'#8b7751',
    description:'Приёмник перебирает частоты сам. На одной из них идёт собрание жильцов, которое ещё не началось.',
    choices:[
      {label:'Записать частоту',outcome:'Вы узнали, кто первым обвинит вас на собрании.',effects:{clues:3,nerve:-5}},
      {label:'Ответить в эфир',outcome:'Ваш голос прозвучал из всех квартир дома.',effects:{noise:20,danger:15,clues:1},requires:'radio'},
      {label:'Вытащить провод',outcome:'Тишина оказалась громче помех.',effects:{danger:-7,nerve:-6}}
    ]},
  { id:'elevator-machine', title:'Машинное отделение', ambience:'elevator', accent:'#7d604f',
    description:'Тросы уходят вверх, хотя дом заканчивается ниже. На барабане мелом написано: «не возвращайся один».',
    choices:[
      {label:'Запустить аварийный привод',outcome:'Лифт открылся рядом. До возвращения осталось несколько секунд.',effects:{danger:-25,keys:1}},
      {label:'Перерезать чёрную нить',outcome:'Где-то в доме хлопнула дверь, которой больше нет.',effects:{danger:10,clues:4},requires:'black_thread'},
      {label:'Осмотреть тросы',outcome:'На одном из них висят бирки с именами жильцов.',effects:{nerve:-9,clues:2}}
    ]}
];

export const SHOP = [
  { sku:'blackout_ticket', title:'Ночь без электричества', description:'Особый билет и предмет для совместного сценария.', stars:40, icon:'▣' },
  { sku:'archive_case', title:'Дело архивиста', description:'Три архивные печати, кассета и цепочка редких комнат.', stars:75, icon:'◉' },
  { sku:'restorer_pack', title:'Квартира реставратора', description:'Новый стиль квартиры, папоротник и радиоприёмник.', stars:120, icon:'⌂' },
  { sku:'residents_club', title:'Клуб жильцов — 30 дней', description:'Расширенный архив, особая рамка профиля и еженедельный ключ.', stars:199, icon:'◆' }
] as const;
