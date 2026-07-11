import type { Db } from "../../db/client.js";
import type { OrderStatus, PaymentStatus } from "../../shared/enums.js";

// DTO shapes mirror web/src/api/types.ts (the canonical API contract).
export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
  variant?: string | null;
  notes?: string | null;
}

export interface OrderListItem {
  orderId: string;
  createdAt: string;
  updatedAt: string;
  customerWa: string;
  customerName: string | null;
  productsText: string;
  totalQuantity: number;
  estimatedSubtotal: number | null;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
}

export interface OrderDetail extends OrderListItem {
  products: OrderItem[];
  address: string;
  paymentMethod: string;
  notes: string | null;
  requestedTime: string | null;
  rawMessage: string | null;
  aiModel: string | null;
  aiConfidence: number | null;
  missingFields: string[];
  source: string;
}

export interface ListOrdersFilters {
  statuses?: OrderStatus[];
  paymentStatus?: PaymentStatus;
  q?: string;
  createdFromUtc?: string;
  createdToUtc?: string;
  limit: number;
  offset: number;
}

export interface ListOrdersResult {
  items: OrderListItem[];
  total: number;
}

interface OrderListRow {
  order_id: string;
  created_at: string;
  updated_at: string;
  customer_wa: string;
  customer_name: string | null;
  products_text: string;
  total_quantity: number;
  estimated_subtotal: number | null;
  payment_status: PaymentStatus;
  order_status: OrderStatus;
}

interface OrderRow extends OrderListRow {
  products_json: string;
  address: string;
  payment_method: string;
  notes: string | null;
  requested_time: string | null;
  raw_message: string | null;
  ai_model: string | null;
  ai_confidence: number | null;
  missing_fields_json: string;
  admin_notified_at: string | null;
  source: string;
}

const LIST_COLUMNS = `
  order_id,
  created_at,
  updated_at,
  customer_wa,
  customer_name,
  products_text,
  total_quantity,
  estimated_subtotal,
  payment_status,
  order_status
`;

// Bot-owned tables store timestamps as ISO-8601 TEXT with explicit zone.
// Both writers always bump updated_at — it is the optimistic-concurrency
// token, so millisecond precision keeps successive tokens distinct.
function isoUtcNow(): string {
  return new Date().toISOString();
}

// Escape LIKE wildcards so user input matches literally (backslash is the
// default LIKE escape character in Postgres).
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function createOrderStore(db: Db) {
  return {
    async listOrders(filters: ListOrdersFilters): Promise<ListOrdersResult> {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filters.statuses && filters.statuses.length > 0) {
        params.push(filters.statuses);
        conditions.push(`order_status = ANY($${params.length})`);
      }

      if (filters.paymentStatus) {
        params.push(filters.paymentStatus);
        conditions.push(`payment_status = $${params.length}`);
      }

      if (filters.q) {
        params.push(`%${escapeLikePattern(filters.q)}%`);
        const index = params.length;
        conditions.push(
          `(order_id ILIKE $${index} OR customer_wa ILIKE $${index} OR customer_name ILIKE $${index})`
        );
      }

      if (filters.createdFromUtc) {
        params.push(filters.createdFromUtc);
        conditions.push(`created_at::timestamptz >= $${params.length}::timestamptz`);
      }

      if (filters.createdToUtc) {
        params.push(filters.createdToUtc);
        conditions.push(`created_at::timestamptz < $${params.length}::timestamptz`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countResult = await db.query<{ count: string }>(
        `SELECT count(*) AS count FROM orders ${where}`,
        params
      );

      const listParams = [...params, filters.limit, filters.offset];
      const listResult = await db.query<OrderListRow>(
        `SELECT ${LIST_COLUMNS}
         FROM orders
         ${where}
         ORDER BY created_at::timestamptz DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        listParams
      );

      return {
        items: listResult.rows.map(mapOrderListRow),
        total: Number(countResult.rows[0]?.count ?? 0)
      };
    },

    async getOrder(orderId: string): Promise<OrderDetail | null> {
      const result = await db.query<OrderRow>("SELECT * FROM orders WHERE order_id = $1", [
        orderId
      ]);
      const row = result.rows[0];
      return row ? mapOrderRow(row) : null;
    },

    // Single-statement compare-and-swap on updated_at (see the bot repo's
    // docs/db-contract.md). Cancelling an order also cancels payment unless
    // the customer already paid. 0 rows means missing, stale token, or an
    // illegal transition — callers re-select to tell those apart.
    async updateOrderStatus(input: {
      orderId: string;
      orderStatus: OrderStatus;
      expectedUpdatedAt: string;
      allowedSourceStatuses: OrderStatus[];
    }): Promise<OrderDetail | null> {
      const result = await db.query<OrderRow>(
        `UPDATE orders
         SET order_status = $1,
             payment_status = CASE
               WHEN $1 = 'Cancelled' AND payment_status <> 'Paid' THEN 'Cancelled'
               ELSE payment_status
             END,
             updated_at = $2
         WHERE order_id = $3 AND updated_at = $4 AND order_status = ANY($5)
         RETURNING *`,
        [
          input.orderStatus,
          isoUtcNow(),
          input.orderId,
          input.expectedUpdatedAt,
          input.allowedSourceStatuses
        ]
      );
      const row = result.rows[0];
      return row ? mapOrderRow(row) : null;
    },

    async updatePaymentStatus(input: {
      orderId: string;
      paymentStatus: PaymentStatus;
      expectedUpdatedAt: string;
      allowedSourceStatuses: PaymentStatus[];
    }): Promise<OrderDetail | null> {
      const result = await db.query<OrderRow>(
        `UPDATE orders
         SET payment_status = $1,
             updated_at = $2
         WHERE order_id = $3 AND updated_at = $4 AND payment_status = ANY($5)
         RETURNING *`,
        [
          input.paymentStatus,
          isoUtcNow(),
          input.orderId,
          input.expectedUpdatedAt,
          input.allowedSourceStatuses
        ]
      );
      const row = result.rows[0];
      return row ? mapOrderRow(row) : null;
    }
  };
}

export type OrderStore = ReturnType<typeof createOrderStore>;

function mapOrderListRow(row: OrderListRow): OrderListItem {
  return {
    orderId: row.order_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerWa: row.customer_wa,
    customerName: row.customer_name,
    productsText: row.products_text,
    totalQuantity: row.total_quantity,
    estimatedSubtotal: row.estimated_subtotal,
    paymentStatus: row.payment_status,
    orderStatus: row.order_status
  };
}

function mapOrderRow(row: OrderRow): OrderDetail {
  return {
    ...mapOrderListRow(row),
    products: parseProducts(row.products_json),
    address: row.address,
    paymentMethod: row.payment_method,
    notes: row.notes,
    requestedTime: row.requested_time,
    rawMessage: row.raw_message,
    aiModel: row.ai_model,
    aiConfidence: row.ai_confidence,
    missingFields: parseStringArray(row.missing_fields_json),
    source: row.source
  };
}

function parseProducts(value: string): OrderItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const items: OrderItem[] = [];
  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }

    const item = candidate as Partial<OrderItem>;
    if (
      typeof item.productId !== "string" ||
      typeof item.name !== "string" ||
      typeof item.quantity !== "number" ||
      (typeof item.unitPrice !== "number" && item.unitPrice !== null)
    ) {
      continue;
    }

    items.push({
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice ?? null,
      variant: typeof item.variant === "string" ? item.variant : null,
      notes: typeof item.notes === "string" ? item.notes : null
    });
  }

  return items;
}

function parseStringArray(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item): item is string => typeof item === "string");
}
