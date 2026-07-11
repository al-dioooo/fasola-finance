import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../../server/src/db/client.js";
import { todayJakarta } from "../../server/src/shared/dates.js";
import { buildTestApp, loginAndGetCookie } from "../helpers/app.js";
import { createMigratedTestDatabase, type TestDatabase } from "../helpers/db.js";

interface TopProductBody {
  productId: string;
  name: string;
  totalQty: number;
  estRevenue: number;
}

interface SummaryBody {
  date: string;
  revenue: number;
  ordersCount: number;
  unpricedOrders: number;
  needAction: { pendingConfirmation: number; needAdminHelp: number };
  byStatus: Record<string, number>;
  expensesTotal: number;
  profit: number;
  topProducts: TopProductBody[];
}

interface RevenueBody {
  buckets: { bucket: string; orders: number; revenue: number; unpricedOrders: number }[];
}

interface TopProductsBody {
  items: TopProductBody[];
}

interface ProfitBody {
  buckets: { bucket: string; revenue: number; expenses: number; profit: number }[];
  expensesByCategory: { category: string; total: number }[];
}

interface SeedOrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
}

interface SeedOrder {
  orderId: string;
  createdAt: string;
  orderStatus: string;
  estimatedSubtotal: number | null;
  products: SeedOrderItem[];
}

async function insertOrder(db: Db, order: SeedOrder): Promise<void> {
  const totalQuantity = order.products.reduce((sum, item) => sum + item.quantity, 0);

  await db.query(
    `INSERT INTO orders (
       order_id, created_at, updated_at, customer_wa, customer_name,
       products_text, products_json, total_quantity, estimated_subtotal,
       address, payment_method, payment_status, order_status
     ) VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      order.orderId,
      order.createdAt,
      "6281234567890",
      "Pelanggan Test",
      order.products.map((item) => `${item.quantity}x ${item.name}`).join(", "),
      JSON.stringify(order.products),
      totalQuantity,
      order.estimatedSubtotal,
      "Jl. Test No. 1, Jakarta",
      "cash",
      "Unpaid",
      order.orderStatus
    ]
  );
}

async function insertExpense(
  db: Db,
  expenseId: string,
  expenseDate: string,
  category: string,
  amount: number
): Promise<void> {
  await db.query(
    `INSERT INTO fin_expenses (expense_id, expense_date, category, description, amount)
     VALUES ($1, $2, $3, $4, $5)`,
    [expenseId, expenseDate, category, "seed", amount]
  );
}

describe("reports API", () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();

    // Jakarta-midnight edge pair: ORD-001 is 2026-07-10 23:30 WIB (still July 10),
    // ORD-002 is 2026-07-10 17:30 UTC = 2026-07-11 00:30 WIB (next day's bucket).
    await insertOrder(testDb.db, {
      orderId: "ORD-001",
      createdAt: "2026-07-10T23:30:00+07:00",
      orderStatus: "Completed",
      estimatedSubtotal: 50000,
      products: [{ productId: "PRD-001", name: "Ayam Bakar", quantity: 2, unitPrice: 25000 }]
    });
    await insertOrder(testDb.db, {
      orderId: "ORD-002",
      createdAt: "2026-07-10T17:30:00Z",
      orderStatus: "Confirmed",
      estimatedSubtotal: 30000,
      products: [{ productId: "PRD-002", name: "Sambal Bawang", quantity: 3, unitPrice: 10000 }]
    });
    // Cancelled: excluded from every money figure, still visible in byStatus.
    await insertOrder(testDb.db, {
      orderId: "ORD-003",
      createdAt: "2026-07-10T05:00:00+07:00",
      orderStatus: "Cancelled",
      estimatedSubtotal: 99000,
      products: [{ productId: "PRD-004", name: "Nasi Uduk", quantity: 9, unitPrice: 11000 }]
    });
    // Revenue status but unpriced (NULL subtotal, null unitPrice item).
    await insertOrder(testDb.db, {
      orderId: "ORD-004",
      createdAt: "2026-07-10T08:00:00+07:00",
      orderStatus: "Processing",
      estimatedSubtotal: null,
      products: [{ productId: "PRD-003", name: "Es Teh", quantity: 1, unitPrice: null }]
    });
    // Non-revenue statuses feeding the global needAction counters.
    await insertOrder(testDb.db, {
      orderId: "ORD-005",
      createdAt: "2026-07-10T09:00:00+07:00",
      orderStatus: "Pending Admin Confirmation",
      estimatedSubtotal: 10000,
      products: [{ productId: "PRD-001", name: "Ayam Bakar", quantity: 5, unitPrice: 25000 }]
    });
    await insertOrder(testDb.db, {
      orderId: "ORD-006",
      createdAt: "2026-06-01T10:00:00+07:00",
      orderStatus: "Need Admin Help",
      estimatedSubtotal: 5000,
      products: [{ productId: "PRD-002", name: "Sambal Bawang", quantity: 1, unitPrice: 10000 }]
    });
    await insertOrder(testDb.db, {
      orderId: "ORD-007",
      createdAt: "2026-07-10T12:00:00+07:00",
      orderStatus: "Ready",
      estimatedSubtotal: 35000,
      products: [
        { productId: "PRD-001", name: "Ayam Bakar", quantity: 1, unitPrice: 25000 },
        { productId: "PRD-002", name: "Sambal Bawang", quantity: 1, unitPrice: 10000 }
      ]
    });
    // May revenue with no May expenses (profit join, revenue-only side).
    await insertOrder(testDb.db, {
      orderId: "ORD-008",
      createdAt: "2026-05-15T10:00:00+07:00",
      orderStatus: "Completed",
      estimatedSubtotal: 40000,
      products: [{ productId: "PRD-001", name: "Ayam Bakar", quantity: 1, unitPrice: 25000 }]
    });

    await insertExpense(testDb.db, "EXP-001", "2026-07-10", "bahan_baku", 20000);
    await insertExpense(testDb.db, "EXP-002", "2026-07-11", "gas", 5000);
    // June expense with no June revenue (profit join, expense-only side).
    await insertExpense(testDb.db, "EXP-003", "2026-06-05", "transport", 7000);

    app = await buildTestApp({ db: testDb.db });
    cookie = await loginAndGetCookie(app);
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  describe("GET /api/reports/summary", () => {
    it("returns revenue, statuses, expenses and top products for a Jakarta date", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/summary?date=2026-07-10",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<SummaryBody>();

      expect(body.date).toBe("2026-07-10");
      // Revenue statuses only: ORD-001 (50000) + ORD-007 (35000); ORD-004 is NULL.
      expect(body.revenue).toBe(85000);
      expect(body.ordersCount).toBe(3);
      expect(body.unpricedOrders).toBe(1);
      expect(body.byStatus).toEqual({
        Completed: 1,
        Processing: 1,
        Ready: 1,
        Cancelled: 1,
        "Pending Admin Confirmation": 1
      });
      // Global counters: ORD-005 (July) + ORD-006 (June, outside the date filter).
      expect(body.needAction).toEqual({ pendingConfirmation: 1, needAdminHelp: 1 });
      expect(body.expensesTotal).toBe(20000);
      expect(body.profit).toBe(65000);
      expect(body.topProducts).toEqual([
        { productId: "PRD-001", name: "Ayam Bakar", totalQty: 3, estRevenue: 75000 },
        { productId: "PRD-002", name: "Sambal Bawang", totalQty: 1, estRevenue: 10000 },
        { productId: "PRD-003", name: "Es Teh", totalQty: 1, estRevenue: 0 }
      ]);
    });

    it("assigns the 00:30 WIB order to the next Jakarta day", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/summary?date=2026-07-11",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<SummaryBody>();

      expect(body.revenue).toBe(30000);
      expect(body.ordersCount).toBe(1);
      expect(body.unpricedOrders).toBe(0);
      expect(body.byStatus).toEqual({ Confirmed: 1 });
      expect(body.expensesTotal).toBe(5000);
      expect(body.profit).toBe(25000);
    });

    it("defaults to today in Jakarta", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/summary",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<SummaryBody>().date).toBe(todayJakarta());
    });

    it("rejects an invalid date", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/summary?date=2026-13-40",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/reports/revenue", () => {
    it("buckets daily revenue on Jakarta days across the midnight edge", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/revenue?granularity=daily&from=2026-07-10&to=2026-07-11",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<RevenueBody>().buckets).toEqual([
        { bucket: "2026-07-10", orders: 3, revenue: 85000, unpricedOrders: 1 },
        { bucket: "2026-07-11", orders: 1, revenue: 30000, unpricedOrders: 0 }
      ]);
    });

    it("buckets weekly revenue on ISO Mondays", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/revenue?granularity=weekly&from=2026-07-06&to=2026-07-12",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<RevenueBody>().buckets).toEqual([
        { bucket: "2026-07-06", orders: 4, revenue: 115000, unpricedOrders: 1 }
      ]);
    });

    it("buckets monthly revenue and skips months with only non-revenue orders", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/revenue?granularity=monthly&from=2026-05-01&to=2026-07-31",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(200);
      // June only has ORD-006 (Need Admin Help) — no bucket at all.
      expect(response.json<RevenueBody>().buckets).toEqual([
        { bucket: "2026-05-01", orders: 1, revenue: 40000, unpricedOrders: 0 },
        { bucket: "2026-07-01", orders: 4, revenue: 115000, unpricedOrders: 1 }
      ]);
    });

    it("rejects a bad granularity", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/revenue?granularity=hourly&from=2026-07-10&to=2026-07-11",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(400);
    });

    it("rejects a missing from date", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/revenue?granularity=daily&to=2026-07-11",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(400);
    });

    it("rejects an inverted range", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/revenue?granularity=daily&from=2026-07-12&to=2026-07-10",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/reports/top-products", () => {
    it("unnests products across orders, coalescing null unit prices to zero", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/top-products?from=2026-07-10&to=2026-07-11",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(200);
      const items = response.json<TopProductsBody>().items;

      expect(items).toEqual([
        { productId: "PRD-002", name: "Sambal Bawang", totalQty: 4, estRevenue: 40000 },
        { productId: "PRD-001", name: "Ayam Bakar", totalQty: 3, estRevenue: 75000 },
        { productId: "PRD-003", name: "Es Teh", totalQty: 1, estRevenue: 0 }
      ]);
      // Cancelled ORD-003's PRD-004 must never leak in.
      expect(items.some((item) => item.productId === "PRD-004")).toBe(false);
    });

    it("applies the limit parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/top-products?from=2026-07-10&to=2026-07-11&limit=1",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<TopProductsBody>().items).toEqual([
        { productId: "PRD-002", name: "Sambal Bawang", totalQty: 4, estRevenue: 40000 }
      ]);
    });

    it("rejects an invalid limit", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/top-products?from=2026-07-10&to=2026-07-11&limit=0",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/reports/profit", () => {
    it("full-outer-joins revenue and expense buckets per month", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/profit?granularity=monthly&from=2026-05-01&to=2026-07-31",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ProfitBody>();

      expect(body.buckets).toEqual([
        // May: revenue, no expenses.
        { bucket: "2026-05-01", revenue: 40000, expenses: 0, profit: 40000 },
        // June: expenses, no revenue (ORD-006 is Need Admin Help).
        { bucket: "2026-06-01", revenue: 0, expenses: 7000, profit: -7000 },
        { bucket: "2026-07-01", revenue: 115000, expenses: 25000, profit: 90000 }
      ]);
      expect(body.expensesByCategory).toEqual([
        { category: "bahan_baku", total: 20000 },
        { category: "transport", total: 7000 },
        { category: "gas", total: 5000 }
      ]);
    });

    it("buckets weekly profit on ISO Mondays", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/profit?granularity=weekly&from=2026-07-06&to=2026-07-12",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ProfitBody>();

      expect(body.buckets).toEqual([
        { bucket: "2026-07-06", revenue: 115000, expenses: 25000, profit: 90000 }
      ]);
      expect(body.expensesByCategory).toEqual([
        { category: "bahan_baku", total: 20000 },
        { category: "gas", total: 5000 }
      ]);
    });

    it("rejects daily granularity", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/profit?granularity=daily&from=2026-07-06&to=2026-07-12",
        headers: { cookie }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("authentication", () => {
    it("rejects unauthenticated requests", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/reports/summary"
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
