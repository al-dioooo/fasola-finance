import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildTestApp, loginAndGetCookie } from "../helpers/app.js";
import { createMigratedTestDatabase, type TestDatabase } from "../helpers/db.js";

interface ExpenseDto {
  expenseId: string;
  expenseDate: string;
  category: string;
  description: string | null;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

interface ExpensesListDto {
  items: ExpenseDto[];
  total: number;
  page: number;
  limit: number;
  periodTotal: number;
}

describe("expenses API", () => {
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

  beforeEach(async () => {
    await testDb.db.query("DELETE FROM fin_expenses");
  });

  async function seedExpense(input: {
    expenseId: string;
    expenseDate: string;
    category: string;
    amount: number;
    description?: string | null;
    createdAt?: string;
  }): Promise<void> {
    await testDb.db.query(
      `INSERT INTO fin_expenses (expense_id, expense_date, category, description, amount, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), coalesce($6::timestamptz, now()))`,
      [
        input.expenseId,
        input.expenseDate,
        input.category,
        input.description ?? null,
        input.amount,
        input.createdAt ?? null
      ]
    );
  }

  it("rejects unauthenticated requests", async () => {
    const response = await app.inject({ method: "GET", url: "/api/expenses" });

    expect(response.statusCode).toBe(401);
  });

  it("creates an expense and returns it with a generated id", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: { cookie },
      payload: {
        expenseDate: "2026-07-10",
        category: "bahan_baku",
        amount: 150000,
        description: "Ayam 5kg"
      }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ expense: ExpenseDto }>();
    expect(body.expense.expenseId).toMatch(/^EXP-20260710-[A-Z0-9_-]{6}$/);
    expect(body.expense.expenseDate).toBe("2026-07-10");
    expect(body.expense.category).toBe("bahan_baku");
    expect(body.expense.amount).toBe(150000);
    expect(body.expense.description).toBe("Ayam 5kg");
    expect(new Date(body.expense.createdAt).getTime()).not.toBeNaN();
    expect(new Date(body.expense.updatedAt).getTime()).not.toBeNaN();
  });

  it("creates an expense without description as null", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: { cookie },
      payload: { expenseDate: "2026-07-10", category: "gas", amount: 25000 }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ expense: ExpenseDto }>().expense.description).toBeNull();
  });

  it.each([
    ["zero amount", { expenseDate: "2026-07-10", category: "gas", amount: 0 }],
    ["negative amount", { expenseDate: "2026-07-10", category: "gas", amount: -5000 }],
    ["non-integer amount", { expenseDate: "2026-07-10", category: "gas", amount: 100.5 }],
    ["string amount", { expenseDate: "2026-07-10", category: "gas", amount: "25000" }],
    ["invalid category", { expenseDate: "2026-07-10", category: "listrik", amount: 25000 }],
    ["invalid date", { expenseDate: "2026-13-40", category: "gas", amount: 25000 }],
    ["non-ISO date", { expenseDate: "10/07/2026", category: "gas", amount: 25000 }],
    ["missing fields", { category: "gas" }]
  ])("rejects invalid create payload: %s", async (_label, payload) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: { cookie },
      payload
    });

    expect(response.statusCode).toBe(400);
  });

  it("lists expenses sorted by date then created_at descending", async () => {
    await seedExpense({
      expenseId: "EXP-20260708-AAAAAA",
      expenseDate: "2026-07-08",
      category: "gas",
      amount: 22000,
      createdAt: "2026-07-08T03:00:00Z"
    });
    await seedExpense({
      expenseId: "EXP-20260710-EARLYX",
      expenseDate: "2026-07-10",
      category: "bahan_baku",
      amount: 100000,
      createdAt: "2026-07-10T01:00:00Z"
    });
    await seedExpense({
      expenseId: "EXP-20260710-LATERX",
      expenseDate: "2026-07-10",
      category: "kemasan",
      amount: 30000,
      createdAt: "2026-07-10T05:00:00Z"
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/expenses",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ExpensesListDto>();
    expect(body.items.map((item) => item.expenseId)).toEqual([
      "EXP-20260710-LATERX",
      "EXP-20260710-EARLYX",
      "EXP-20260708-AAAAAA"
    ]);
    expect(body.total).toBe(3);
    expect(body.periodTotal).toBe(152000);
  });

  it("filters by date range and category, periodTotal follows the filters", async () => {
    await seedExpense({
      expenseId: "EXP-20260701-INRNGA",
      expenseDate: "2026-07-01",
      category: "bahan_baku",
      amount: 50000
    });
    await seedExpense({
      expenseId: "EXP-20260703-INRNGB",
      expenseDate: "2026-07-03",
      category: "bahan_baku",
      amount: 70000
    });
    await seedExpense({
      expenseId: "EXP-20260703-OTHCAT",
      expenseDate: "2026-07-03",
      category: "transport",
      amount: 15000
    });
    await seedExpense({
      expenseId: "EXP-20260709-OUTRNG",
      expenseDate: "2026-07-09",
      category: "bahan_baku",
      amount: 99000
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/expenses?from=2026-07-01&to=2026-07-05&category=bahan_baku",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ExpensesListDto>();
    expect(body.items.map((item) => item.expenseId)).toEqual([
      "EXP-20260703-INRNGB",
      "EXP-20260701-INRNGA"
    ]);
    expect(body.total).toBe(2);
    expect(body.periodTotal).toBe(120000);
  });

  it("rejects invalid list filters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/expenses?from=not-a-date",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(400);
  });

  it("paginates while periodTotal keeps covering the whole filtered set", async () => {
    await seedExpense({
      expenseId: "EXP-20260701-PAGEC",
      expenseDate: "2026-07-01",
      category: "lainnya",
      amount: 10000
    });
    await seedExpense({
      expenseId: "EXP-20260702-PAGEB",
      expenseDate: "2026-07-02",
      category: "lainnya",
      amount: 20000
    });
    await seedExpense({
      expenseId: "EXP-20260703-PAGEA",
      expenseDate: "2026-07-03",
      category: "lainnya",
      amount: 30000
    });

    const pageOne = await app.inject({
      method: "GET",
      url: "/api/expenses?page=1&limit=2",
      headers: { cookie }
    });
    const pageTwo = await app.inject({
      method: "GET",
      url: "/api/expenses?page=2&limit=2",
      headers: { cookie }
    });

    const bodyOne = pageOne.json<ExpensesListDto>();
    expect(bodyOne.items.map((item) => item.expenseId)).toEqual([
      "EXP-20260703-PAGEA",
      "EXP-20260702-PAGEB"
    ]);
    expect(bodyOne.total).toBe(3);
    expect(bodyOne.page).toBe(1);
    expect(bodyOne.limit).toBe(2);
    expect(bodyOne.periodTotal).toBe(60000);

    const bodyTwo = pageTwo.json<ExpensesListDto>();
    expect(bodyTwo.items.map((item) => item.expenseId)).toEqual(["EXP-20260701-PAGEC"]);
    expect(bodyTwo.page).toBe(2);
    expect(bodyTwo.periodTotal).toBe(60000);
  });

  it("patches an expense partially and bumps updated_at", async () => {
    await seedExpense({
      expenseId: "EXP-20260705-PATCHM",
      expenseDate: "2026-07-05",
      category: "gas",
      amount: 22000,
      createdAt: "2026-07-05T02:00:00Z"
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/expenses/EXP-20260705-PATCHM",
      headers: { cookie },
      payload: { amount: 44000, description: "Dua tabung" }
    });

    expect(response.statusCode).toBe(200);
    const { expense } = response.json<{ expense: ExpenseDto }>();
    expect(expense.amount).toBe(44000);
    expect(expense.description).toBe("Dua tabung");
    expect(expense.expenseDate).toBe("2026-07-05");
    expect(expense.category).toBe("gas");
    expect(new Date(expense.updatedAt).getTime()).toBeGreaterThan(
      new Date(expense.createdAt).getTime()
    );
  });

  it("rejects invalid patch payloads", async () => {
    await seedExpense({
      expenseId: "EXP-20260705-PATCHV",
      expenseDate: "2026-07-05",
      category: "gas",
      amount: 22000
    });

    const badAmount = await app.inject({
      method: "PATCH",
      url: "/api/expenses/EXP-20260705-PATCHV",
      headers: { cookie },
      payload: { amount: -1 }
    });
    const emptyPatch = await app.inject({
      method: "PATCH",
      url: "/api/expenses/EXP-20260705-PATCHV",
      headers: { cookie },
      payload: {}
    });

    expect(badAmount.statusCode).toBe(400);
    expect(emptyPatch.statusCode).toBe(400);
  });

  it("returns 404 when patching a missing expense", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/expenses/EXP-20260101-MISSIN",
      headers: { cookie },
      payload: { amount: 1000 }
    });

    expect(response.statusCode).toBe(404);
  });

  it("deletes an expense and returns 404 on the second attempt", async () => {
    await seedExpense({
      expenseId: "EXP-20260706-DELETE",
      expenseDate: "2026-07-06",
      category: "transport",
      amount: 12000
    });

    const first = await app.inject({
      method: "DELETE",
      url: "/api/expenses/EXP-20260706-DELETE",
      headers: { cookie }
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ deleted: boolean }>().deleted).toBe(true);

    const list = await app.inject({ method: "GET", url: "/api/expenses", headers: { cookie } });
    expect(list.json<ExpensesListDto>().items).toEqual([]);

    const second = await app.inject({
      method: "DELETE",
      url: "/api/expenses/EXP-20260706-DELETE",
      headers: { cookie }
    });
    expect(second.statusCode).toBe(404);
  });

  it("returns expense categories with Indonesian labels", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/expenses/categories",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ categories: { value: string; label: string }[] }>();
    expect(body.categories).toEqual([
      { value: "bahan_baku", label: "Bahan Baku" },
      { value: "gas", label: "Gas" },
      { value: "kemasan", label: "Kemasan" },
      { value: "transport", label: "Transport" },
      { value: "lainnya", label: "Lainnya" }
    ]);
  });
});
