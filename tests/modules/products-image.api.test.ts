import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../../server/src/config/env.js";
import type { Db } from "../../server/src/db/client.js";
import type { Product } from "../../web/src/api/types.js";
import { buildTestApp, buildTestConfig, loginAndGetCookie } from "../helpers/app.js";
import { createMigratedTestDatabase, type TestDatabase } from "../helpers/db.js";

// Minimal PNG: signature + IHDR chunk (only the header bytes the validator
// reads). CRCs are not checked, so this is enough to exercise the endpoint.
function fakePng(width: number, height: number, padBytes = 8): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLen = Buffer.from([0, 0, 0, 13]);
  const ihdr = Buffer.from("IHDR", "ascii");
  const dims = Buffer.alloc(8);
  dims.writeUInt32BE(width, 0);
  dims.writeUInt32BE(height, 4);
  const tail = Buffer.alloc(Math.max(0, padBytes));
  return Buffer.concat([signature, ihdrLen, ihdr, dims, tail]);
}

function base64Png(width: number, height: number, padBytes = 8): string {
  return fakePng(width, height, padBytes).toString("base64");
}

async function seedProduct(db: Db, productId = "PRD-001"): Promise<void> {
  await db.query(
    `INSERT INTO products (
       product_id, product_name, aliases_json, category, price, stock_status,
       is_available, variants_json, notes, updated_at
     ) VALUES ($1, 'Ayam Bakar', '[]', 'Makanan', 25000, 'Available', 1, '[]', NULL, '2026-07-14T00:00:00Z')`,
    [productId]
  );
}

function parseBody<T>(response: { body: string }): T {
  return JSON.parse(response.body) as T;
}

describe("Product image upload", () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;
  let config: AppConfig;
  let uploadsDir: string;

  beforeEach(async () => {
    uploadsDir = join(tmpdir(), `fasola-uploads-${randomUUID()}`);
    config = buildTestConfig({ UPLOADS_DIR: uploadsDir, PUBLIC_BASE_URL: "http://localhost:3100" });
    testDb = await createMigratedTestDatabase();
    app = await buildTestApp({ db: testDb.db, config });
    cookie = await loginAndGetCookie(app);
  });

  afterEach(async () => {
    await app.close();
    await testDb.close();
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it("requires authentication", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/products/PRD-001/image",
      payload: { imageBase64: base64Png(64, 64), contentType: "image/png" }
    });
    expect(response.statusCode).toBe(401);
  });

  it("accepts a square PNG, stores it, and sets image_url", async () => {
    await seedProduct(testDb.db);

    const response = await app.inject({
      method: "POST",
      url: "/api/products/PRD-001/image",
      headers: { cookie },
      payload: { imageBase64: base64Png(64, 64), contentType: "image/png" }
    });
    expect(response.statusCode).toBe(200);
    const body = parseBody<{ product: Product }>(response);
    expect(body.product.imageUrl).toMatch(/^http:\/\/localhost:3100\/uploads\/[A-Za-z0-9_-]+\.png$/);

    // The stored file is publicly served without auth.
    const filename = body.product.imageUrl?.split("/uploads/")[1] ?? "";
    const served = await app.inject({ method: "GET", url: `/uploads/${filename}` });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
  });

  it("rejects a non-square image", async () => {
    await seedProduct(testDb.db);
    const response = await app.inject({
      method: "POST",
      url: "/api/products/PRD-001/image",
      headers: { cookie },
      payload: { imageBase64: base64Png(64, 32), contentType: "image/png" }
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a non-PNG payload", async () => {
    await seedProduct(testDb.db);
    const response = await app.inject({
      method: "POST",
      url: "/api/products/PRD-001/image",
      headers: { cookie },
      payload: { imageBase64: Buffer.from("definitely not a png").toString("base64"), contentType: "image/png" }
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an image larger than 1MB", async () => {
    await seedProduct(testDb.db);
    const response = await app.inject({
      method: "POST",
      url: "/api/products/PRD-001/image",
      headers: { cookie },
      payload: { imageBase64: base64Png(64, 64, 1_100_000), contentType: "image/png" }
    });
    expect(response.statusCode).toBe(400);
  });

  it("404s when the product does not exist", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/products/PRD-999/image",
      headers: { cookie },
      payload: { imageBase64: base64Png(64, 64), contentType: "image/png" }
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects unsafe upload filenames and 404s missing files", async () => {
    const bad = await app.inject({ method: "GET", url: "/uploads/evil.txt" });
    expect(bad.statusCode).toBe(400);

    const missing = await app.inject({ method: "GET", url: "/uploads/doesnotexist.png" });
    expect(missing.statusCode).toBe(404);
  });
});
