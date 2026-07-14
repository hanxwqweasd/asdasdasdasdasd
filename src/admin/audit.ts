import type { FastifyRequest } from 'fastify';
import { pool } from '../db.js';
import type { AdminPrincipal } from './rbac.js';

export async function writeAudit(admin: AdminPrincipal, action: string, entityType: string, entityId: string | null, details: unknown, request?: FastifyRequest): Promise<void> {
  await pool.query(`INSERT INTO admin_audit_log(admin_id,action,entity_type,entity_id,details,ip,user_agent)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[admin.id,action,entityType,entityId,JSON.stringify(details ?? {}),request?.ip ?? null,request?.headers['user-agent'] ?? null]);
}
