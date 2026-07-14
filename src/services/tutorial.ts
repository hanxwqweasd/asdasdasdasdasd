import crypto from 'node:crypto';
import { pool, withTransaction } from '../db.js';
import { AppError } from '../errors.js';
import { changeInventory } from './economy.js';

export const TUTORIAL_STEPS=[
  {action:'open_door',title:'Двери открылись',text:'Лифт остановился между седьмым и девятым. Проведите пальцем по створкам.',cta:'Раздвинуть двери'},
  {action:'inspect_room',title:'Коридор уже знает вас',text:'На дальней двери приколота карточка с вашим именем. Коснитесь трёх отмеченных деталей.',cta:'Осмотреть коридор'},
  {action:'take_item',title:'На полу лежит спичечный коробок',text:'Он тёплый. Поднимите его — предметы можно использовать в решениях и квартире.',cta:'Поднять коробок'},
  {action:'make_choice',title:'Стук из-за двери',text:'Ответить, заглянуть в глазок или погасить лампу. Дом запомнит выбор.',cta:'Заглянуть в глазок'},
  {action:'lose_nerve',title:'Кто-то стоял с вашей стороны',text:'Отражение в глазке моргнуло позже вас. Самообладание снизилось.',cta:'Отступить от двери'},
  {action:'return_home',title:'Лифт снова рядом',text:'До закрытия остаётся несколько секунд. Вернитесь в свою квартиру.',cta:'Войти в лифт'},
  {action:'place_item',title:'В квартире появилось место',text:'Положите найденный коробок на полку у входа.',cta:'Поставить на полку'},
  {action:'read_note',title:'Записка под дверью',text:'«Не отвечай консьержу. Его не существует». Подпись: квартира 8.',cta:'Развернуть записку'},
  {action:'see_invite',title:'На двери появилось имя знакомого',text:'Приглашённый друг станет частью отдельной истории, а не цифрой в счётчике.',cta:'Увидеть приглашение'}
] as const;
export type TutorialAction=typeof TUTORIAL_STEPS[number]['action'];

export async function tutorialState(userId:string|number){
  await pool.query(`INSERT INTO tutorial_progress(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`,[userId]);
  const result=await pool.query(`SELECT step,state,started_at,updated_at,completed_at FROM tutorial_progress WHERE user_id=$1`,[userId]);
  const row=result.rows[0];return{...row,total:TUTORIAL_STEPS.length,current:row.completed_at?null:TUTORIAL_STEPS[Math.min(Number(row.step),TUTORIAL_STEPS.length-1)]};
}

export async function advanceTutorial(userId:string|number,action:TutorialAction){
  return withTransaction(async client=>{
    await client.query(`INSERT INTO tutorial_progress(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`,[userId]);
    const found=await client.query(`SELECT step,state,completed_at FROM tutorial_progress WHERE user_id=$1 FOR UPDATE`,[userId]);const row=found.rows[0];
    if(row.completed_at)return{completed:true,step:TUTORIAL_STEPS.length};
    const expected=TUTORIAL_STEPS[Number(row.step)];
    if(!expected||expected.action!==action)throw new AppError(`Сейчас ожидается действие: ${expected?.cta??'завершение'}`,409,'TUTORIAL_STEP_MISMATCH');
    const state={...(row.state??{}),[action]:new Date().toISOString()};
    if(action==='take_item')await changeInventory(client,userId,'matchbox',1,'tutorial_item',`tutorial:${userId}:matchbox`);
    if(action==='lose_nerve')await client.query(`UPDATE player_profiles SET nerve=GREATEST(0,nerve-15) WHERE user_id=$1`,[userId]);
    if(action==='place_item'){
      const inv=await client.query(`SELECT quantity FROM inventory WHERE user_id=$1 AND item_id='matchbox' FOR UPDATE`,[userId]);
      if(Number(inv.rows[0]?.quantity??0)<1)await changeInventory(client,userId,'matchbox',1,'tutorial_recovery',`tutorial:${userId}:recovery`);
      const occupied=await client.query(`SELECT 1 FROM apartment_items WHERE user_id=$1 AND slot=0`,[userId]);
      if(!occupied.rowCount){await client.query(`INSERT INTO apartment_items(id,user_id,item_id,slot,rotation) VALUES($1,$2,'matchbox',0,0)`,[crypto.randomUUID(),userId]);await changeInventory(client,userId,'matchbox',-1,'tutorial_place',`tutorial:${userId}:place`);}
    }
    if(action==='read_note'){
      const exists=await client.query(`SELECT 1 FROM neighbor_notes WHERE author_id=-8008 AND target_id=$1 AND body LIKE 'Не отвечай консьержу%'`,[userId]);
      if(!exists.rowCount)await client.query(`INSERT INTO neighbor_notes(id,author_id,target_id,body,mood) VALUES($1,-8008,$2,'Не отвечай консьержу. Его не существует. — квартира 8','warning')`,[crypto.randomUUID(),userId]);
    }
    const next=Number(row.step)+1;const completed=next>=TUTORIAL_STEPS.length;
    await client.query(`UPDATE tutorial_progress SET step=$2,state=$3,updated_at=NOW(),completed_at=CASE WHEN $4 THEN NOW() ELSE NULL END WHERE user_id=$1`,[userId,next,JSON.stringify(state),completed]);
    if(completed)await client.query(`UPDATE player_profiles SET tutorial_completed_at=NOW(),intro_seen=TRUE,trust=trust+2 WHERE user_id=$1`,[userId]);
    await client.query(`INSERT INTO analytics_events(user_id,event_name,properties) VALUES($1,'tutorial_step',$2)`,[userId,JSON.stringify({action,step:next,completed})]);
    return{completed,step:next,current:completed?null:TUTORIAL_STEPS[next]};
  });
}
