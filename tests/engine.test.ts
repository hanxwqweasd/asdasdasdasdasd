import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpedition, currentRoom, resolveChoice } from '../src/game/engine.js';

test('expedition route is deterministic and contains six rooms', () => {
  const a=createExpedition(12345); const b=createExpedition(12345);
  assert.deepEqual(a.route,b.route); assert.equal(a.route.length,6);
});

test('choice advances room and keeps values bounded', () => {
  const state=createExpedition(555);
  const room=currentRoom(state,0)!;
  const choice=room.choices.findIndex(c=>!c.requires);
  const result=resolveChoice(state,0,choice);
  assert.equal(result.roomIndex,1);
  assert.ok(result.state.nerve>=0&&result.state.nerve<=100);
  assert.ok(result.state.danger>=0&&result.state.danger<=100);
});

test('required item is consumed', () => {
  const state=createExpedition(1);
  state.route[0]='corridor-keys';
  const before=state.bag.chalk;
  const result=resolveChoice(state,0,1);
  assert.equal(result.state.bag.chalk,before-1);
});
