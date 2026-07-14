import { pool, withTransaction } from '../db.js';
import { AppError } from '../errors.js';
import { changeMarks, changeInventory } from './economy.js';
import { recordBehavior } from './storylines.js';

export async function activeDailyScenario(userId:string|number){
  const weekday=new Date().getUTCDay();
  const scenario=await pool.query(`SELECT * FROM daily_scenarios WHERE active=TRUE AND (scheduled_date=CURRENT_DATE OR (scheduled_date IS NULL AND weekday=$1)) ORDER BY scheduled_date IS NOT NULL DESC,priority DESC LIMIT 1`,[weekday]);
  if(!scenario.rows[0])return null;const row=scenario.rows[0];
  const progress=await pool.query(`SELECT step,state,completed_at FROM daily_scenario_progress WHERE scenario_id=$1 AND user_id=$2 AND play_date=CURRENT_DATE`,[row.id,userId]);
  return{scenario:{id:row.id,slug:row.slug,title:row.title,teaser:row.teaser,scenes:row.scenes},progress:progress.rows[0]??{step:0,state:{},completed_at:null}};
}

export async function dailyAction(userId:string|number,scenarioId:string,action:string){
  return withTransaction(async client=>{
    const scenarioResult=await client.query(`SELECT slug,scenes,reward_config FROM daily_scenarios WHERE id=$1 AND active=TRUE AND (scheduled_date=CURRENT_DATE OR scheduled_date IS NULL) FOR SHARE`,[scenarioId]);
    const scenario=scenarioResult.rows[0];if(!scenario)throw new AppError('Сегодня это происшествие недоступно',404,'DAILY_SCENARIO_UNAVAILABLE');
    await client.query(`INSERT INTO daily_scenario_progress(scenario_id,user_id) VALUES($1,$2) ON CONFLICT(scenario_id,user_id,play_date) DO NOTHING`,[scenarioId,userId]);
    const current=await client.query(`SELECT step,state,completed_at FROM daily_scenario_progress WHERE scenario_id=$1 AND user_id=$2 AND play_date=CURRENT_DATE FOR UPDATE`,[scenarioId,userId]);const row=current.rows[0];
    if(row.completed_at)return{completed:true,step:Number(row.step)};
    const scenes=Array.isArray(scenario.scenes)?scenario.scenes:[];const scene=scenes[Number(row.step)];
    if(!scene)throw new AppError('Сценарий повреждён',500,'DAILY_SCENARIO_INVALID');
    const allowed=Array.isArray(scene.actions)?scene.actions.map((x:any)=>x.key):[];
    if(!allowed.includes(action))throw new AppError('Такого действия в сцене нет',400,'DAILY_ACTION_INVALID');
    const next=Number(row.step)+1;const completed=next>=scenes.length-1;
    await client.query(`UPDATE daily_scenario_progress SET step=$3,state=state||$4::jsonb,completed_at=CASE WHEN $5 THEN NOW() ELSE NULL END WHERE scenario_id=$1 AND user_id=$2 AND play_date=CURRENT_DATE`,[scenarioId,userId,next,JSON.stringify({[scene.id]:action}),completed]);
    if(completed){
      const reward=scenario.reward_config??{};if(Number(reward.marks)>0)await changeMarks(client,userId,Number(reward.marks),'daily_scenario',`daily:${scenarioId}:${userId}:${new Date().toISOString().slice(0,10)}`);
      if(reward.item)await changeInventory(client,userId,String(reward.item),Number(reward.quantity??1),'daily_scenario');
      await client.query(`UPDATE player_profiles SET clues=clues+$2,last_daily_scenario_date=CURRENT_DATE WHERE user_id=$1`,[userId,Number(reward.clues??0)]);
      if(scenario.slug==='broken-lift')await client.query(`INSERT INTO user_achievements(achievement_id,user_id,context) SELECT id,$1,$2 FROM achievements WHERE slug='impossible-elevator' ON CONFLICT DO NOTHING`,[userId,JSON.stringify({scenarioId})]);
      await client.query(`INSERT INTO user_achievements(achievement_id,user_id,context) SELECT a.id,$1,$2 FROM achievements a JOIN player_profiles p ON p.user_id=$1 WHERE a.slug='week-no-lies' AND CURRENT_DATE-p.no_lie_since>=7 ON CONFLICT DO NOTHING`,[userId,JSON.stringify({scenarioId,checkedAt:new Date().toISOString()})]);
    }
    await client.query(`INSERT INTO analytics_events(user_id,event_name,properties) VALUES($1,'daily_action',$2)`,[userId,JSON.stringify({scenarioId,action,step:next,completed})]);
    void recordBehavior(userId,action==='ask'?'social':'investigate',1,{scenarioId}).catch(()=>undefined);
    return{completed,step:next,scene:scenes[next]??null};
  });
}
