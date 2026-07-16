# Bootstrap network fix 4.3.2

The Telegram client can provide valid `initData` while Railway is still routing traffic during a deployment or while a replica briefly returns 502/503. Release 4.3.2 separates this state from Telegram authentication errors.

- `/api/public-status` is excluded from local and Redis rate limiting.
- Redis limiter failures no longer break ordinary HTTP requests.
- The client retries public status four times with timeout and exponential delay.
- HTTP status and server error code are preserved in diagnostics.
- Retry no longer clears valid Telegram `initData`.
- 502/503/504 are shown as server startup/network errors, not invalid Telegram launch.
