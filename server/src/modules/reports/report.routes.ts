import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { AppConfig } from "../../config/env.js";
import type { Db } from "../../db/client.js";
import { isBusinessDate, jakartaDateRangeToUtc, todayJakarta } from "../../shared/dates.js";
import type { BucketUnit } from "./report.queries.js";
import { createReportQueries } from "./report.queries.js";

// Local zod helper (shared/dates.ts only exports the predicate).
const businessDateSchema = z
  .string()
  .refine((value) => isBusinessDate(value), { message: "Tanggal tidak valid (YYYY-MM-DD)" });

const summaryQuerySchema = z.object({
  date: businessDateSchema.optional()
});

const revenueQuerySchema = z.object({
  granularity: z.enum(["daily", "weekly", "monthly"]),
  from: businessDateSchema,
  to: businessDateSchema
});

const topProductsQuerySchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  limit: z.coerce.number().int().positive().max(100).default(10)
});

const profitQuerySchema = z.object({
  granularity: z.enum(["weekly", "monthly"]),
  from: businessDateSchema,
  to: businessDateSchema
});

const GRANULARITY_UNIT: Record<"daily" | "weekly" | "monthly", BucketUnit> = {
  daily: "day",
  weekly: "week",
  monthly: "month"
};

function badRequest(reply: FastifyReply, error: z.ZodError): FastifyReply {
  const issue = error.issues[0];
  const path = issue?.path.join(".") ?? "";
  const message = issue?.message ?? "Parameter tidak valid";
  return reply.status(400).send({ error: path ? `${path}: ${message}` : message });
}

function invalidRange(reply: FastifyReply): FastifyReply {
  return reply.status(400).send({ error: "Rentang tanggal tidak valid: from melewati to" });
}

export interface RegisterReportRoutesOptions {
  db: Db;
  config: AppConfig;
}

// Not declared `async` (route registration is synchronous) but keeps the
// Promise<void> signature the app.ts wiring awaits.
export function registerReportRoutes(
  app: FastifyInstance,
  options: RegisterReportRoutesOptions
): Promise<void> {
  const queries = createReportQueries(options.db);

  app.get("/api/reports/summary", async (request, reply) => {
    const parsed = summaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return badRequest(reply, parsed.error);
    }

    const date = parsed.data.date ?? todayJakarta();
    const { fromUtc, toUtc } = jakartaDateRangeToUtc(date, date);

    const [stats, byStatus, needAction, expensesTotal, topProducts] = await Promise.all([
      queries.orderStatsForRange(fromUtc, toUtc),
      queries.statusCountsForRange(fromUtc, toUtc),
      queries.needActionCounts(),
      queries.expensesTotalForDate(date),
      queries.topProducts(fromUtc, toUtc, 5)
    ]);

    return reply.send({
      date,
      revenue: stats.revenue,
      ordersCount: stats.ordersCount,
      unpricedOrders: stats.unpricedOrders,
      needAction,
      byStatus,
      expensesTotal,
      profit: stats.revenue - expensesTotal,
      topProducts
    });
  });

  app.get("/api/reports/revenue", async (request, reply) => {
    const parsed = revenueQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return badRequest(reply, parsed.error);
    }

    const { granularity, from, to } = parsed.data;
    if (from > to) {
      return invalidRange(reply);
    }

    const { fromUtc, toUtc } = jakartaDateRangeToUtc(from, to);
    const buckets = await queries.revenueBuckets(GRANULARITY_UNIT[granularity], fromUtc, toUtc);

    return reply.send({ buckets });
  });

  app.get("/api/reports/top-products", async (request, reply) => {
    const parsed = topProductsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return badRequest(reply, parsed.error);
    }

    const { from, to, limit } = parsed.data;
    if (from > to) {
      return invalidRange(reply);
    }

    const { fromUtc, toUtc } = jakartaDateRangeToUtc(from, to);
    const items = await queries.topProducts(fromUtc, toUtc, limit);

    return reply.send({ items });
  });

  app.get("/api/reports/profit", async (request, reply) => {
    const parsed = profitQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return badRequest(reply, parsed.error);
    }

    const { granularity, from, to } = parsed.data;
    if (from > to) {
      return invalidRange(reply);
    }

    const { fromUtc, toUtc } = jakartaDateRangeToUtc(from, to);
    const [buckets, expensesByCategory] = await Promise.all([
      queries.profitBuckets(GRANULARITY_UNIT[granularity], fromUtc, toUtc, from, to),
      queries.expensesByCategory(from, to)
    ]);

    return reply.send({ buckets, expensesByCategory });
  });

  return Promise.resolve();
}
