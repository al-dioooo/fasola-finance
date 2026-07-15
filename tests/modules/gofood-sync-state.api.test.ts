import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "../../server/src/db/client.js";
import type { GofoodSyncStateResponse } from "../../web/src/api/types.js";
import { buildTestApp, loginAndGetCookie } from "../helpers/app.js";
import { createMigratedTestDatabase, type TestDatabase } from "../helpers/db.js";

async function insertProduct(db: Db, id: string, updatedAt: string): Promise<void> {
  await db.query(
    `INSERT INTO products (
       product_id, product_name, aliases_json, category, price,
       stock_status, is_available, variants_json, notes, updated_at
     ) VALUES ($1, $2, '[]', NULL, 10000, 'Available', 1, '[]', NULL, $3)`,
    [id, `Menu ${id}`, updatedAt]
  );
}

async function insertSyncRun(db: Db, id: string, status: string, startedAt: string): Promise<void> {
  await db.query(
    `INSERT INTO fin_gofood_sync_runs (run_id, started_at, status, items_total, items_pushed, errors_json, message)
     VALUES ($1, $2::timestamptz, $3, 1, 1, '[]'::jsonb, NULL)`,
    [id, startedAt, status]
  );
}

describe("GoFood sync-state", () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    testDb = await createMigratedTestDatabase();
    app = await buildTestApp({ db: testDb.db });
    cookie = await loginAndGetCookie(app);
  });

  afterEach(async () => {
    await app.close();
    await testDb.close();
  });

  async function getState(): Promise<GofoodSyncStateResponse> {
    const response = await app.inject({ method: "GET", url: "/api/gofood/sync-state", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    return response.json<GofoodSyncStateResponse>();
  }

  it("reports not-needed when there is no menu at all", async () => {
    const state = await getState();
    expect(state.syncNeeded).toBe(false);
    expect(state.lastSyncAt).toBeNull();
    expect(state.menuUpdatedAt).toBeNull();
  });

  it("needs sync when products exist but nothing has been synced yet", async () => {
    await insertProduct(testDb.db, "PRD-001", "2026-07-15T00:00:00Z");
    const state = await getState();
    expect(state.syncNeeded).toBe(true);
    expect(state.lastSyncAt).toBeNull();
    expect(state.menuUpdatedAt).toBe("2026-07-15T00:00:00Z");
  });

  it("clears after a successful sync and re-flags after a later edit", async () => {
    await insertProduct(testDb.db, "PRD-001", "2026-07-15T00:00:00Z");

    // A successful push after the last edit -> in sync.
    await insertSyncRun(testDb.db, "run-1", "success", "2026-07-15T01:00:00Z");
    expect((await getState()).syncNeeded).toBe(false);

    // Editing the menu again -> stale.
    await testDb.db.query("UPDATE products SET updated_at = $1 WHERE product_id = 'PRD-001'", [
      "2026-07-15T02:00:00Z"
    ]);
    const stale = await getState();
    expect(stale.syncNeeded).toBe(true);
    expect(stale.lastSyncAt).toBe("2026-07-15T01:00:00Z");

    // A failed push does not count as "synced" -> still stale.
    await insertSyncRun(testDb.db, "run-2", "failed", "2026-07-15T03:00:00Z");
    expect((await getState()).syncNeeded).toBe(true);

    // A partial push counts (it still overwrote the catalog) -> in sync.
    await insertSyncRun(testDb.db, "run-3", "partial", "2026-07-15T04:00:00Z");
    const synced = await getState();
    expect(synced.syncNeeded).toBe(false);
    expect(synced.lastSyncAt).toBe("2026-07-15T04:00:00Z");
  });
});
