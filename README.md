# Fasola Finance

Admin dashboard for **Dapoer Mami Fasola** — manages the WhatsApp order bot
([fasola-order-bot](../fasola-order-bot)) and the business: orders & sales
reports, menu, expenses & profit, and bot operations (GoWA session, handoff
inbox, logs). Single admin user, UI in Bahasa Indonesia, mobile-first.

One Node service: Fastify API + the built React SPA served as static files.
Shares the local PostgreSQL database `fasola` with the bot — table ownership
and write rules live in the bot repo's `docs/db-contract.md` (short version:
this app owns only `fin_*` tables; on bot tables it only updates
`orders.order_status` / `orders.payment_status` / `orders.updated_at` and
manages `products` rows with the same semantics as the bot's `/menu` flow).

## Features

- **Beranda** — today's KPIs (omzet, pesanan, pengeluaran, laba), perlu-tindakan
  shortcuts, bot status pill.
- **Pesanan** — list/filter/search, order detail, guarded status & payment
  transitions with optimistic concurrency (409 on concurrent bot writes).
- **Menu** — product CRUD against the bot's live catalog (no hard delete;
  hide via stock status). Warns when a WhatsApp `/menu` change is pending.
- **Pengeluaran** — quick-add expenses by category, monthly lists and totals.
- **Laporan** — omzet per hari/minggu/bulan, laba (omzet − pengeluaran),
  produk terlaris. Revenue counts only Confirmed/Processing/Ready/Completed
  orders; unpriced orders are surfaced, never silently dropped.
- **Bot** — GoWA session status + QR pairing, reconnect/logout, composite
  health (bot/GoWA/DB), handoff inbox (Perlu Bantuan Admin), message & AI logs.

## Local development

Prerequisites: Node >= 24, local PostgreSQL with superuser `postgres` on
`localhost:5432` (DBngin works), databases `fasola` and `fasola_finance_test`:

```bash
createdb -U postgres fasola             # if the bot hasn't created it already
createdb -U postgres fasola_finance_test
cp .env.example .env                    # set ADMIN_PASSWORD + SESSION_SECRET
npm install
npm run dev                             # Fastify :3100 + Vite :5173 (proxied /api)
```

Open http://localhost:5173. Optional for bot-ops screens: run GoWA and the
bot locally (see the bot repo's README).

## Resetting / seeding the dev database

```bash
npm run db:reset        # drop every table, rebuild the schema (asks first)
npm run db:seed         # upsert the seed dataset (safe to re-run)
npm run db:reset:seed   # both, in order
```

Both commands read `DATABASE_URL` from `.env` and **refuse to run against
anything but localhost** — they destroy data and must never touch the VM.
`db:reset` prints what it is about to drop and waits for confirmation; pass
`--force` (`npm run db:reset -- --force`) to skip the prompt, which is required
when there is no TTY. Declining exits non-zero so `&&` chains stop.

`db:reset` rebuilds bot-owned tables from `tests/fixtures/bot-schema.sql` (the
same mirror the tests use, currently bot migrations 001–009) and `fin_*` tables
from the real migration runner. It is the one place this repo does DDL on bot
tables — safe only because the target is a throwaway local database.

**The fixture only mirrors the seven bot tables this dashboard reads**
(`orders`, `products`, `messages`, `ai_logs`, `business_profile`,
`gofood_settings`, `pending_menu_changes`). A reset therefore drops
`conversations`, `order_drafts`, `retry_jobs`, `admin_notifications`,
`gofood_events` and `schema_migrations` without recreating them — the bot
restores those itself on its next boot, when it re-runs migrations 001–009
(all `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so re-running
against fixture-built tables is a no-op and leaves seeded rows intact). If you
want the full schema back without starting the bot, run its migration runner
against `fasola` from the bot repo.

The seed (`scripts/seed-data.ts`) is Dapoer Mami Fasola with the two live
production items (Mie Ayam, Baslok) plus Bubur Ayam, Soto Ayam and Es Teh Manis
— the latter three carry placeholder copy and exercise variant pricing and
`stock_quantity`, which the production rows do not. It also seeds
`business_profile`, the `gofood_settings` defaults, and ~12 `fin_expenses`
rows dated relative to today (Asia/Jakarta). It does **not** seed orders, so
reports and the order list stay empty.

## Quality commands

```bash
npm run typecheck
npm test          # vitest against fasola_finance_test (schema-per-suite)
npm run lint
npm run build     # dist/web (Vite) + dist/server (tsc)
```

## Deployment (VPS, systemd, no Docker)

```bash
# once:
sudo cp deploy/fasola-finance.service /etc/systemd/system/
sudo cp deploy/nginx-finance.conf /etc/nginx/sites-available/finance.evergarden.dedyn.io
sudo ln -s ../sites-available/finance.evergarden.dedyn.io /etc/nginx/sites-enabled/
sudo certbot --nginx -d finance.evergarden.dedyn.io
sudo systemctl daemon-reload && sudo systemctl enable --now fasola-finance

# every deploy:
./deploy/deploy.sh
```

`.env` on the VPS mirrors `.env.example`; `DATABASE_URL` points at the same
`fasola` database the bot uses. Health check: `GET /healthz`.

## Panduan singkat untuk pemilik (ops runbook)

- **Ganti password dashboard**: edit `ADMIN_PASSWORD` di file `.env` di VPS,
  lalu `sudo systemctl restart fasola-finance`.
- **Pairing ulang WhatsApp**: buka menu **Bot → Status & QR**, tekan
  "Tampilkan QR", lalu scan dari HP bisnis (WhatsApp → Perangkat Tertaut).
- **Bot tidak membalas?** Cek pill status di Beranda; kalau merah, coba
  "Sambungkan Ulang" di halaman Bot. Kalau masih merah, hubungi admin teknis.
