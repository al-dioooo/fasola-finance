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
        notes: "   ",
        description: "  Ayam bakar bumbu kecap dengan nasi, lalapan, dan sambal.  "
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
    expect(created.description).toBe("Ayam bakar bumbu kecap dengan nasi, lalapan, dan sambal.");
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
    expect(secondProduct.description).toBeNull();
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

  it("patches description and clears it back to null", async () => {
    const set = await app.inject({
      method: "PATCH",
      url: "/api/products/PRD-002",
      headers: { cookie },
      payload: { description: "  Es teh manis segar, gula asli.  " }
    });

    expect(set.statusCode).toBe(200);
    expect(set.json<ProductBody>().product.description).toBe("Es teh manis segar, gula asli.");

    // Other fields untouched by a description-only patch.
    expect(set.json<ProductBody>().product.productName).toBe("Es Teh Manis");
    expect(set.json<ProductBody>().product.price).toBe(5000);

    const cleared = await app.inject({
      method: "PATCH",
      url: "/api/products/PRD-002",
      headers: { cookie },
      payload: { description: "" }
    });

    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<ProductBody>().product.description).toBeNull();

    const list = await app.inject({ method: "GET", url: "/api/products", headers: { cookie } });
    const persisted = list
      .json<ProductsListBody>()
      .items.find((item) => item.productId === "PRD-002");
    expect(persisted?.description).toBeNull();
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

  it("stores and returns variant pricing, stock, and selection rules", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/products",
      headers: { cookie },
      payload: {
        productName: "Kentang Goreng",
        price: 12000,
        stockStatus: "Available",
        variants: ["Original"]
      }
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<ProductBody>().product.productId;
    // A names-only create defaults to required single-select, zero delta.
    expect(created.json<ProductBody>().product.variantConfig).toEqual({
      required: true,
      maxSelectable: 1,
      options: [{ name: "Original", priceDelta: 0, inStock: true }]
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/products/${id}`,
      headers: { cookie },
      payload: {
        variantConfig: {
          required: false,
          maxSelectable: 2,
          options: [
            { name: "Original", priceDelta: 0, inStock: true },
            { name: "Keju", priceDelta: 5000, inStock: true },
            { name: "Balado", priceDelta: -2000, inStock: false }
          ]
        }
      }
    });
    expect(patched.statusCode).toBe(200);
    const product = patched.json<ProductBody>().product;
    expect(product.variants).toEqual(["Original", "Keju", "Balado"]);
    expect(product.variantConfig.required).toBe(false);
    expect(product.variantConfig.maxSelectable).toBe(2);
    expect(product.variantConfig.options).toEqual([
      { name: "Original", priceDelta: 0, inStock: true },
      { name: "Keju", priceDelta: 5000, inStock: true },
      { name: "Balado", priceDelta: -2000, inStock: false }
    ]);

    // Persisted into the two coherent columns the bot reads.
    const row = await testDb.db.query<{ variants_json: string; variant_pricing_json: string | null }>(
      "SELECT variants_json, variant_pricing_json FROM products WHERE product_id = $1",
      [id]
    );
    expect(JSON.parse(row.rows[0]!.variants_json)).toEqual(["Original", "Keju", "Balado"]);
    const pricing = JSON.parse(row.rows[0]!.variant_pricing_json ?? "null") as {
      selection: { min: number; max: number };
      options: Record<string, { priceDelta: number; inStock: boolean }>;
    };
    expect(pricing.selection).toEqual({ min: 0, max: 2 });
    expect(pricing.options.Keju).toEqual({ priceDelta: 5000, inStock: true });
    expect(pricing.options.Balado).toEqual({ priceDelta: -2000, inStock: false });
  });

  it("tracks stock quantity and keeps it coherent with stock status", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/products",
      headers: { cookie },
      payload: {
        productName: "Sate Ayam",
        price: 20000,
        stockStatus: "Available",
        stockQuantity: 5
      }
    });
    expect(created.statusCode).toBe(201);
    const product = created.json<ProductBody>().product;
    const id = product.productId;
    expect(product.stockQuantity).toBe(5);
    expect(product.isAvailable).toBe(true);

    // Reaching 0 portions flips to Sold Out.
    const zero = await app.inject({
      method: "PATCH",
      url: `/api/products/${id}`,
      headers: { cookie },
      payload: { stockQuantity: 0 }
    });
    const zeroProduct = zero.json<ProductBody>().product;
    expect(zeroProduct.stockQuantity).toBe(0);
    expect(zeroProduct.stockStatus).toBe("Sold Out");
    expect(zeroProduct.isAvailable).toBe(false);

    // Restocking (no explicit status) brings it back to Available.
    const restock = await app.inject({
      method: "PATCH",
      url: `/api/products/${id}`,
      headers: { cookie },
      payload: { stockQuantity: 8 }
    });
    const restockProduct = restock.json<ProductBody>().product;
    expect(restockProduct.stockStatus).toBe("Available");
    expect(restockProduct.isAvailable).toBe(true);

    // Clearing to null = untracked.
    const untrack = await app.inject({
      method: "PATCH",
      url: `/api/products/${id}`,
      headers: { cookie },
      payload: { stockQuantity: null }
    });
    expect(untrack.json<ProductBody>().product.stockQuantity).toBeNull();
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
