import pg from "pg";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/fasola_finance_test";

export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const databaseName = url.pathname.slice(1);

  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      databaseName
    ]);
    if ((exists.rowCount ?? 0) === 0) {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await admin.end();
  }

  // Sweep schemas left behind by interrupted runs. Skipped when several
  // vitest processes share the database (SKIP_SCHEMA_SWEEP=1) so one run's
  // setup can't drop another run's live schemas.
  if (process.env.SKIP_SCHEMA_SWEEP === "1") {
    return;
  }

  const testDb = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await testDb.connect();
  try {
    const stale = await testDb.query<{ nspname: string }>(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'test\\_%'"
    );
    for (const row of stale.rows) {
      await testDb.query(`DROP SCHEMA "${row.nspname}" CASCADE`);
    }
  } finally {
    await testDb.end();
  }
}
