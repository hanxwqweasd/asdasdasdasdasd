# Telegram signature validation fix — 2.0.5

Telegram Mini Apps may include both `hash` and the newer `signature` field in `initData`.
For bot-token HMAC validation the data-check-string excludes only `hash`; `signature` remains one of the signed fields.
Previous builds removed both fields, which caused valid Telegram 9.1 initialization data to fail validation.

The release also distinguishes between missing initData and invalid/expired initData in the user-facing diagnostic screen.
