# Railway migration hotfix 4.0.2

This release fixes concurrent startup migrations on Railway.

## Changes

- PostgreSQL advisory lock serializes the full migration and seed cycle.
- `expeditions_status_check` is created only when absent.
- The migration no longer drops and recreates the constraint on every startup.
- Concurrent and repeated migration runs are covered by automated and PostgreSQL integration tests.

No existing player, purchase, inventory, apartment, cooperative match, or content data is deleted.
