import { pool } from '../db.js';
import { ROOM_TEMPLATES, type RoomTemplate } from './catalog.js';

export async function loadEnabledRooms(): Promise<RoomTemplate[]> {
  const result=await pool.query(`SELECT id,title,description,ambience,accent,choices FROM game_rooms WHERE enabled=TRUE ORDER BY sort_order,id`);
  if(!result.rowCount) return ROOM_TEMPLATES;
  return result.rows.map(row=>({id:row.id,title:row.title,description:row.description,ambience:row.ambience,accent:row.accent,choices:row.choices}));
}
