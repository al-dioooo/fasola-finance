import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ProductRecord } from "../../server/src/modules/products/product.store.js";
import { buildTestApp, loginAndGetCookie } from "../helpers/app.js";
import { createMigratedTestDatabase, type TestDatabase } from "../helpers/db.js";

interface ProductsListBody {
  items: ProductRecord[];
  pendingMenuChanges: number;
}

interface ProductBody {
  product: ProductRecord;
}

// Tests in this file run sequentially against one database: the create tests
// run first on an empty products table so generated ids are deterministic
// (PRD-001..PRD-004), then the list/patch tests build on those rows.
describe("products API", () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    app = await buildTestApp({ db: testDb.db });
    cookie = await loginAndGetCookie(app);
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const list = await app.inject({ method: "GET", url: "/api/products" });
    expect(list.statusCode).toBe(401);

    const create = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: { productName: "Tanpa Login", price: 10000, stockStatus: "Available" }
    });
    expect(create.statusCode).toBe(401);

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/products/PRD-001",
      payload: { price: 12000 }
    });
    expect(patch.statusCode).toBe(401);
  });

  it("creates products with sequential PRD ids and recomputed availability", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/products",
      headers: { cookie },
      payload: {
        productName: "Nasi Kotak Ayam Bakar",
        price: 25000,
        stockStatus: "Available",
        category: "  Paket Nasi  ",
        aliases: [" nasi ayam ", "nasi ayam", "nasbak", " "],
        variants: ["Pedas", "Original", " Pedas "],
        notes: "   "
      }
    });

    expect(first.statusCode).toBe(201);
    const created = first.json<ProductBody>().product;
    expect(created.productId).toBe("PRD-001");
    expect(created.productName).toBe("Nasi Kotak Ayam Bakar");
    expect(created.price).toBe(25000);
    expect(created.stockStatus).toBe("Available");
    expect(created.isAvailable).toBe(true);
    expect(created.category).toBe("Paket Nasi");
    expect(created.aliases).toEqual(["nasi ayam", "nasbak"]);
    expect(created.variants).toEqual(["Pedas", "Original"]);
    expect(created.notes).toBeNull();
    expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const second = await app.inject({
      method: "POST",
      url: "/api/products",
      headers: { cookie },
      payload: {
        productName: "Es Teh Manis",
        price: 5000,
        stockStatus: "Sold Out"
      }
    });

    expect(second.statusCode).toBe(201);
    const secondProduct = second.json<ProductBody>().product;
    expect(secondProduct.productId).toBe("PRD-002");
    expect(secondProduct.stockStatus).toBe("Sold Out");
    expect(secondProduct.isAvailable).toBe(false);
    expect(secondProduct.aliases).toEqual([]);
    expect(secondProduct.variants).toEqual([]);
    expect(secondProduct.category).toBeNull();
    expect(secondProduct.notes).toBeNull();
  });

  it("rejects a duplicate product name case-insensitively with 409", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/products",
      headers: { cookie },
      payload: {
        productName: "NASI KOTAK AYAM BAKAR",
        price: 30000,
        stockStatus: "Available"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: string }>().error).toBeTruthy();
  });

  it("assigns distinct ids to concurrent creates via the advisory lock", async () => {
    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/products",
        headers: { cookie },
        payload: { productName: "Risol Mayo", price: 8000, stockStatus: "Available" }
      }),
      app.inject({
        method: "POST",
        url: "/api/products",
        headers: { cookie },
        payload: { productName: "Pastel Ayam", price: 7000, stockStatus: "Limited" }
      })
    ]);

    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);

    const idA = a.json<ProductBody>().product.productId;
    const idB = b.json<ProductBody>().product.productId;

    expect(idA).toMatch(/^PRD-\d{3}$/);
    expect(idB).toMatch(/^PRD-\d{3}$/);
    expect(idA).not.toBe(idB);
    expect(new Set([idA, idB])).toEqual(new Set(["PRD-003", "PRD-004"]));
  });

  it("lists ALL products incl. Hidden, ordered by id, with pending menu change count", async () => {
    await testDb.db.query(
      `INSERT INTO products (
         product_id, product_name, aliases_json, category, price,
         stock_status, is_available, variants_json, notes, updated_at
       ) VALUES ('PRD-900', 'Menu Rahasia', '["rahasia"]', NULL, 15000,
         'Hidden', 0, '[]', NULL, '2026-07-01T03:00:00Z')`
    );
    // One pending change (banner) + one already-confirmed change (ignored).
    await testDb.db.query(
      `INSERT INTO pending_menu_changes (change_id, admin_wa, action, payload_json, raw_message, status)
       VALUES
         ('chg-1', '628111000111@c.us', 'add', '{}', '/menu tambah bakwan 5000', 'pending'),
         ('chg-2', '628222000222@c.us', 'update', '{}', '/menu ubah es teh 6000', 'confirmed')`
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/products",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ProductsListBody>();

    expect(body.pendingMenuChanges).toBe(1);
    expect(body.items.map((item) => item.productId)).toEqual([
      "PRD-001",
      "PRD-002",
      "PRD-003",
      "PRD-004",
      "PRD-900"
    ]);

    const hidden = body.items.find((item) => item.productId === "PRD-900");
    expect(hidden).toBeDefined();
    expect(hidden?.stockStatus).toBe("Hidden");
    expect(hidden?.isAvailable).toBe(false);
    expect(hidden?.aliases).toEqual(["rahasia"]);
    expect(hidden?.price).toBe(15000);
    expect(typeof hidden?.price).toBe("number");
  });

  it("patches price and stock status and recomputes isAvailable", async () => {
    const soldOut = await app.inject({
      method: "PATCH",
      url: "/api/products/PRD-001",
      headers: { cookie },
      payload: { stockStatus: "Sold Out" }
    });

    expect(soldOut.statusCode).toBe(200);
    const soldOutProduct = soldOut.json<ProductBody>().product;
    expect(soldOutProduct.stockStatus).toBe("Sold Out");
    expect(soldOutProduct.isAvailable).toBe(false);
    expect(soldOutProduct.price).toBe(25000);

    const repriced = await app.inject({
      method: "PATCH",
      url: "/api/products/PRD-001",
      headers: { cookie },
      payload: { price: 27000, stockStatus: "Limited" }
    });

    expect(repriced.statusCode).toBe(200);
    const repricedProduct = repriced.json<ProductBody>().product;
    expect(repricedProduct.price).toBe(27000);
    expect(repricedProduct.stockStatus).toBe("Limited");
    expect(repricedProduct.isAvailable).toBe(true);

    // Changes are persisted, not just echoed.
    const list = await app.inject({ method: "GET", url: "/api/products", headers: { cookie } });
    const persisted = list
      .json<ProductsListBody>()
      .items.find((item) => item.productId === "PRD-001");
    expect(persisted?.price).toBe(27000);
    expect(persisted?.stockStatus).toBe("Limited");
    expect(persisted?.isAvailable).toBe(true);
  });

  it("rejects renaming to another product's name (409) but allows keeping its own", async () => {
    const conflict = await app.inject({
      method: "PATCH",
      url: "/api/products/PRD-001",
      headers: { cookie },
      payload: { productName: "es teh manis" }
    });
    expect(conflict.statusCode).toBe(409);

    // The duplicate check excludes the product itself.
    const selfRename = await app.inject({
      method: "PATCH",
      url: "/api/products/PRD-001",
      headers: { cookie },
      payload: { productName: "NASI Kotak Ayam Bakar" }
    });
    expect(selfRename.statusCode).toBe(200);
    expect(selfRename.json<ProductBody>().product.productName).toBe("NASI Kotak Ayam Bakar");
  });

  it("returns 404 when patching a missing product", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/products/PRD-999",
      headers: { cookie },
      payload: { price: 10000 }
    });

    expect(response.statusCode).toBe(404);
  });

  it("rejects invalid bodies with 400", async () => {
    const badCreate = await app.inject({
      method: "POST",
      url: "/api/products",
      headers: { cookie },
      payload: { productName: "", price: -5, stockStatus: "Available" }
    });
    expect(badCreate.statusCode).toBe(400);

    const badPatch = await app.inject({
      method: "PATCH",
      url: "/api/products/PRD-001",
      headers: { cookie },
      payload: { stockStatus: "Gone" }
    });
    expect(badPatch.statusCode).toBe(400);
  });
});
