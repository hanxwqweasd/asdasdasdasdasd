import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
process.env.DATABASE_URL='postgresql://unused:unused@localhost/unused';
process.env.BOT_TOKEN='123456789:abcdefghijklmnop';
process.env.BOT_USERNAME='test_bot';
process.env.WEBHOOK_SECRET='12345678901234567890123456789012';

const { dialogGraphSchema }=await import('../src/services/content-versioning.js');
const { roleChoice, ROLES }=await import('../src/services/roles.js');
const { TUTORIAL_STEPS }=await import('../src/services/tutorial.js');

test('dialog graph accepts a connected minimal story', () => {
  const graph=dialogGraphSchema.parse({
    startNodeId:'start',
    nodes:[
      {id:'start',type:'scene',title:'Коридор',text:'Лампа мигает.',x:0,y:0,config:{}},
      {id:'end',type:'ending',title:'Лифт',text:'Двери закрылись.',x:200,y:0,config:{}}
    ],
    edges:[{id:'edge-1',from:'start',to:'end',label:'Вернуться'}],
    metadata:{season:'test'}
  });
  assert.equal(graph.nodes.length,2);
  assert.equal(graph.edges[0]?.to,'end');
});

test('dialog graph rejects links to missing nodes', () => {
  const result=dialogGraphSchema.safeParse({
    startNodeId:'start',
    nodes:[{id:'start',type:'scene',title:'Коридор',text:'',x:0,y:0,config:{}}],
    edges:[{id:'broken',from:'start',to:'missing',label:''}],
    metadata:{}
  });
  assert.equal(result.success,false);
});

test('profession-specific action appears only in the matching room', () => {
  assert.equal(roleChoice('electrician','switchboard')?.effects.danger,-20);
  assert.equal(roleChoice('electrician','archive'),null);
  assert.equal(Object.keys(ROLES).length,8);
});

test('tutorial is a complete ordered nine-step story', () => {
  assert.equal(TUTORIAL_STEPS.length,9);
  assert.equal(new Set(TUTORIAL_STEPS.map(step=>step.action)).size,9);
  assert.equal(TUTORIAL_STEPS[0]?.action,'open_door');
  assert.equal(TUTORIAL_STEPS.at(-1)?.action,'see_invite');
});
