import client from 'prom-client';

client.collectDefaultMetrics({ prefix: 'eighth_floor_' });

export const httpDuration = new client.Histogram({
  name: 'eighth_floor_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]
});

export const telegramErrors = new client.Counter({
  name: 'eighth_floor_telegram_api_errors_total',
  help: 'Telegram Bot API errors',
  labelNames: ['method'] as const
});

export const paymentEvents = new client.Counter({
  name: 'eighth_floor_payment_events_total',
  help: 'Payment events by status',
  labelNames: ['status', 'sku'] as const
});

export const realtimeConnections = new client.Gauge({
  name: 'eighth_floor_realtime_connections',
  help: 'Current Socket.IO connections'
});

export const realtimeMatches = new client.Gauge({
  name: 'eighth_floor_realtime_matches',
  help: 'Current cooperative matches',
  labelNames: ['phase'] as const
});

export const queueDepth = new client.Gauge({
  name: 'eighth_floor_queue_depth',
  help: 'Redis-backed queue depth',
  labelNames: ['queue'] as const
});

export const registry = client.register;
