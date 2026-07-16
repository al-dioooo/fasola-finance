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

## Deployment (Azure VM, systemd, no Docker)

Live at **https://fasola-finance.azuregarden.dedyn.io**, as systemd service
`fasola-finance` on `127.0.0.1:3100` behind nginx, from
`/home/aliceevr/projects/fasola/fasola-finance` on the Azure VM (`fasola-vm`,
malaysiawest). `.env` mirrors `.env.example`; `DATABASE_URL` points at the same
`fasola` database the bot uses. Health check: `GET /healthz`.

### Deploy an update

Push to `main` first — the VM deploys from GitHub, not from your working tree.
Then, from your Mac:

```bash
ssh -i ~/.ssh/fasola_azure aliceevr@85.211.216.153 \
  'projects/fasola/fasola-finance/deploy/deploy.sh'
```

`deploy/deploy.sh` fetches `origin/main`, dumps the database, rebuilds
(`dist/web` + `dist/server`), restarts the service, then verifies health and
migrations — rolling back automatically if either check fails. It prints the
incoming commits before it changes anything.

Useful flags:

```bash
deploy/deploy.sh --ref v1.2.0    # deploy a tag/branch/SHA instead of origin/main
deploy/deploy.sh --ref a1b2c3d   # revert to a known-good commit
deploy/deploy.sh --force         # discard uncommitted edits made on the VM
deploy/deploy.sh --skip-backup   # skip the pre-migration dump (no new migrations)
deploy/deploy.sh --no-rollback   # keep a broken build up so you can debug it live
```

Your Mac's IP must be in the `fasola-nsg` allow-list for port 22, otherwise the
SSH connection times out. `~/.ssh/fasola_azure` is the passphraseless deploy key.

### Deploy order (two repos, one database)

**Deploy [fasola-order-bot](../fasola-order-bot) first, then this app**, whenever
a release touches both. The bot owns the shared bot tables and migrates them;
this dashboard reads columns those migrations create, so starting it against an
older bot schema surfaces as 500s on the pages that read them (the menu page and
the bot's `009_products_variant_pricing` are the live example). This repo owns
only the `fin_*` tables.

### Database migrations

**Migrations are not a separate step.** `server/src/server.ts` calls
`runMigrations()` before it listens, so restarting the service applies every
pending migration in `server/src/db/migrations/index.ts`, recording each in the
`fin_schema_migrations` table. Deploying code deploys schema.

There are **no down-migrations**. That is why `deploy.sh` dumps the database to
`~/backups/fasola/` *before* the restart (keeping the last 10), and re-checks
`fin_schema_migrations` against the IDs the new code declares *after* it. A
failed migration means the service fails to boot, which the health check catches.

Rollback restores **code, not schema**. Migrations are additive, so the older
build runs fine against the newer schema. To undo a schema change, restore the
dump: `gunzip -c ~/backups/fasola/fasola-<stamp>-pre-<sha>.sql.gz | psql "$DATABASE_URL"`.

Inspect what is applied at any time:

```bash
psql -U postgres -h 127.0.0.1 -d fasola -c 'SELECT id, applied_at FROM fin_schema_migrations ORDER BY id'
```

> `npm run db:reset` / `db:seed` are **local-only** and refuse to run against
> anything but localhost. They are never part of a deploy.

### First-time setup on a new machine

`deploy.sh` needs the directory to be a git clone. On a fresh VM:

```bash
mkdir -p ~/projects/fasola && cd ~/projects/fasola
git clone https://github.com/al-dioooo/fasola-finance.git
cd fasola-finance
cp .env.example .env    # set ADMIN_PASSWORD + SESSION_SECRET + DATABASE_URL
npm ci && npm run build

sudo cp deploy/fasola-finance.service /etc/systemd/system/
sudo cp deploy/nginx-finance.conf /etc/nginx/sites-available/fasola-finance
sudo ln -s ../sites-available/fasola-finance /etc/nginx/sites-enabled/
sudo certbot --nginx -d fasola-finance.azuregarden.dedyn.io
sudo systemctl daemon-reload && sudo systemctl enable --now fasola-finance
```

To convert an existing rsynced directory into a clone in place (`.env`,
`node_modules` and other untracked files survive):

```bash
cd ~/projects/fasola/fasola-finance
git init && git symbolic-ref HEAD refs/heads/main
git remote add origin https://github.com/al-dioooo/fasola-finance.git
git fetch origin main
git reset --mixed origin/main   # inspect `git status` before resetting --hard
```

The unit template ships `User=fasola`; the Azure VM runs the services as
`aliceevr`, so adjust `User=`/`Group=` to match the account that owns
`~/projects/fasola` and `.env`.

## Panduan singkat untuk pemilik (ops runbook)

- **Ganti password dashboard**: edit `ADMIN_PASSWORD` di file `.env` di VPS,
  lalu `sudo systemctl restart fasola-finance`.
- **Pairing ulang WhatsApp**: buka menu **Bot → Status & QR**, tekan
  "Tampilkan QR", lalu scan dari HP bisnis (WhatsApp → Perangkat Tertaut).
- **Bot tidak membalas?** Cek pill status di Beranda; kalau merah, coba
  "Sambungkan Ulang" di halaman Bot. Kalau masih merah, hubungi admin teknis.
