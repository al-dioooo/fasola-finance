import type { Db } from "../client.js";

export interface Migration {
  id: string;
  statements: string[];
}

// Ownership contract with fasola-order-bot (see that repo's docs/db-contract.md):
// this dashboard only creates fin_* tables, tracked in fin_schema_migrations.
// Bot-owned tables (orders, products, messages, ...) are DML-only from here.
export const migrations: Migration[] = [
  {
    id: "001_fin_expenses",
    statements: [
      `CREATE TABLE IF NOT EXISTS fin_expenses (
        expense_id TEXT PRIMARY KEY,
        expense_date DATE NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        amount NUMERIC(14, 0) NOT NULL CHECK (amount > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_fin_expenses_date ON fin_expenses (expense_date)`,
      `CREATE INDEX IF NOT EXISTS idx_fin_expenses_category_date
        ON fin_expenses (category, expense_date)`
    ]
  },
  {
    id: "002_fin_settings",
    statements: [
      `CREATE TABLE IF NOT EXISTS fin_settings (
        key TEXT PRIMARY KEY,
        value_json jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`
    ]
  },
  {
    // History of dashboard-triggered GoFood catalog syncs (Phase 2 writes rows;
    // created now so the sync-log endpoint has a table from day one). Dashboard
    // -owned (fin_*). GoFood credentials themselves live in the bot-owned
    // gofood_settings table (see fasola-order-bot migration 007).
    id: "003_fin_gofood_sync_runs",
    statements: [
      `CREATE TABLE IF NOT EXISTS fin_gofood_sync_runs (
        run_id TEXT PRIMARY KEY,
        started_at timestamptz NOT NULL DEFAULT now(),
        status TEXT NOT NULL,
        items_total INTEGER,
        items_pushed INTEGER,
        errors_json jsonb NOT NULL DEFAULT '[]',
        message TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_fin_gofood_sync_runs_started_at
        ON fin_gofood_sync_runs (started_at DESC)`
    ]
  }
];

export async function runMigrations(db: Db, availableMigrations = migrations): Promise<void> {
  const client = await db.connect();

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('fin_schema_migrations'))");

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const migration of availableMigrations) {
      const found = await client.query("SELECT 1 FROM fin_schema_migrations WHERE id = $1", [
        migration.id
      ]);

      if ((found.rowCount ?? 0) > 0) {
        continue;
      }

      try {
        await client.query("BEGIN");
        for (const statement of migration.statements) {
          await client.query(statement);
        }
        await client.query("INSERT INTO fin_schema_migrations (id) VALUES ($1)", [migration.id]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('fin_schema_migrations'))")
      .catch(() => undefined);
    client.release();
  }
}
