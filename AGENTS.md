# AGENTS.md — fasola-finance

Admin dashboard for Dapoer Mami Fasola. One Fastify service (port 3100)
serving a JSON API under `/api` plus the built Vite/React SPA. Single
non-technical admin user; UI copy is Bahasa Indonesia; mobile-first.

## Non-negotiables

1. **Shared database contract.** This app shares PostgreSQL database `fasola`
   with fasola-order-bot. Read `../fasola-order-bot/docs/db-contract.md`
   before touching any query. This repo owns DDL only for `fin_*` tables
   (migrations in `server/src/db/migrations/index.ts`, tracked in
   `fin_schema_migrations`). Bot tables are DML-only: order status/payment
   updates (always bump `updated_at` — it is the concurrency token) and
   product rows (advisory lock `hashtext('products_next_id')` for PRD ids).
2. **Timezone.** Business dates are Asia/Jakarta. Server-side helpers in
   `server/src/shared/dates.ts`; SQL buckets via
   `created_at::timestamptz AT TIME ZONE 'Asia/Jakarta'`. The browser never
   does business-date math.
3. **Revenue definition.** Only `Confirmed/Processing/Ready/Completed`
   orders count (`REVENUE_ORDER_STATUSES`). Always surface unpriced-order
   counts (`estimated_subtotal IS NULL`) next to money figures.
4. **Enum values stay English** (DB/API); Indonesian labels live only in
   `web/src/lib/labels.ts`. The API contract is `web/src/api/types.ts`.
5. **Keep it warung-scale.** No user tables, no double-entry accounting, no
   inventory quantities, no multi-tenant anything. This is a small business
   tool maintained by one person on a 2 GB VPS. No Docker, ever.

## Stack & layout

- `server/src` — Fastify 5, zod 4, pg (Pool max 5), pino via Fastify logger.
  Stores follow `createXStore(db)` with async methods and `$n` params.
  Auth = single `ADMIN_PASSWORD` + signed cookie (`@fastify/cookie`); guard
  applied in `app.ts` to everything under `/api` except `/api/auth/*`.
- `web/src` — React 19, react-router 7, TanStack Query 5, Tailwind 4,
  Recharts. Fetch through `web/src/api/client.ts`.
- `tests` — vitest against a real Postgres (`fasola_finance_test`),
  schema-per-suite isolation (`tests/helpers/db.ts`), route tests via
  `app.inject` + `loginAndGetCookie` (`tests/helpers/app.ts`). Bot tables come
  from `tests/fixtures/bot-schema.sql` — keep it in sync with the bot's
  migrations when the bot schema changes.

## Quality gates (all must pass)

```bash
npm run typecheck && npm test && npm run lint && npm run build
```

## Style

TS strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESM,
two-space indent, double quotes, no trailing commas, printWidth 100.
`no-explicit-any` and `no-floating-promises` are errors. Conventional Commits.
