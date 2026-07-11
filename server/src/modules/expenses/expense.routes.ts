import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { AppConfig } from "../../config/env.js";
import type { Db } from "../../db/client.js";
import { isBusinessDate } from "../../shared/dates.js";
import { expenseCategories, expenseCategorySchema } from "../../shared/enums.js";
import type { ExpenseCategory } from "../../shared/enums.js";
import { paginationOffset, paginationSchema } from "../../shared/pagination.js";
import { createExpenseStore } from "./expense.store.js";
import type { UpdateExpenseInput } from "./expense.store.js";

// Local by design (shared files are frozen): a business date is a plain
// 'YYYY-MM-DD' calendar day in Asia/Jakarta, validated via shared/dates.
const businessDateSchema = z.string().refine(isBusinessDate, "Tanggal harus berformat YYYY-MM-DD");

const listQuerySchema = paginationSchema.extend({
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
  category: expenseCategorySchema.optional()
});

const amountSchema = z.number().int().positive();

const createBodySchema = z.object({
  expenseDate: businessDateSchema,
  category: expenseCategorySchema,
  amount: amountSchema,
  description: z.string().optional()
});

const patchBodySchema = z
  .object({
    expenseDate: businessDateSchema.optional(),
    category: expenseCategorySchema.optional(),
    amount: amountSchema.optional(),
    description: z.string().nullable().optional()
  })
  .refine(
    (body) =>
      body.expenseDate !== undefined ||
      body.category !== undefined ||
      body.amount !== undefined ||
      body.description !== undefined,
    "Tidak ada field yang diubah"
  );

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  bahan_baku: "Bahan Baku",
  gas: "Gas",
  kemasan: "Kemasan",
  transport: "Transport",
  lainnya: "Lainnya"
};

function buildExpenseId(expenseDate: string): string {
  return `EXP-${expenseDate.replaceAll("-", "")}-${nanoid(6).toUpperCase()}`;
}

export interface RegisterExpenseRoutesOptions {
  db: Db;
  config: AppConfig;
}

// Not declared `async` because route registration itself has nothing to
// await; the Promise<void> signature expected by app.ts is preserved.
export function registerExpenseRoutes(
  app: FastifyInstance,
  options: RegisterExpenseRoutesOptions
): Promise<void> {
  const store = createExpenseStore(options.db);

  app.get("/api/expenses", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({ error: "Parameter filter tidak valid" });
    }

    const { page, limit, from, to, category } = parsed.data;
    const result = await store.list({
      from,
      to,
      category,
      limit,
      offset: paginationOffset({ page, limit })
    });

    return reply.send({
      items: result.items,
      total: result.total,
      page,
      limit,
      periodTotal: result.periodTotal
    });
  });

  app.get("/api/expenses/categories", async (_request, reply) => {
    return reply.send({
      categories: expenseCategories.map((value) => ({
        value,
        label: CATEGORY_LABELS[value]
      }))
    });
  });

  app.post("/api/expenses", async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: "Data pengeluaran tidak valid" });
    }

    const expense = await store.create({
      expenseId: buildExpenseId(parsed.data.expenseDate),
      expenseDate: parsed.data.expenseDate,
      category: parsed.data.category,
      amount: parsed.data.amount,
      description: parsed.data.description ?? null
    });

    return reply.status(201).send({ expense });
  });

  app.patch<{ Params: { expenseId: string } }>(
    "/api/expenses/:expenseId",
    async (request, reply) => {
      const parsed = patchBodySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({ error: "Data pengeluaran tidak valid" });
      }

      const patch: UpdateExpenseInput = {};
      if (parsed.data.expenseDate !== undefined) {
        patch.expenseDate = parsed.data.expenseDate;
      }
      if (parsed.data.category !== undefined) {
        patch.category = parsed.data.category;
      }
      if (parsed.data.amount !== undefined) {
        patch.amount = parsed.data.amount;
      }
      if (parsed.data.description !== undefined) {
        patch.description = parsed.data.description;
      }

      const expense = await store.update(request.params.expenseId, patch);

      if (!expense) {
        return reply.status(404).send({ error: "Pengeluaran tidak ditemukan" });
      }

      return reply.send({ expense });
    }
  );

  app.delete<{ Params: { expenseId: string } }>(
    "/api/expenses/:expenseId",
    async (request, reply) => {
      const deleted = await store.remove(request.params.expenseId);

      if (!deleted) {
        return reply.status(404).send({ error: "Pengeluaran tidak ditemukan" });
      }

      return reply.send({ deleted: true });
    }
  );

  return Promise.resolve();
}
