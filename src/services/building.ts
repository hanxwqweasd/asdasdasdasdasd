import crypto from 'node:crypto';
import { pool, withTransaction } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { changeInventory } from './economy.js';

function codeFor(index:number){return `П-${String(index).padStart(3,'0')}`;}
export async function ensureBuildingMembership(userId:string|number):Promise<string>{
  const existing=await pool.query(`SELECT building_id::text FROM building_members WHERE user_id=$1`,[userId]);
  if(existing.rows[0])return existing.rows[0].building_id;
  return withTransaction(async client=>{
    // Serialise first-time assignments. Without this lock several simultaneous
    // registrations can all observe the same building count and create P-001.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('building-assignment'))`);
    const again=await client.query(`SELECT building_id::text FROM building_members WHERE user_id=$1 FOR UPDATE`,[userId]);
    if(again.rows[0])return again.rows[0].building_id;
    let selected=await client.query(`SELECT b.id::text FROM buildings b WHERE (SELECT COUNT(*) FROM building_members m WHERE m.building_id=b.id)<b.capacity ORDER BY b.created_at,b.code LIMIT 1 FOR UPDATE SKIP LOCKED`);
    let buildingId=selected.rows[0]?.id as string|undefined;
    if(!buildingId){
      const count=await client.query(`SELECT COUNT(*)::int count FROM buildings`);buildingId=crypto.randomUUID();
      await client.query(`INSERT INTO buildings(id,code,title,capacity) VALUES($1,$2,$3,$4)`,[buildingId,codeFor(Number(count.rows[0].count)+1),`Подъезд ${Number(count.rows[0].count)+1}`,config.BUILDING_CAPACITY]);
    }
    await client.query(`INSERT INTO building_members(building_id,user_id) VALUES($1,$2)`,[buildingId,userId]);
    const monday=new Date();monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));const week=monday.toISOString().slice(0,10);
    await client.query(`INSERT INTO building_weekly_goals(id,building_id,week_start,goal_key,title,target,reward_config) VALUES($1,$2,$3,'shared-clues','Собрать 120 улик всем подъездом',120,$4) ON CONFLICT(building_id,week_start,goal_key) DO NOTHING`,[crypto.randomUUID(),buildingId,week,JSON.stringify({marks:20})]);
    return buildingId;
  });
}

export async function buildingSnapshot(userId:string|number){
  const buildingId=await ensureBuildingMembership(userId);
  const [building,members,posts,storage,votes,goals]=await Promise.all([
    pool.query(`SELECT b.*,u.first_name elder_name,u.username elder_username FROM buildings b LEFT JOIN users u ON u.id=b.elder_user_id WHERE b.id=$1`,[buildingId]),
    pool.query(`SELECT u.id::text,u.first_name,u.username,u.photo_url,p.apartment_no,p.profession,p.trust,m.contribution,m.local_trust,m.last_active_at,(p.last_seen>NOW()-INTERVAL '5 minutes') online FROM building_members m JOIN users u ON u.id=m.user_id JOIN player_profiles p ON p.user_id=u.id WHERE m.building_id=$1 ORDER BY m.local_trust DESC,m.joined_at LIMIT 40`,[buildingId]),
    pool.query(`SELECT p.id,p.body,p.pinned,p.created_at,u.id::text author_id,u.first_name author_name,u.username FROM building_posts p JOIN users u ON u.id=p.author_id WHERE p.building_id=$1 AND p.hidden=FALSE ORDER BY p.pinned DESC,p.created_at DESC LIMIT 50`,[buildingId]),
    pool.query(`SELECT item_id,quantity,updated_at FROM building_storage WHERE building_id=$1 AND quantity>0 ORDER BY item_id`,[buildingId]),
    pool.query(`SELECT v.id,v.kind,v.title,v.description,v.options,v.closes_at,v.status,v.result,(SELECT COUNT(*) FROM building_vote_ballots b WHERE b.vote_id=v.id)::int ballots FROM building_votes v WHERE v.building_id=$1 AND (v.status='open' OR v.created_at>NOW()-INTERVAL '14 days') ORDER BY v.status='open' DESC,v.created_at DESC LIMIT 20`,[buildingId]),
    pool.query(`SELECT * FROM building_weekly_goals WHERE building_id=$1 AND week_start>=CURRENT_DATE-7 ORDER BY week_start DESC`,[buildingId])
  ]);
  return{building:building.rows[0],members:members.rows,posts:posts.rows,storage:storage.rows,votes:votes.rows,goals:goals.rows};
}

export async function addBuildingPost(userId:string|number,body:string){
  const buildingId=await ensureBuildingMembership(userId);const id=crypto.randomUUID();
  await pool.query(`INSERT INTO building_posts(id,building_id,author_id,body) VALUES($1,$2,$3,$4)`,[id,buildingId,userId,body]);return{id};
}

export async function storageTransfer(userId:string|number,itemId:string,quantity:number,direction:'deposit'|'withdraw',operationId:string){
  const buildingId=await ensureBuildingMembership(userId);
  return withTransaction(async client=>{
    const signed=direction==='deposit'?quantity:-quantity;
    let inventoryQuantity:number;
    if(direction==='deposit')inventoryQuantity=await changeInventory(client,userId,itemId,-quantity,'building_deposit',operationId,{buildingId});
    else{
      const stored=await client.query(`SELECT quantity FROM building_storage WHERE building_id=$1 AND item_id=$2 FOR UPDATE`,[buildingId,itemId]);
      if(Number(stored.rows[0]?.quantity??0)<quantity)throw new AppError('На складе недостаточно предметов',409,'BUILDING_STORAGE_INSUFFICIENT');
      inventoryQuantity=await changeInventory(client,userId,itemId,quantity,'building_withdraw',operationId,{buildingId});
    }
    if(direction==='deposit'){
      await client.query(`INSERT INTO building_storage(building_id,item_id,quantity) VALUES($1,$2,$3)
        ON CONFLICT(building_id,item_id) DO UPDATE SET quantity=building_storage.quantity+EXCLUDED.quantity,updated_at=NOW()`,[buildingId,itemId,quantity]);
    }else{
      const updated=await client.query(`UPDATE building_storage SET quantity=quantity-$3,updated_at=NOW()
        WHERE building_id=$1 AND item_id=$2 AND quantity>=$3 RETURNING quantity`,[buildingId,itemId,quantity]);
      if(!updated.rowCount)throw new AppError('На складе недостаточно предметов',409,'BUILDING_STORAGE_INSUFFICIENT');
      await client.query(`DELETE FROM building_storage WHERE building_id=$1 AND item_id=$2 AND quantity=0`,[buildingId,itemId]);
    }
    await client.query(`INSERT INTO building_storage_log(building_id,user_id,item_id,delta,reason) VALUES($1,$2,$3,$4,$5)`,[buildingId,userId,itemId,signed,direction]);
    await client.query(`UPDATE building_members SET contribution=contribution+$3,last_active_at=NOW() WHERE building_id=$1 AND user_id=$2`,[buildingId,userId,direction==='deposit'?quantity:0]);
    const remaining=await client.query(`SELECT quantity FROM building_storage WHERE building_id=$1 AND item_id=$2`,[buildingId,itemId]);
    return{ok:true,itemId,direction,quantity,inventoryQuantity,storageQuantity:Number(remaining.rows[0]?.quantity??0)};
  });
}

export async function castBuildingVote(userId:string|number,voteId:string,optionKey:string){
  const membership=await pool.query(`SELECT m.building_id::text FROM building_members m JOIN building_votes v ON v.building_id=m.building_id WHERE m.user_id=$1 AND v.id=$2 AND v.status='open' AND v.closes_at>NOW()`,[userId,voteId]);
  if(!membership.rowCount)throw new AppError('Голосование недоступно',404,'VOTE_UNAVAILABLE');
  const vote=await pool.query(`SELECT options FROM building_votes WHERE id=$1`,[voteId]);
  const options=Array.isArray(vote.rows[0]?.options)?vote.rows[0].options:[];
  if(!options.some((x:any)=>x.key===optionKey))throw new AppError('Такого варианта нет',400,'VOTE_OPTION_INVALID');
  await pool.query(`INSERT INTO building_vote_ballots(vote_id,user_id,option_key) VALUES($1,$2,$3) ON CONFLICT(vote_id,user_id) DO UPDATE SET option_key=EXCLUDED.option_key,created_at=NOW()`,[voteId,userId,optionKey]);
  return{ok:true};
}

export async function closeExpiredVotes():Promise<number>{
  const expired=await pool.query(`SELECT id,building_id,kind FROM building_votes WHERE status='open' AND closes_at<=NOW() FOR UPDATE SKIP LOCKED`);let closed=0;
  for(const row of expired.rows){
    const result=await pool.query(`SELECT option_key,COUNT(*)::int votes FROM building_vote_ballots WHERE vote_id=$1 GROUP BY option_key ORDER BY votes DESC,option_key LIMIT 1`,[row.id]);
    const winner=result.rows[0]?.option_key??null;
    await pool.query(`UPDATE building_votes SET status='closed',result=$2 WHERE id=$1`,[row.id,JSON.stringify({winner})]);
    if(row.kind==='elder'&&winner&&/^\d+$/.test(winner))await pool.query(`UPDATE buildings SET elder_user_id=$2,updated_at=NOW() WHERE id=$1`,[row.building_id,winner]);
    if(winner)await pool.query(`UPDATE buildings SET consequences=consequences||$2::jsonb,updated_at=NOW() WHERE id=$1`,[row.building_id,JSON.stringify([{voteId:row.id,winner,at:new Date().toISOString()}])]);closed++;
  }return closed;
}
