# V4.1.0 — Railway startup and healthcheck fix

- Railway healthcheck timeout increased from 120 to 300 seconds.
- Pre-migration backup is serialized by a PostgreSQL advisory lock.
- Only one backup is created per Railway deployment, even with multiple replicas.
- Other replicas skip the duplicate `pg_dump` and continue to migrations.
- Backup completion is persisted in `deployment_startup_runs`.
- Existing migration advisory locking remains enabled.
