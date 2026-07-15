import type { FastifyBaseLogger } from 'fastify';
import { pool } from '../db.js';
import { config } from '../config.js';
import { runBackupScript } from './worker.js';

const STARTUP_BACKUP_LOCK_KEY = 'eighth-floor:startup-backup:v1';

function deploymentKey(): string {
  const railwayDeployment = process.env.RAILWAY_DEPLOYMENT_ID?.trim();
  if (railwayDeployment) return `railway:${railwayDeployment}`;
  const railwayReplica = process.env.RAILWAY_REPLICA_ID?.trim();
  if (railwayReplica) return `replica-release:${config.APP_VERSION}`;
  return `release:${config.APP_VERSION}`;
}

/**
 * Creates at most one pre-migration backup for a Railway deployment.
 * Railway may start several replicas concurrently; a PostgreSQL advisory lock
 * and a persistent deployment marker prevent duplicate pg_dump executions.
 */
export async function runPreMigrationBackupOnce(logger: FastifyBaseLogger): Promise<void> {
  if (!config.PRE_MIGRATION_BACKUP) return;

  const client = await pool.connect();
  const key = deploymentKey();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [STARTUP_BACKUP_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS deployment_startup_runs (
        deployment_key TEXT NOT NULL,
        task TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('completed','failed')),
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (deployment_key, task)
      )
    `);

    const already = await client.query(
      `SELECT status, completed_at FROM deployment_startup_runs
       WHERE deployment_key=$1 AND task='pre-migration-backup'`,
      [key],
    );
    if (already.rowCount) {
      logger.info({ deploymentKey: key, completedAt: already.rows[0].completed_at },
        'Pre-migration backup already completed for this deployment; skipping');
      return;
    }

    const exists = await client.query(`SELECT to_regclass('public.users') existing`);
    if (!exists.rows[0]?.existing) {
      logger.info({ deploymentKey: key }, 'Database is empty; pre-migration backup is not required');
      await client.query(
        `INSERT INTO deployment_startup_runs(deployment_key,task,status,details)
         VALUES($1,'pre-migration-backup','completed',$2::jsonb)
         ON CONFLICT(deployment_key,task) DO NOTHING`,
        [key, JSON.stringify({ skipped: true, reason: 'empty_database' })],
      );
      return;
    }

    logger.info({ deploymentKey: key }, 'Creating pre-migration backup');
    try {
      const backup = await runBackupScript('pre-migration');
      await client.query(
        `INSERT INTO deployment_startup_runs(deployment_key,task,status,details)
         VALUES($1,'pre-migration-backup','completed',$2::jsonb)
         ON CONFLICT(deployment_key,task) DO UPDATE
         SET status=EXCLUDED.status, details=EXCLUDED.details, completed_at=NOW()`,
        [key, JSON.stringify({ path: backup.path, size: backup.size, checksum: backup.checksum })],
      );
      logger.info({ deploymentKey: key, path: backup.path, size: backup.size, checksum: backup.checksum },
        'Pre-migration backup completed');
    } catch (error) {
      logger.error({ error, deploymentKey: key }, 'Pre-migration backup failed');
      if (config.PRE_MIGRATION_BACKUP_REQUIRED) throw error;
      logger.warn('Continuing startup because PRE_MIGRATION_BACKUP_REQUIRED=false');
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [STARTUP_BACKUP_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}
