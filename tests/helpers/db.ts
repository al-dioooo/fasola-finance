import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import pg from "pg";

import type { Db } from "../../server/src/db/client.js";
import { runMigrations } from "../../server/src/db/migrations/index.js";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/fasola_finance_test";

const BOT_SCHEMA_SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/bot-schema.sql"),
  "utf8"
);

export interface TestDatabase {
  db: Db;
  close(): Promise<void>;
}

// Schema-per-suite isolation on the shared test database: bot tables come
// from the fixture mirror, fin_* tables from the real migration runner.
export async function createMigratedTestDatabase(): Promise<TestDatabase> {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;

  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();

  const db = new pg.Pool({
    connectionString: TEST_DATABASE_URL,
    max: 5,
    options: `-c search_path=${schema}`
  });

  await db.query(BOT_SCHEMA_SQL);
  await runMigrations(db);

  return {
    db,
    async close() {
      await db.end();
      const cleanup = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
      await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
      await cleanup.end();
    }
  };
}
