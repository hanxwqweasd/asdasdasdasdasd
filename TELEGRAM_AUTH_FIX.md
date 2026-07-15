# Telegram Mini App auth fix 2.0.4

This release fixes false `TELEGRAM_AUTH_REQUIRED` errors in Telegram clients.

- waits up to 7 seconds for `Telegram.WebApp.initData`;
- reads `tgWebAppData` from launch URL parameters as a fallback;
- sends current initData dynamically on every API call and Socket.IO connection;
- stores launch data only in sessionStorage and lets the server validate it;
- version-busts Telegram menu and `/start` Web App URLs;
- disables caching for `app.js`;
- provides safe client-side launch diagnostics and a fresh `/start` route.
