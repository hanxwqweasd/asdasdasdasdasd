import * as Sentry from '@sentry/node';
import { config } from '../config.js';

let initialized = false;

export function initSentry(): void {
  if (!config.SENTRY_DSN || initialized) return;
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    release: `eighth-floor@${config.APP_VERSION}`,
    tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false
  });
  initialized = true;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.withScope(scope => {
    if (context) scope.setContext('context', context);
    Sentry.captureException(error);
  });
}

export async function flushSentry(): Promise<void> {
  if (initialized) await Sentry.flush(2000);
}
