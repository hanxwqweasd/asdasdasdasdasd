import crypto from 'node:crypto';
import { pool, withTransaction } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { changeInventory, changeMarks } from './economy.js';

const NON_TRADEABLE=new Set(['archive_stamp','blackout_ticket','company_night_ticket','tutorial_key','story_document']);
function assertTradeable(itemId:string){if(NON_TRADEABLE.has(itemId)||itemId.startsWith('story_'))throw new AppError('Сюжетные предметы нельзя продавать',409,'ITEM_NOT_TRADEABLE');}
export async function marketSnapshot(userId:string|number,itemId?:string){
  const [listings,orders,history,mine]=await Promise.all([
    pool.query(`SELECT l.id,l.item_id,l.remaining,l.price_per_unit,l.anonymous,l.expires_at,l.created_at,CASE WHEN l.anonymous THEN NULL ELSE u.first_name END seller_name,CASE WHEN l.seller_id=$1 THEN TRUE ELSE FALSE END mine FROM market_listings l JOIN users u ON u.id=l.seller_id WHERE l.status='active' AND l.expires_at>NOW() AND ($2::text IS NULL OR l.item_id=$2) ORDER BY l.price_per_unit,l.created_at LIMIT 100`,[userId,itemId??null]),
    pool.query(`SELECT id,item_id,remaining,max_price,expires_at,created_at FROM market_orders WHERE status='active' AND expires_at>NOW() AND ($1::text IS NULL OR item_id=$1) ORDER BY max_price DESC,created_at LIMIT 50`,[itemId??null]),
    pool.query(`SELECT item_id,DATE_TRUNC('hour',created_at) bucket,ROUND(AVG(unit_price))::int avg_price,SUM(quantity)::int volume,MIN(unit_price)::int low,MAX(unit_price)::int high FROM market_trades WHERE created_at>NOW()-INTERVAL '30 days' AND ($1::text IS NULL OR item_id=$1) GROUP BY item_id,bucket ORDER BY bucket DESC LIMIT 200`,[itemId??null]),
    pool.query(`SELECT 'listing' kind,id,item_id,remaining quantity,price_per_unit price,status,created_at FROM market_listings WHERE seller_id=$1 UNION ALL SELECT 'order',id,item_id,remaining,max_price,status,created_at FROM market_orders WHERE buyer_id=$1 ORDER BY created_at DESC LIMIT 100`,[userId])
  ]);return{listings:listings.rows,orders:orders.rows,history:history.rows,mine:mine.rows,commissionPercent:config.MARKET_COMMISSION_PERCENT};
}

export async function createListing(userId:string|number,itemId:string,quantity:number,price:number,anonymous:boolean,operationId:string){assertTradeable(itemId);return withTransaction(async client=>{
  await changeInventory(client,userId,itemId,-quantity,'market_escrow',operationId);const id=crypto.randomUUID();
  await client.query(`INSERT INTO market_listings(id,seller_id,item_id,quantity,remaining,price_per_unit,anonymous,expires_at) VALUES($1,$2,$3,$4,$4,$5,$6,NOW()+INTERVAL '7 days')`,[id,userId,itemId,quantity,price,anonymous]);return{id};
});}

export async function buyListing(userId:string|number,listingId:string,quantity:number,operationId:string){return withTransaction(async client=>{
  const found=await client.query(`SELECT * FROM market_listings WHERE id=$1 FOR UPDATE`,[listingId]);const listing=found.rows[0];
  if(!listing||listing.status!=='active'||new Date(listing.expires_at).getTime()<=Date.now())throw new AppError('Лот недоступен',404,'MARKET_LISTING_UNAVAILABLE');
  if(String(listing.seller_id)===String(userId))throw new AppError('Нельзя купить собственный лот',409,'MARKET_SELF_BUY');
  if(quantity>Number(listing.remaining))throw new AppError('В лоте меньше предметов',409,'MARKET_QUANTITY_CHANGED');
  const gross=quantity*Number(listing.price_per_unit);const commission=Math.ceil(gross*config.MARKET_COMMISSION_PERCENT/100);const sellerNet=gross-commission;
  await changeMarks(client,userId,-gross,'market_purchase',operationId,{listingId});
  await changeMarks(client,listing.seller_id,sellerNet,'market_sale',operationId,{listingId,commission});
  await changeInventory(client,userId,listing.item_id,quantity,'market_purchase',operationId,{listingId});
  const remaining=Number(listing.remaining)-quantity;await client.query(`UPDATE market_listings SET remaining=$2,status=CASE WHEN $2=0 THEN 'sold' ELSE 'active' END,updated_at=NOW() WHERE id=$1`,[listingId,remaining]);
  const tradeId=crypto.randomUUID();await client.query(`INSERT INTO market_trades(id,listing_id,seller_id,buyer_id,item_id,quantity,unit_price,commission) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[tradeId,listingId,listing.seller_id,userId,listing.item_id,quantity,listing.price_per_unit,commission]);
  await client.query(`INSERT INTO item_provenance(item_id,quantity,from_user_id,to_user_id,source_type,source_id) VALUES($1,$2,$3,$4,'market',$5)`,[listing.item_id,quantity,listing.seller_id,userId,tradeId]);return{tradeId,gross,commission,remaining};
});}

export async function cancelListing(userId:string|number,listingId:string,operationId:string){return withTransaction(async client=>{const found=await client.query(`SELECT * FROM market_listings WHERE id=$1 AND seller_id=$2 FOR UPDATE`,[listingId,userId]);const row=found.rows[0];if(!row||row.status!=='active')throw new AppError('Лот нельзя отменить',409,'MARKET_LISTING_NOT_ACTIVE');if(Number(row.remaining)>0)await changeInventory(client,userId,row.item_id,Number(row.remaining),'market_return',operationId,{listingId});await client.query(`UPDATE market_listings SET remaining=0,status='cancelled',updated_at=NOW() WHERE id=$1`,[listingId]);return{ok:true};});}

export async function createOrder(userId:string|number,itemId:string,quantity:number,maxPrice:number,operationId:string){assertTradeable(itemId);return withTransaction(async client=>{const reserved=quantity*maxPrice;await changeMarks(client,userId,-reserved,'market_order_reserve',operationId);const id=crypto.randomUUID();await client.query(`INSERT INTO market_orders(id,buyer_id,item_id,quantity,remaining,max_price,reserved_marks,expires_at) VALUES($1,$2,$3,$4,$4,$5,$6,NOW()+INTERVAL '7 days')`,[id,userId,itemId,quantity,maxPrice,reserved]);return{id,reserved};});}

export async function cancelOrder(userId:string|number,orderId:string,operationId:string){return withTransaction(async client=>{const found=await client.query(`SELECT * FROM market_orders WHERE id=$1 AND buyer_id=$2 FOR UPDATE`,[orderId,userId]);const row=found.rows[0];if(!row||row.status!=='active')throw new AppError('Заявку нельзя отменить',409,'MARKET_ORDER_NOT_ACTIVE');const refund=Number(row.reserved_marks);if(refund>0)await changeMarks(client,userId,refund,'market_order_refund',operationId,{orderId});await client.query(`UPDATE market_orders SET status='cancelled',remaining=0,reserved_marks=0 WHERE id=$1`,[orderId]);return{ok:true,refund};});}
