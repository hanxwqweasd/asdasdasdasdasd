import { pool, withTransaction } from '../db.js';
import { AppError } from '../errors.js';
import { applyGrantConfig } from '../shop-service.js';

export async function collectionsSnapshot(userId:string|number){
  const [defs,inv,claims,achievements]=await Promise.all([
    pool.query(`SELECT id,slug,title,description,required_items,reward_config,seasonal FROM collections WHERE active=TRUE ORDER BY title`),
    pool.query(`SELECT item_id,quantity FROM inventory WHERE user_id=$1`,[userId]),
    pool.query(`SELECT collection_id FROM collection_claims WHERE user_id=$1`,[userId]),
    pool.query(`SELECT a.id,a.slug,a.title,a.description,a.hidden,ua.unlocked_at FROM achievements a LEFT JOIN user_achievements ua ON ua.achievement_id=a.id AND ua.user_id=$1 WHERE a.active=TRUE AND (a.hidden=FALSE OR ua.unlocked_at IS NOT NULL) ORDER BY ua.unlocked_at DESC NULLS LAST,a.title`,[userId])
  ]);const map=Object.fromEntries(inv.rows.map(x=>[x.item_id,Number(x.quantity)]));const claimed=new Set(claims.rows.map(x=>x.collection_id));
  return{collections:defs.rows.map(x=>{const req=x.required_items??{};const entries=Object.entries(req).map(([itemId,needed])=>({itemId,needed:Number(needed),owned:map[itemId]??0}));return{...x,entries,complete:entries.every(e=>e.owned>=e.needed),claimed:claimed.has(x.id)};}),achievements:achievements.rows};
}
export async function claimCollection(userId:string|number,collectionId:string){return withTransaction(async client=>{const found=await client.query(`SELECT required_items,reward_config FROM collections WHERE id=$1 AND active=TRUE FOR SHARE`,[collectionId]);if(!found.rows[0])throw new AppError('Коллекция не найдена',404,'COLLECTION_NOT_FOUND');const existing=await client.query(`SELECT 1 FROM collection_claims WHERE collection_id=$1 AND user_id=$2`,[collectionId,userId]);if(existing.rowCount)throw new AppError('Награда уже получена',409,'COLLECTION_ALREADY_CLAIMED');for(const[itemId,needed]of Object.entries(found.rows[0].required_items??{})){const inv=await client.query(`SELECT quantity FROM inventory WHERE user_id=$1 AND item_id=$2`,[userId,itemId]);if(Number(inv.rows[0]?.quantity??0)<Number(needed))throw new AppError('Коллекция ещё не собрана',409,'COLLECTION_INCOMPLETE');}await applyGrantConfig(client,userId,found.rows[0].reward_config);await client.query(`INSERT INTO collection_claims(collection_id,user_id) VALUES($1,$2)`,[collectionId,userId]);return{ok:true};});}
export async function unlockAchievement(userId:string|number,slug:string,context:Record<string,unknown>={}){const result=await pool.query(`INSERT INTO user_achievements(achievement_id,user_id,context) SELECT id,$2,$3 FROM achievements WHERE slug=$1 AND active=TRUE ON CONFLICT DO NOTHING RETURNING achievement_id`,[slug,userId,JSON.stringify(context)]);return Boolean(result.rowCount);}
