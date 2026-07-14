# Railway setup-safe mode

If PostgreSQL variables are missing, the service now starts instead of crashing.

- `/health` returns HTTP 200 with `setupRequired: true`.
- `/setup` displays the missing variable diagnosis.
- No gameplay, payment, admin, or migration routes are enabled until PostgreSQL is connected.
- After `DATABASE_URL` or `PGHOST + PGUSER + PGDATABASE` appears, the same build starts the complete application automatically.

The application recognizes these PostgreSQL URL aliases:

- `DATABASE_URL`
- `DATABASE_PRIVATE_URL`
- `DATABASE_PUBLIC_URL`
- `POSTGRES_URL`
- `POSTGRESQL_URL`
- `POSTGRES_DATABASE_URL`

It can also assemble a URL from Railway/PostgreSQL component variables.
