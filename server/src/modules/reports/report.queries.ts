import type { Db } from "../../db/client.js";
import { REVENUE_ORDER_STATUSES } from "../../shared/constants.js";
import type { ExpenseCategory, OrderStatus } from "../../shared/enums.js";

// Jakarta bucketing contract: bot timestamps are ISO-8601 TEXT with explicit
// zone, so every comparison casts with ::timestamptz and every bucket is the
// Jakarta-local calendar date of the truncated period (ISO Monday for weeks).
export type BucketUnit = "day" | "week" | "month";

export interface OrderRangeStats {
  ordersCount: number;
  revenue: number;
  unpricedOrders: number;
}

export interface NeedActionCounts {
  pendingConfirmation: number;
  needAdminHelp: number;
}

export interface TopProductRow {
  productId: string;
  name: string;
  totalQty: number;
  estRevenue: number;
}

export interface RevenueBucketRow {
  bucket: string;
  orders: number;
  revenue: number;
  unpricedOrders: number;
}

export interface ProfitBucketRow {
  bucket: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface ExpenseCategoryTotal {
  category: ExpenseCategory;
  total: number;
}

export interface ReportQueries {
  orderStatsForRange(fromUtc: string, toUtc: string): Promise<OrderRangeStats>;
  statusCountsForRange(
    fromUtc: string,
    toUtc: string
  ): Promise<Partial<Record<OrderStatus, number>>>;
  needActionCounts(): Promise<NeedActionCounts>;
  expensesTotalForDate(date: string): Promise<number>;
  topProducts(fromUtc: string, toUtc: string, limit: number): Promise<TopProductRow[]>;
  revenueBuckets(unit: BucketUnit, fromUtc: string, toUtc: string): Promise<RevenueBucketRow[]>;
  profitBuckets(
    unit: BucketUnit,
    fromUtc: string,
    toUtc: string,
    fromDate: string,
    toDate: string
  ): Promise<ProfitBucketRow[]>;
  expensesByCategory(fromDate: string, toDate: string): Promise<ExpenseCategoryTotal[]>;
}

const REVENUE_STATUSES: string[] = [...REVENUE_ORDER_STATUSES];

const JAKARTA_BUCKET_SQL =
  "date_trunc($1, created_at::timestamptz AT TIME ZONE 'Asia/Jakarta')::date::text";

export function createReportQueries(db: Db): ReportQueries {
  return {
    async orderStatsForRange(fromUtc, toUtc) {
      const result = await db.query<{
        orders_count: number;
        revenue: number;
        unpriced_orders: number;
      }>(
        `SELECT
           count(*)::int AS orders_count,
           COALESCE(sum(estimated_subtotal), 0)::float8 AS revenue,
           (count(*) FILTER (WHERE estimated_subtotal IS NULL))::int AS unpriced_orders
         FROM orders
         WHERE order_status = ANY($1)
           AND created_at::timestamptz >= $2::timestamptz
           AND created_at::timestamptz < $3::timestamptz`,
        [REVENUE_STATUSES, fromUtc, toUtc]
      );

      const row = result.rows[0];
      return {
        ordersCount: Number(row?.orders_count ?? 0),
        revenue: Number(row?.revenue ?? 0),
        unpricedOrders: Number(row?.unpriced_orders ?? 0)
      };
    },

    async statusCountsForRange(fromUtc, toUtc) {
      const result = await db.query<{ order_status: string; count: number }>(
        `SELECT order_status, count(*)::int AS count
         FROM orders
         WHERE created_at::timestamptz >= $1::timestamptz
           AND created_at::timestamptz < $2::timestamptz
         GROUP BY order_status`,
        [fromUtc, toUtc]
      );

      const byStatus: Partial<Record<OrderStatus, number>> = {};
      for (const row of result.rows) {
        byStatus[row.order_status as OrderStatus] = Number(row.count);
      }
      return byStatus;
    },

    async needActionCounts() {
      const result = await db.query<{
        pending_confirmation: number;
        need_admin_help: number;
      }>(
        `SELECT
           (count(*) FILTER (WHERE order_status = 'Pending Admin Confirmation'))::int
             AS pending_confirmation,
           (count(*) FILTER (WHERE order_status = 'Need Admin Help'))::int AS need_admin_help
         FROM orders`
      );

      const row = result.rows[0];
      return {
        pendingConfirmation: Number(row?.pending_confirmation ?? 0),
        needAdminHelp: Number(row?.need_admin_help ?? 0)
      };
    },

    async expensesTotalForDate(date) {
      const result = await db.query<{ total: number }>(
        `SELECT COALESCE(sum(amount), 0)::float8 AS total
         FROM fin_expenses
         WHERE expense_date = $1::date`,
        [date]
      );

      return Number(result.rows[0]?.total ?? 0);
    },

    async topProducts(fromUtc, toUtc, limit) {
      const result = await db.query<{
        product_id: string;
        name: string;
        total_qty: number;
        est_revenue: number;
      }>(
        `SELECT
           item->>'productId' AS product_id,
           max(item->>'name') AS name,
           sum((item->>'quantity')::int)::int AS total_qty,
           sum((item->>'quantity')::int * COALESCE((item->>'unitPrice')::numeric, 0))::float8
             AS est_revenue
         FROM orders o
         CROSS JOIN LATERAL jsonb_array_elements(o.products_json::jsonb) AS item
         WHERE o.order_status = ANY($1)
           AND o.created_at::timestamptz >= $2::timestamptz
           AND o.created_at::timestamptz < $3::timestamptz
         GROUP BY item->>'productId'
         ORDER BY total_qty DESC, est_revenue DESC, product_id ASC
         LIMIT $4`,
        [REVENUE_STATUSES, fromUtc, toUtc, limit]
      );

      return result.rows.map((row) => ({
        productId: row.product_id,
        name: row.name,
        totalQty: Number(row.total_qty),
        estRevenue: Number(row.est_revenue)
      }));
    },

    async revenueBuckets(unit, fromUtc, toUtc) {
      const result = await db.query<{
        bucket: string;
        orders: number;
        revenue: number;
        unpriced_orders: number;
      }>(
        `SELECT
           ${JAKARTA_BUCKET_SQL} AS bucket,
           count(*)::int AS orders,
           COALESCE(sum(estimated_subtotal), 0)::float8 AS revenue,
           (count(*) FILTER (WHERE estimated_subtotal IS NULL))::int AS unpriced_orders
         FROM orders
         WHERE order_status = ANY($2)
           AND created_at::timestamptz >= $3::timestamptz
           AND created_at::timestamptz < $4::timestamptz
         GROUP BY 1
         ORDER BY 1 ASC`,
        [unit, REVENUE_STATUSES, fromUtc, toUtc]
      );

      return result.rows.map((row) => ({
        bucket: row.bucket,
        orders: Number(row.orders),
        revenue: Number(row.revenue),
        unpricedOrders: Number(row.unpriced_orders)
      }));
    },

    async profitBuckets(unit, fromUtc, toUtc, fromDate, toDate) {
      const result = await db.query<{
        bucket: string;
        revenue: number;
        expenses: number;
      }>(
        `WITH revenue AS (
           SELECT
             ${JAKARTA_BUCKET_SQL} AS bucket,
             COALESCE(sum(estimated_subtotal), 0)::float8 AS revenue
           FROM orders
           WHERE order_status = ANY($2)
             AND created_at::timestamptz >= $3::timestamptz
             AND created_at::timestamptz < $4::timestamptz
           GROUP BY 1
         ),
         expenses AS (
           SELECT
             date_trunc($1, expense_date::timestamp)::date::text AS bucket,
             sum(amount)::float8 AS expenses
           FROM fin_expenses
           WHERE expense_date BETWEEN $5::date AND $6::date
           GROUP BY 1
         )
         SELECT
           COALESCE(r.bucket, e.bucket) AS bucket,
           COALESCE(r.revenue, 0)::float8 AS revenue,
           COALESCE(e.expenses, 0)::float8 AS expenses
         FROM revenue r
         FULL OUTER JOIN expenses e ON e.bucket = r.bucket
         ORDER BY 1 ASC`,
        [unit, REVENUE_STATUSES, fromUtc, toUtc, fromDate, toDate]
      );

      return result.rows.map((row) => {
        const revenue = Number(row.revenue);
        const expenses = Number(row.expenses);
        return {
          bucket: row.bucket,
          revenue,
          expenses,
          profit: revenue - expenses
        };
      });
    },

    async expensesByCategory(fromDate, toDate) {
      const result = await db.query<{ category: string; total: number }>(
        `SELECT category, sum(amount)::float8 AS total
         FROM fin_expenses
         WHERE expense_date BETWEEN $1::date AND $2::date
         GROUP BY category
         ORDER BY total DESC, category ASC`,
        [fromDate, toDate]
      );

      return result.rows.map((row) => ({
        category: row.category as ExpenseCategory,
        total: Number(row.total)
      }));
    }
  };
}
