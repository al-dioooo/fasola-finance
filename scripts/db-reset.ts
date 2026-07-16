import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runMigrations } from "../server/src/db/migrations/index.js";
import { confirm, connect, fail, hasForceFlag, resolveTarget } from "./db-target.js";

// Drops every table in the local dev database and rebuilds the schema from
// scratch:
//   - bot-owned tables (orders, products, business_profile, ...) come from
//     tests/fixtures/bot-schema.sql, the in-repo mirror the test suite and the
//     verify skill already build from. It tracks bot migrations 001-009.
//   - fin_* tables come from the real migration runner, same as server boot.
//
// This is the one place the dashboard performs DDL on bot-owned tables. That is
// deliberate and safe *only* because the target is a throwaway local database
// (see the localhost guard in db-target.ts) — the ownership contract in
// fasola-order-bot/docs/db-contract.md still holds everywhere else.

const BOT_SCHEMA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../tests/fixtures/bot-schema.sql"
);

interface TableCount {
  table: string;
  rows: number;
}

async function main(): Promise<void> {
  const target = resolveTarget();
  const db = connect(target);

  try {
    const counts = await summarize(db);

    console.log(`\nReset target: ${target.label}`);

    if (counts.length === 0) {
      console.log("  (no tables yet — this will create the schema from scratch)");
    } else {
      console.log("  About to DROP:");
      for (const { table, rows } of counts) {
        console.log(`    ${table.padEnd(24)} ${String(rows).padStart(6)} row(s)`);
      }
    }

    const proceed = await confirm(`\nDrop and rebuild "${target.database}"?`, hasForceFlag());

    if (!proceed) {
      // Exit non-zero so `db:reset && db:seed` stops here. Declining the reset
      // and then seeding anyway would look like a reset that silently did
      // nothing — the worst possible outcome for a script like this.
      console.log("Aborted — nothing was changed.");
      process.exitCode = 1;
      return;
    }

    // DROP SCHEMA rather than dropping tables one by one: it also clears
    // sequences, views and anything else a stray experiment left behind.
    await db.query("DROP SCHEMA public CASCADE");
    await db.query("CREATE SCHEMA public");
    console.log("\n  schema public   dropped and recreated");

    await db.query(readFileSync(BOT_SCHEMA_PATH, "utf8"));
    console.log("  bot tables      created from tests/fixtures/bot-schema.sql");

    await runMigrations(db);
    console.log("  fin_* tables    created via runMigrations()");

    const rebuilt = await summarize(db);
    console.log(`\nDone. ${rebuilt.length} table(s) in "${target.database}".`);
    console.log("Next: npm run db:seed\n");
  } finally {
    await db.end();
  }
}

async function summarize(db: ReturnType<typeof connect>): Promise<TableCount[]> {
  const tables = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );

  const counts: TableCount[] = [];

  for (const { table_name: table } of tables.rows) {
    const result = await db.query<{ count: string }>(`SELECT count(*) AS count FROM "${table}"`);
    counts.push({ table, rows: Number(result.rows[0]?.count ?? 0) });
  }

  return counts;
}

try {
  await main();
} catch (error) {
  fail(error);
}
