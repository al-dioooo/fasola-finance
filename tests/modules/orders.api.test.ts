import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../../server/src/db/client.js";
import { buildTestApp, loginAndGetCookie } from "../helpers/app.js";
import { createMigratedTestDatabase, type TestDatabase } from "../helpers/db.js";

// Local mirrors of the API contract (web/src/api/types.ts) — only the fields
// the assertions touch.
interface OrderItemDto {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
}

interface OrderDto {
  orderId: string;
  createdAt: string;
  updatedAt: string;
  customerWa: string;
  customerName: string | null;
  productsText: string;
  totalQuantity: number;
  estimatedSubtotal: number | null;
  paymentStatus: string;
  orderStatus: string;
  products?: OrderItemDto[];
  address?: string;
  missingFields?: string[];
  source?: string;
}

interface ListBody {
  items: OrderDto[];
  total: number;
  page: number;
  limit: number;
}

interface DetailBody {
  order: OrderDto;
  allowedStatusTransitions: string[];
  allowedPaymentTransitions: string[];
}

interface ErrorBody {
  error: string;
  allowed?: string[];
  order?: OrderDto;
}

interface SeedOrderInput {
  orderId: string;
  createdAt: string;
  updatedAt?: string;
  customerWa?: string;
  customerName?: string | null;
  orderStatus?: string;
  paymentStatus?: string;
}

const DEFAULT_PRODUCTS = [
  { productId: "risol-mayo", name: "Risol Mayo", quantity: 2, unitPrice: 15000 }
];

async function seedOrder(db: Db, input: SeedOrderInput): Promise<void> {
  await db.query(
    `INSERT INTO orders (
       order_id, created_at, updated_at, customer_wa, customer_name,
       products_text, products_json, total_quantity, estimated_subtotal,
       address, payment_method, payment_status, order_status,
       notes, requested_time, raw_message, ai_model, ai_confidence,
       missing_fields_json, admin_notified_at, source
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $18, $19, $20, $21
     )`,
    [
      input.orderId,
      input.createdAt,
      input.updatedAt ?? input.createdAt,
      input.customerWa ?? "6281100000001",
      input.customerName === undefined ? "Pelanggan Test" : input.customerName,
      "Risol Mayo x2",
      JSON.stringify(DEFAULT_PRODUCTS),
      2,
      30000,
      "Jl. Melati No. 1, Jakarta",
      "cash",
      input.paymentStatus ?? "Unpaid",
      input.orderStatus ?? "Confirmed",
      null,
      null,
      null,
      null,
      null,
      "[]",
      null,
      "whatsapp"
    ]
  );
}

describe("orders API", () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    app = await buildTestApp({ db: testDb.db });
    cookie = await loginAndGetCookie(app);

    // Jakarta is UTC+7: ORD-002 lands on Jul 9 (23:59:59 Jakarta) while
    // ORD-003 lands on Jul 10 (00:00:00 Jakarta) despite adjacent UTC times.
    await seedOrder(testDb.db, {
      orderId: "ORD-001",
      createdAt: "2026-07-09T10:00:00Z",
      customerWa: "6281100000111",
      customerName: "Budi Santoso",
      orderStatus: "Completed",
      paymentStatus: "Paid"
    });
    await seedOrder(testDb.db, {
      orderId: "ORD-002",
      createdAt: "2026-07-09T16:59:59Z",
      customerWa: "6281100000222",
      customerName: "Siti Aminah",
      orderStatus: "Confirmed",
      paymentStatus: "Unpaid"
    });
    await seedOrder(testDb.db, {
      orderId: "ORD-003",
      createdAt: "2026-07-09T17:00:00Z",
      customerWa: "6281100000333",
      customerName: null,
      orderStatus: "Pending Admin Confirmation",
      paymentStatus: "Pending Manual Confirmation"
    });
    await seedOrder(testDb.db, {
      orderId: "ORD-004",
      createdAt: "2026-07-10T05:00:00Z",
      customerWa: "6281100000444",
      customerName: "Budi Hartono",
      orderStatus: "Ready",
      paymentStatus: "Unpaid"
    });
    await seedOrder(testDb.db, {
      orderId: "ORD-005",
      createdAt: "2026-07-10T08:00:00Z",
      customerWa: "6281100000555",
      customerName: "Rina",
      orderStatus: "Cancelled",
      paymentStatus: "Cancelled"
    });
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it("rejects unauthenticated requests", async () => {
    const response = await app.inject({ method: "GET", url: "/api/orders" });

    expect(response.statusCode).toBe(401);
  });

  it("lists orders newest first with pagination metadata", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ListBody>();
    expect(body.total).toBe(5);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(25);
    expect(body.items.map((item) => item.orderId)).toEqual([
      "ORD-005",
      "ORD-004",
      "ORD-003",
      "ORD-002",
      "ORD-001"
    ]);

    const first = body.items[0];
    expect(first).toMatchObject({
      orderId: "ORD-005",
      customerWa: "6281100000555",
      customerName: "Rina",
      productsText: "Risol Mayo x2",
      totalQuantity: 2,
      estimatedSubtotal: 30000,
      paymentStatus: "Cancelled",
      orderStatus: "Cancelled"
    });
  });

  it("paginates with page and limit", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/orders",
      query: { page: "2", limit: "2" },
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ListBody>();
    expect(body.total).toBe(5);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(2);
    expect(body.items.map((item) => item.orderId)).toEqual(["ORD-003", "ORD-002"]);
  });

  it("filters by repeatable status params", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/orders",
      query: { status: ["Confirmed", "Ready"] },
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ListBody>();
    expect(body.items.map((item) => item.orderId)).toEqual(["ORD-004", "ORD-002"]);
  });

  it("filters by a single status param", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/orders",
      query: { status: "Pending Admin Confirmation" },
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ListBody>();
    expect(body.items.map((item) => item.orderId)).toEqual(["ORD-003"]);
  });

  it("filters by paymentStatus", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/orders",
      query: { paymentStatus: "Paid" },
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ListBody>();
    expect(body.items.map((item) => item.orderId)).toEqual(["ORD-001"]);
  });

  it("searches order id, customer number, and customer name with q", async () => {
    const byName = await app.inject({
      method: "GET",
      url: "/api/orders",
      query: { q: "budi" },
      headers: { cookie }
    });
    expect(byName.json<ListBody>().items.map((item) => item.orderId)).toEqual([
      "ORD-004",
      "ORD-001"
    ]);

    const byWa = await app.inject({
      method: "GET",
      url: "/api/orders",
      query: { q: "6281100000333" },
      headers: { cookie }
    });
    expect(byWa.json<ListBody>().items.map((item) => item.orderId)).toEqual(["ORD-003"]);

    const byOrderId = await app.inject({
      method: "GET",
      url: "/api/orders",
      query: { q: "ord-002" },
      headers: { cookie }
    });
    expect(byOrderId.json<ListBody>().items.map((item) => item.orderId)).toEqual(["ORD-002"]);
  });

  it("filters by Jakarta business date range", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/orders",
      query: { from: "2026-07-10", to: "2026-07-10" },
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ListBody>();
    // ORD-002 (16:59:59Z = Jul 9 Jakarta) is out; ORD-003 (17:00:00Z = Jul 10
    // 00:00 Jakarta) is in.
    expect(body.items.map((item) => item.orderId)).toEqual(["ORD-005", "ORD-004", "ORD-003"]);
  });

  it("rejects malformed business dates", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/orders",
      query: { from: "10-07-2026" },
      headers: { cookie }
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 404 for a missing order detail", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/orders/does-not-exist",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error).toBeTruthy();
  });

  it("returns order detail with allowed transitions", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/orders/ORD-003",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<DetailBody>();
    expect(body.order.orderId).toBe("ORD-003");
    expect(body.order.customerName).toBeNull();
    expect(body.order.products).toEqual([
      {
        productId: "risol-mayo",
        name: "Risol Mayo",
        quantity: 2,
        unitPrice: 15000,
        variant: null,
        notes: null
      }
    ]);
    expect(body.order.address).toBe("Jl. Melati No. 1, Jakarta");
    expect(body.order.missingFields).toEqual([]);
    expect(body.order.source).toBe("whatsapp");
    expect(body.allowedStatusTransitions).toEqual([
      "Confirmed",
      "Cancelled",
      "Need Admin Help"
    ]);
    expect(body.allowedPaymentTransitions).toEqual(["Unpaid", "Paid", "Cancelled"]);
  });

  it("applies a legal status transition and returns new allowed transitions", async () => {
    await seedOrder(testDb.db, {
      orderId: "TRX-100",
      createdAt: "2026-07-10T09:00:00Z",
      updatedAt: "2026-07-10T09:00:00Z",
      orderStatus: "Pending Admin Confirmation",
      paymentStatus: "Pending Manual Confirmation"
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/orders/TRX-100/status",
      headers: { cookie },
      payload: { orderStatus: "Confirmed", expectedUpdatedAt: "2026-07-10T09:00:00Z" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<DetailBody>();
    expect(body.order.orderStatus).toBe("Confirmed");
    expect(body.order.updatedAt).not.toBe("2026-07-10T09:00:00Z");
    expect(body.allowedStatusTransitions).toEqual(["Processing", "Cancelled", "Need Admin Help"]);
    expect(body.allowedPaymentTransitions).toEqual(["Unpaid", "Paid", "Cancelled"]);
  });

  it("rejects an illegal status transition with the allowed list", async () => {
    const detail = await app.inject({
      method: "GET",
      url: "/api/orders/TRX-100",
      headers: { cookie }
    });
    const current = detail.json<DetailBody>().order;

    const response = await app.inject({
      method: "PATCH",
      url: "/api/orders/TRX-100/status",
      headers: { cookie },
      payload: { orderStatus: "Completed", expectedUpdatedAt: current.updatedAt }
    });

    expect(response.statusCode).toBe(422);
    const body = response.json<ErrorBody>();
    expect(body.error).toBeTruthy();
    expect(body.allowed).toEqual(["Processing", "Cancelled", "Need Admin Help"]);
  });

  it("returns 409 with the fresh order on a stale concurrency token", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/orders/TRX-100/status",
      headers: { cookie },
      // The token from before the earlier successful PATCH is stale now.
      payload: { orderStatus: "Processing", expectedUpdatedAt: "2026-07-10T09:00:00Z" }
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<ErrorBody>();
    expect(body.error).toBe("Data pesanan berubah");
    expect(body.order?.orderId).toBe("TRX-100");
    expect(body.order?.orderStatus).toBe("Confirmed");
  });

  it("returns 404 when patching a missing order", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/orders/TRX-NOPE/status",
      headers: { cookie },
      payload: { orderStatus: "Confirmed", expectedUpdatedAt: "2026-07-10T09:00:00Z" }
    });

    expect(response.statusCode).toBe(404);
  });

  it("cancelling an order also cancels an unpaid payment", async () => {
    await seedOrder(testDb.db, {
      orderId: "TRX-200",
      createdAt: "2026-07-10T09:10:00Z",
      orderStatus: "Confirmed",
      paymentStatus: "Unpaid"
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/orders/TRX-200/status",
      headers: { cookie },
      payload: { orderStatus: "Cancelled", expectedUpdatedAt: "2026-07-10T09:10:00Z" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<DetailBody>();
    expect(body.order.orderStatus).toBe("Cancelled");
    expect(body.order.paymentStatus).toBe("Cancelled");
    expect(body.allowedStatusTransitions).toEqual([]);
    expect(body.allowedPaymentTransitions).toEqual([]);
  });

  it("cancelling an order leaves a paid payment untouched", async () => {
    await seedOrder(testDb.db, {
      orderId: "TRX-201",
      createdAt: "2026-07-10T09:20:00Z",
      orderStatus: "Confirmed",
      paymentStatus: "Paid"
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/orders/TRX-201/status",
      headers: { cookie },
      payload: { orderStatus: "Cancelled", expectedUpdatedAt: "2026-07-10T09:20:00Z" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<DetailBody>();
    expect(body.order.orderStatus).toBe("Cancelled");
    expect(body.order.paymentStatus).toBe("Paid");
  });

  it("applies a legal payment transition and rejects an illegal one", async () => {
    await seedOrder(testDb.db, {
      orderId: "TRX-300",
      createdAt: "2026-07-10T09:30:00Z",
      orderStatus: "Confirmed",
      paymentStatus: "Unpaid"
    });

    const paid = await app.inject({
      method: "PATCH",
      url: "/api/orders/TRX-300/payment",
      headers: { cookie },
      payload: { paymentStatus: "Paid", expectedUpdatedAt: "2026-07-10T09:30:00Z" }
    });

    expect(paid.statusCode).toBe(200);
    const paidBody = paid.json<DetailBody>();
    expect(paidBody.order.paymentStatus).toBe("Paid");
    expect(paidBody.allowedPaymentTransitions).toEqual(["Unpaid"]);

    const illegal = await app.inject({
      method: "PATCH",
      url: "/api/orders/TRX-300/payment",
      headers: { cookie },
      payload: { paymentStatus: "Cancelled", expectedUpdatedAt: paidBody.order.updatedAt }
    });

    expect(illegal.statusCode).toBe(422);
    const illegalBody = illegal.json<ErrorBody>();
    expect(illegalBody.allowed).toEqual(["Unpaid"]);
  });

  it("returns 409 with the fresh order on a stale payment token", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/orders/TRX-300/payment",
      headers: { cookie },
      payload: { paymentStatus: "Unpaid", expectedUpdatedAt: "2026-07-10T09:30:00Z" }
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<ErrorBody>();
    expect(body.error).toBe("Data pesanan berubah");
    expect(body.order?.paymentStatus).toBe("Paid");
  });
});
