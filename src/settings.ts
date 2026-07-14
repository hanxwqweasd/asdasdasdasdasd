import { pool } from './db.js';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const result=await pool.query(`SELECT value FROM system_settings WHERE key=$1`,[key]);
  return (result.rows[0]?.value ?? fallback) as T;
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const result=await pool.query(`SELECT key,value FROM system_settings ORDER BY key`);
  return Object.fromEntries(result.rows.map(row=>[row.key,row.value]));
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await pool.query(`INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2,NOW())
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,[key,JSON.stringify(value)]);
}
