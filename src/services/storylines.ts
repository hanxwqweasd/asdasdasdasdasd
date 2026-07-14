import { pool } from '../db.js';

export async function recordBehavior(userId:string|number,key:string,weight=1,context:Record<string,unknown>={}):Promise<void>{
  await pool.query(`INSERT INTO behavior_events(user_id,behavior_key,weight,context) VALUES($1,$2,$3,$4)`,[userId,key,weight,JSON.stringify(context)]);
  if(key==='lie')await pool.query(`UPDATE player_profiles SET no_lie_since=CURRENT_DATE WHERE user_id=$1`,[userId]);
  await evaluateStorylines(userId);
}
export async function evaluateStorylines(userId:string|number):Promise<void>{
  const lines=await pool.query(`SELECT id,trigger_rules FROM storylines WHERE active=TRUE AND NOT EXISTS(SELECT 1 FROM storyline_assignments a WHERE a.storyline_id=storylines.id AND a.user_id=$1)`,[userId]);
  for(const line of lines.rows){const rule=line.trigger_rules??{};if(!rule.behavior||!rule.threshold)continue;const score=await pool.query(`SELECT COALESCE(SUM(weight),0)::int score FROM behavior_events WHERE user_id=$1 AND behavior_key=$2`,[userId,rule.behavior]);if(Number(score.rows[0].score)>=Number(rule.threshold))await pool.query(`INSERT INTO storyline_assignments(storyline_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[line.id,userId]);}
}
export async function playerStorylines(userId:string|number){return (await pool.query(`SELECT s.id,s.slug,s.title,s.description,s.chapters,a.chapter,a.state,a.assigned_at,a.completed_at FROM storyline_assignments a JOIN storylines s ON s.id=a.storyline_id WHERE a.user_id=$1 ORDER BY a.assigned_at DESC`,[userId])).rows.map(row=>({...row,currentChapter:Array.isArray(row.chapters)?row.chapters[Math.min(row.chapter,row.chapters.length-1)]:null}));}
