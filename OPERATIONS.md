# Эксплуатация

## Railway

Для production нужны три ресурса в одном Railway Project:

1. приложение из этого репозитория;
2. PostgreSQL;
3. Redis.

Добавьте Volume и смонтируйте его в `/backups`. Без Volume локальные backup-файлы исчезнут при пересоздании контейнера. Для второй независимой копии задайте `BACKUP_WEBHOOK_URL` на собственный HTTP PUT endpoint объектного хранилища.

## Проверка после deploy

```text
GET /health
GET /metrics     # Bearer METRICS_TOKEN, если токен задан
GET /admin/
```

`/health` возвращает 503, когда в production недоступен обязательный Redis.

## Backup

Ручная копия:

```bash
npm run backup
```

Проверка восстановления в одноразовую пустую базу:

```bash
TEST_DATABASE_URL='postgresql://...' npm run backup:verify -- /backups/eighth-floor-manual-....dump
```

Восстановление основной базы требует явного подтверждения:

```bash
RESTORE_CONFIRM=YES DATABASE_URL='postgresql://...' npm run backup:restore -- /backups/eighth-floor-manual-....dump
```

Экспорт переносимых CSV:

```bash
npm run export:data -- /backups/export-manual
```

Перед восстановлением включите в админке `readonly_mode`, остановите рекламный трафик и сделайте ещё одну копию текущей базы.

## Аварийный режим

В админ-панели доступны независимые переключатели:

- только чтение;
- технические работы;
- экспедиции;
- realtime;
- рынок;
- сценарии дня;
- записки;
- магазин;
- поддержка.

`readonly_mode` блокирует изменяющие игровые API, но оставляет healthcheck, Telegram webhook, аналитику сессий и административный доступ.

## Наблюдаемость

- `SENTRY_DSN` включает серверный Sentry.
- клиент отправляет `client_error` в продуктовую аналитику;
- `/metrics` отдаёт Prometheus-метрики HTTP, realtime, Telegram API и платежей;
- структурированные JSON-логи пишет Fastify;
- админка показывает Redis, PostgreSQL, очередь рассылок, ошибки клиента, платежи и активные матчи.

Для внешнего uptime-monitor используйте `/health` с интервалом 1–5 минут.

## Масштабирование

PostgreSQL — источник истины. Redis хранит presence, rate limits, idempotency, matchmaking, кэш и краткоживущие снимки матчей. Socket.IO использует Redis Streams Adapter. При нескольких экземплярах приложения все экземпляры должны смотреть в один Redis и PostgreSQL.

Перед увеличением числа экземпляров убедитесь, что:

- Railway проксирует WebSocket;
- `REDIS_URL` общий;
- `DATABASE_URL` общий;
- миграции завершились;
- backup Volume не воспринимается как единственная внешняя копия;
- лимиты PostgreSQL connections соответствуют числу экземпляров.
