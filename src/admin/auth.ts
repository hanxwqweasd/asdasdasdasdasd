import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db.js';
import { AppError } from '../errors.js';
import { effectivePermissions, type AdminPrincipal, type AdminRole } from './rbac.js';

const scrypt = promisify(crypto.scrypt);
const tokenSchema = z.object({ sub:z.string().uuid(), sv:z.number().int().nonnegative(), exp:z.number().int().positive() });

function sessionSecret(): string { return config.ADMIN_SESSION_SECRET ?? config.WEBHOOK_SECRET; }
function base64url(value: string | Buffer): string { return Buffer.from(value).toString('base64url'); }
function sign(value: string): string { return crypto.createHmac('sha256', sessionSecret()).update(value).digest('base64url'); }

export async function hashPassword(password: string): Promise<string> {
  const salt=crypto.randomBytes(16);
  const derived=await scrypt(password,salt,64) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm,saltRaw,hashRaw]=encoded.split('$');
  if(algorithm!=='scrypt'||!saltRaw||!hashRaw) return false;
  const expected=Buffer.from(hashRaw,'base64url');
  const actual=await scrypt(password,Buffer.from(saltRaw,'base64url'),expected.length) as Buffer;
  return expected.length===actual.length && crypto.timingSafeEqual(expected,actual);
}

export function issueAdminToken(adminId: string, sessionVersion: number): string {
  const payload=base64url(JSON.stringify({sub:adminId,sv:sessionVersion,exp:Math.floor(Date.now()/1000)+config.ADMIN_SESSION_HOURS*3600}));
  return `${payload}.${sign(payload)}`;
}

export async function authenticateAdmin(request: FastifyRequest): Promise<AdminPrincipal> {
  const authorization=request.headers.authorization;
  if(typeof authorization!=='string'||!authorization.startsWith('Bearer ')) throw new AppError('Требуется вход в админ-панель',401,'ADMIN_AUTH_REQUIRED');
  const token=authorization.slice(7);
  const [payloadRaw,signature]=token.split('.');
  if(!payloadRaw||!signature) throw new AppError('Сессия повреждена',401,'ADMIN_SESSION_INVALID');
  const expected=sign(payloadRaw);
  const a=Buffer.from(signature); const b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) throw new AppError('Сессия недействительна',401,'ADMIN_SESSION_INVALID');
  let payload: z.infer<typeof tokenSchema>;
  try { payload=tokenSchema.parse(JSON.parse(Buffer.from(payloadRaw,'base64url').toString('utf8'))); }
  catch { throw new AppError('Сессия повреждена',401,'ADMIN_SESSION_INVALID'); }
  if(payload.exp<Math.floor(Date.now()/1000)) throw new AppError('Сессия истекла',401,'ADMIN_SESSION_EXPIRED');
  const result=await pool.query(`SELECT id,username,role,permissions,session_version,active FROM admins WHERE id=$1`,[payload.sub]);
  const row=result.rows[0];
  if(!row||!row.active||Number(row.session_version)!==payload.sv) throw new AppError('Сессия отозвана',401,'ADMIN_SESSION_REVOKED');
  return { id:row.id,username:row.username,role:row.role as AdminRole,permissions:effectivePermissions(row.role,row.permissions),sessionVersion:Number(row.session_version) };
}

export async function bootstrapAdmin(): Promise<void> {
  if(!config.ADMIN_PASSWORD) return;
  const found=await pool.query(`SELECT id FROM admins WHERE username=$1`,[config.ADMIN_USERNAME]);
  if(found.rowCount) return;
  const passwordHash=await hashPassword(config.ADMIN_PASSWORD);
  await pool.query(`INSERT INTO admins(id,username,password_hash,role,permissions,active) VALUES($1,$2,$3,'superadmin','[]'::jsonb,TRUE)`,
    [crypto.randomUUID(),config.ADMIN_USERNAME,passwordHash]);
}
