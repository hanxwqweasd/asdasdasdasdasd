import type { PoolClient, QueryResult } from 'pg';
import { pool } from '../db.js';
import { AppError } from '../errors.js';

type Queryable={query:(text:string,values?:unknown[])=>Promise<QueryResult<any>>};

export async function changeInventory(db:Queryable,userId:string|number,itemId:string,delta:number,reason:string,operationId?:string,metadata:Record<string,unknown>={}):Promise<number>{
  if(!Number.isInteger(delta)||delta===0) throw new AppError('Некорректное изменение предмета',400,'INVALID_INVENTORY_DELTA');
  const current=await db.query(`SELECT quantity FROM inventory WHERE user_id=$1 AND item_id=$2 FOR UPDATE`,[userId,itemId]);
  const before=Number(current.rows[0]?.quantity??0);const after=before+delta;
  if(after<0) throw new AppError('Недостаточно предметов',409,'ITEM_QUANTITY_INSUFFICIENT');
  if(after===0) await db.query(`DELETE FROM inventory WHERE user_id=$1 AND item_id=$2`,[userId,itemId]);
  else await db.query(`INSERT INTO inventory(user_id,item_id,quantity) VALUES($1,$2,$3) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=EXCLUDED.quantity`,[userId,itemId,after]);
  await db.query(`INSERT INTO economy_ledger(user_id,asset_type,asset_key,delta,balance_after,reason,operation_id,metadata) VALUES($1,'item',$2,$3,$4,$5,$6,$7)`,[userId,itemId,delta,after,reason,operationId??null,JSON.stringify(metadata)]);
  return after;
}

export async function changeMarks(db:Queryable,userId:string|number,delta:number,reason:string,operationId?:string,metadata:Record<string,unknown>={}):Promise<number>{
  if(!Number.isInteger(delta)||delta===0) throw new AppError('Некорректное изменение жетонов',400,'INVALID_MARKS_DELTA');
  const current=await db.query(`SELECT house_marks FROM player_profiles WHERE user_id=$1 FOR UPDATE`,[userId]);
  if(!current.rows[0]) throw new AppError('Профиль не найден',404,'PROFILE_NOT_FOUND');
  const after=Number(current.rows[0].house_marks)+delta;
  if(after<0) throw new AppError('Недостаточно домовых жетонов',409,'MARKS_INSUFFICIENT');
  await db.query(`UPDATE player_profiles SET house_marks=$2 WHERE user_id=$1`,[userId,after]);
  await db.query(`INSERT INTO economy_ledger(user_id,asset_type,asset_key,delta,balance_after,reason,operation_id,metadata) VALUES($1,'currency','house_marks',$2,$3,$4,$5,$6)`,[userId,delta,after,reason,operationId??null,JSON.stringify(metadata)]);
  return after;
}

export async function ledgerSnapshot(userId:string|number,limit=100){
  return (await pool.query(`SELECT id,asset_type,asset_key,delta,balance_after,reason,operation_id,metadata,created_at FROM economy_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,[userId,limit])).rows;
}

export type TransactionClient=PoolClient;
