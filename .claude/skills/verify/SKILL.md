---
name: verify
description: Build, launch, and drive fasola-finance against an isolated scratch Postgres to verify changes end-to-end in the browser.
---

# Verifying fasola-finance changes

One Fastify service serves both the API and the built SPA, so the production
build is the easiest real surface — no Vite proxy needed.

## Scratch database (never verify against the live `fasola` DB)

The bot reads the shared DB live; verification writes must stay isolated.
`psql` is not on PATH — use the Homebrew libpq keg:

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
psql postgres://postgres@localhost:5432/postgres \
  -c "DROP DATABASE IF EXISTS fasola_verify" -c "CREATE DATABASE fasola_verify"
psql postgres://postgres@localhost:5432/fasola_verify -q -f tests/fixtures/bot-schema.sql
```

`tests/fixtures/bot-schema.sql` mirrors the bot-owned tables; the server runs
its own `fin_*` migrations on boot.

## Build + launch

```bash
npm run build   # SPA → dist/web, server → dist/server
NODE_ENV=production PORT=3199 LOG_LEVEL=info \
DATABASE_URL=postgres://postgres@localhost:5432/fasola_verify \
ADMIN_PASSWORD=verify-admin-password \
SESSION_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
SESSION_TTL_DAYS=30 GOWA_BASE_URL=http://127.0.0.1:3001 \
GOWA_BASIC_AUTH_USER=x GOWA_BASIC_AUTH_PASSWORD=x \
BOT_BASE_URL=http://127.0.0.1:3010 \
node dist/server/server.js   # run in background; curl /healthz to confirm
```

Port 3100 may be the real dashboard — use a spare port (3199).

## Driving it

- Login page is the entry; fill the password field and submit, or for curl
  probes: `POST /api/auth/login {"password": ...}` and reuse the `Set-Cookie`.
- UI copy is Indonesian; mobile-first. Check phone width (375x812) too — the
  bottom nav bar is the owner's primary navigation and overflows easily.
- Modals are bottom sheets with `max-h-[88dvh] overflow-y-auto`; at 720px
  viewport height their submit buttons fall outside the accessibility tree —
  resize the viewport taller (e.g. 1280x1200) instead of scrolling.
- Confirm persistence in Postgres directly (`psql ... -c "SELECT ..."`), not
  just in the UI; bot-owned tables must get ISO-8601 `updated_at` bumps.

## Teardown

```bash
pkill -f "node dist/server/server.js"
psql postgres://postgres@localhost:5432/postgres -c "DROP DATABASE IF EXISTS fasola_verify"
```
