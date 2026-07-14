import type { PoolClient } from 'pg';
import { z } from 'zod';

export const grantConfigSchema=z.object({
  inventory:z.array(z.object({itemId:z.string().min(1).max(80),quantity:z.number().int().min(1).max(10000)})).default([]),
  profile:z.object({apartmentStyle:z.string().min(1).max(60).optional(),trust:z.number().int().min(-100000).max(100000).optional(),clues:z.number().int().min(-100000).max(100000).optional(),keys:z.number().int().min(-100000).max(100000).optional()}).optional(),
  entitlements:z.array(z.object({key:z.string().min(1).max(100),value:z.unknown().default({})})).default([]),
  clubDays:z.number().int().min(0).max(3650).default(0)
});
export type GrantConfig=z.infer<typeof grantConfigSchema>;

export async function applyGrantConfig(client: PoolClient,userId:string|number,rawConfig:unknown):Promise<GrantConfig>{
  const config=grantConfigSchema.parse(rawConfig??{});
  for(const item of config.inventory) await client.query(`INSERT INTO inventory(user_id,item_id,quantity) VALUES($1,$2,$3)
    ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=inventory.quantity+EXCLUDED.quantity`,[userId,item.itemId,item.quantity]);
  if(config.profile){
    const sets:string[]=[];const values:unknown[]=[userId];
    if(config.profile.apartmentStyle!==undefined){values.push(config.profile.apartmentStyle);sets.push(`apartment_style=$${values.length}`);}
    if(config.profile.trust!==undefined){values.push(config.profile.trust);sets.push(`trust=GREATEST(0,trust+$${values.length})`);}
    if(config.profile.clues!==undefined){values.push(config.profile.clues);sets.push(`clues=GREATEST(0,clues+$${values.length})`);}
    if(config.profile.keys!==undefined){values.push(config.profile.keys);sets.push(`keys_count=GREATEST(0,keys_count+$${values.length})`);}
    if(sets.length) await client.query(`UPDATE player_profiles SET ${sets.join(',')} WHERE user_id=$1`,values);
  }
  for(const entitlement of config.entitlements) await client.query(`INSERT INTO entitlements(user_id,entitlement_key,value) VALUES($1,$2,$3)
    ON CONFLICT(user_id,entitlement_key) DO UPDATE SET value=EXCLUDED.value,granted_at=NOW()`,[userId,entitlement.key,JSON.stringify(entitlement.value)]);
  if(config.clubDays>0) await client.query(`UPDATE player_profiles SET club_until=GREATEST(COALESCE(club_until,NOW()),NOW())+($2::text||' days')::interval WHERE user_id=$1`,[userId,config.clubDays]);
  return config;
}

export async function revokeGrantConfig(client:PoolClient,userId:string|number,rawConfig:unknown):Promise<void>{
  const config=grantConfigSchema.parse(rawConfig??{});
  for(const item of config.inventory) await client.query(`UPDATE inventory SET quantity=GREATEST(0,quantity-$3) WHERE user_id=$1 AND item_id=$2`,[userId,item.itemId,item.quantity]);
  if(config.profile){
    if(config.profile.apartmentStyle) await client.query(`UPDATE player_profiles SET apartment_style=CASE WHEN apartment_style=$2 THEN 'tenant' ELSE apartment_style END WHERE user_id=$1`,[userId,config.profile.apartmentStyle]);
    if(config.profile.trust) await client.query(`UPDATE player_profiles SET trust=GREATEST(0,trust-$2) WHERE user_id=$1`,[userId,config.profile.trust]);
    if(config.profile.clues) await client.query(`UPDATE player_profiles SET clues=GREATEST(0,clues-$2) WHERE user_id=$1`,[userId,config.profile.clues]);
    if(config.profile.keys) await client.query(`UPDATE player_profiles SET keys_count=GREATEST(0,keys_count-$2) WHERE user_id=$1`,[userId,config.profile.keys]);
  }
  for(const entitlement of config.entitlements) await client.query(`DELETE FROM entitlements WHERE user_id=$1 AND entitlement_key=$2`,[userId,entitlement.key]);
  if(config.clubDays>0) await client.query(`UPDATE player_profiles SET club_until=CASE WHEN club_until IS NULL THEN NULL ELSE GREATEST(NOW(),club_until-($2::text||' days')::interval) END WHERE user_id=$1`,[userId,config.clubDays]);
}
