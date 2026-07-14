import { ROOM_TEMPLATES, type Effect, type RoomTemplate } from './catalog.js';
import { AppError } from '../errors.js';

export interface ExpeditionState {
  nerve: number;
  danger: number;
  noise: number;
  clues: number;
  keys: number;
  bag: Record<string, number>;
  route: string[];
  log: string[];
  maxRooms: number;
  lightsUsed: number;
  roomSnapshots?: Record<string, RoomTemplate>;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const current = result[i]!;
    result[i] = result[j]!;
    result[j] = current;
  }
  return result;
}

export function createExpedition(seed: number, templates: RoomTemplate[] = ROOM_TEMPLATES, requestedRooms = 6): ExpeditionState {
  if (!templates.length) throw new AppError('Нет активных комнат для экспедиции',503,'NO_ACTIVE_ROOMS');
  const rng = mulberry32(seed);
  const maxRooms = Math.max(1, Math.min(requestedRooms, templates.length));
  const selected = shuffled(templates, rng).slice(0, maxRooms);
  return {
    nerve: 100,
    danger: 0,
    noise: 0,
    clues: 0,
    keys: 0,
    bag: { matchbox: 1, chalk: 1 },
    route: selected.map(room => room.id),
    roomSnapshots: Object.fromEntries(selected.map(room => [room.id, structuredClone(room)])),
    log: ['Лифт остановился на цифре, которой нет на панели.'],
    maxRooms,
    lightsUsed: 0
  };
}

export function currentRoom(state: ExpeditionState, roomIndex: number, templates: RoomTemplate[] = ROOM_TEMPLATES): RoomTemplate | null {
  const id = state.route[roomIndex];
  if (!id) return null;
  return state.roomSnapshots?.[id]
    ?? templates.find(room => room.id === id)
    ?? ROOM_TEMPLATES.find(room => room.id === id)
    ?? null;
}

function applyEffect(state: ExpeditionState, effect: Effect): ExpeditionState {
  const next: ExpeditionState = structuredClone(state);
  next.nerve = Math.max(0, Math.min(100, next.nerve + (effect.nerve ?? 0)));
  next.danger = Math.max(0, Math.min(100, next.danger + (effect.danger ?? 0) + Math.floor(next.noise / 15)));
  next.noise = Math.max(0, Math.min(100, next.noise + (effect.noise ?? -2)));
  next.clues = Math.max(0, next.clues + (effect.clues ?? 0));
  next.keys = Math.max(0, next.keys + (effect.keys ?? 0));
  if (effect.item) next.bag[effect.item] = (next.bag[effect.item] ?? 0) + (effect.itemQty ?? 1);
  return next;
}

export function resolveChoice(state: ExpeditionState, roomIndex: number, choiceIndex: number, templates: RoomTemplate[] = ROOM_TEMPLATES) {
  const room = currentRoom(state, roomIndex, templates);
  if (!room) throw new AppError('Комната не найдена',409,'ROOM_NOT_FOUND');
  const choice = room.choices[choiceIndex];
  if (!choice) throw new AppError('Вариант действия не найден',400,'CHOICE_NOT_FOUND');
  if (choice.requires && !state.bag[choice.requires]) throw new AppError(`Нужен предмет: ${choice.requires}`,409,'REQUIRED_ITEM_MISSING');
  let next = structuredClone(state);
  if (choice.requires) next.bag[choice.requires] = Math.max(0, (next.bag[choice.requires] ?? 0) - 1);
  if (choice.tags?.includes('light')) next.lightsUsed = (next.lightsUsed ?? 0) + 1;
  next = applyEffect(next, choice.effects);
  next.log.unshift(choice.outcome);
  next.log = next.log.slice(0, 8);
  const nextIndex = roomIndex + 1;
  const atExit = nextIndex >= next.maxRooms;
  const lost = next.danger >= 100 || (next.nerve <= 0 && !atExit);
  const escaped = !lost && atExit;
  return {
    state: next,
    roomIndex: nextIndex,
    status: lost ? 'lost' as const : escaped ? 'escaped' as const : 'active' as const,
    outcome: choice.outcome
  };
}
