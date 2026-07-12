import type { Db } from "../../db/client.js";
import type { OrderStatus, PaymentStatus } from "../../shared/enums.js";

// Read-only views over bot-owned tables (orders, messages, ai_logs) for the
// handoff inbox and log viewers. Bot timestamps are ISO-8601 TEXT with an
// explicit zone, so every comparison/sort casts with ::timestamptz.

export interface HandoffOrderRecord {
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

export type MessageDirection = "inbound" | "outbound";

export interface MessageLogRecord {
  messageId: string;
  customerWa: string;
  chatId: string;
  messageType: string;
  messageText: string | null;
  detectedIntent: string | null;
  processingStatus: string;
  errorMessage: string | null;
  receivedAt: string;
  direction: MessageDirection;
}

export interface AiLogRecord {
  logId: string;
  createdAt: string;
  messageId: string | null;
  customerWa: string | null;
  promptVersion: string;
  model: string;
  intent: string | null;
  confidence: number | null;
  validationStatus: string;
  errorType: string | null;
  handoffTriggered: boolean;
  latencyMs: number | null;
}

export interface MessageListFilters {
  customerWa?: string;
  fromUtc?: string;
  toUtc?: string;
  processingStatus?: string;
  direction?: MessageDirection;
  limit: number;
  offset: number;
}

export interface AiLogListFilters {
  fromUtc?: string;
  toUtc?: string;
  validationStatus?: string;
  handoffOnly: boolean;
  limit: number;
  offset: number;
}

type HandoffOrderRow = {
  order_id: string;
  created_at: string;
  updated_at: string;
  customer_wa: string;
  customer_name: string | null;
  products_text: string;
  total_quantity: number;
  estimated_subtotal: number | null;
  payment_status: string;
  order_status: string;
};

type MessageRow = {
  message_id: string;
  customer_wa: string;
  chat_id: string;
  message_type: string;
  message_text: string | null;
  detected_intent: string | null;
  processing_status: string;
  error_message: string | null;
  received_at: string;
  direction: string;
};

type AiLogRow = {
  log_id: string;
  created_at: string;
  message_id: string | null;
  customer_wa: string | null;
  prompt_version: string;
  model: string;
  intent: string | null;
  confidence: number | null;
  validation_status: string;
  error_type: string | null;
  handoff_triggered: number;
  latency_ms: number | null;
};

type CountRow = { count: string };

const HANDOFF_ORDER_STATUS = "Need Admin Help";

// Never select raw_payload_json — the log viewer must not leak raw payloads.
const MESSAGE_COLUMNS = `message_id, customer_wa, chat_id, message_type, message_text,
  detected_intent, processing_status, error_message, received_at, direction`;

const AI_LOG_COLUMNS = `log_id, created_at, message_id, customer_wa, prompt_version, model,
  intent, confidence, validation_status, error_type, handoff_triggered, latency_ms`;

export function createLogStore(db: Db) {
  return {
    async listHandoffOrders(): Promise<HandoffOrderRecord[]> {
      const result = await db.query<HandoffOrderRow>(
        `SELECT order_id, created_at, updated_at, customer_wa, customer_name, products_text,
                total_quantity, estimated_subtotal, payment_status, order_status
           FROM orders
          WHERE order_status = $1
          ORDER BY created_at::timestamptz ASC`,
        [HANDOFF_ORDER_STATUS]
      );

      return result.rows.map(mapHandoffOrderRow);
    },

    async listRecentMessagesByCustomer(
      customerWas: string[],
      perCustomer: number
    ): Promise<Map<string, MessageLogRecord[]>> {
      const grouped = new Map<string, MessageLogRecord[]>();
      if (customerWas.length === 0) {
        return grouped;
      }

      const result = await db.query<MessageRow>(
        `SELECT ${MESSAGE_COLUMNS}
           FROM (
             SELECT ${MESSAGE_COLUMNS},
                    row_number() OVER (
                      PARTITION BY customer_wa
                      ORDER BY received_at::timestamptz DESC
                    ) AS rn
               FROM messages
              WHERE customer_wa = ANY($1::text[])
           ) ranked
          WHERE rn <= $2
          ORDER BY customer_wa ASC, received_at::timestamptz DESC`,
        [customerWas, perCustomer]
      );

      for (const row of result.rows) {
        const record = mapMessageRow(row);
        const bucket = grouped.get(record.customerWa);
        if (bucket) {
          bucket.push(record);
        } else {
          grouped.set(record.customerWa, [record]);
        }
      }

      return grouped;
    },

    async listMessages(
      filters: MessageListFilters
    ): Promise<{ items: MessageLogRecord[]; total: number }> {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filters.customerWa !== undefined) {
        params.push(filters.customerWa);
        conditions.push(`customer_wa = $${params.length}`);
      }
      if (filters.fromUtc !== undefined) {
        params.push(filters.fromUtc);
        conditions.push(`received_at::timestamptz >= $${params.length}::timestamptz`);
      }
      if (filters.toUtc !== undefined) {
        params.push(filters.toUtc);
        conditions.push(`received_at::timestamptz < $${params.length}::timestamptz`);
      }
      if (filters.processingStatus !== undefined) {
        params.push(filters.processingStatus);
        conditions.push(`processing_status = $${params.length}`);
      }
      if (filters.direction !== undefined) {
        params.push(filters.direction);
        conditions.push(`direction = $${params.length}`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countResult = await db.query<CountRow>(
        `SELECT count(*) AS count FROM messages ${where}`,
        params
      );
      const total = Number(countResult.rows[0]?.count ?? 0);

      const listResult = await db.query<MessageRow>(
        `SELECT ${MESSAGE_COLUMNS}
           FROM messages ${where}
          ORDER BY received_at::timestamptz DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, filters.limit, filters.offset]
      );

      return { items: listResult.rows.map(mapMessageRow), total };
    },

    async listAiLogs(filters: AiLogListFilters): Promise<{ items: AiLogRecord[]; total: number }> {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filters.fromUtc !== undefined) {
        params.push(filters.fromUtc);
        conditions.push(`created_at::timestamptz >= $${params.length}::timestamptz`);
      }
      if (filters.toUtc !== undefined) {
        params.push(filters.toUtc);
        conditions.push(`created_at::timestamptz < $${params.length}::timestamptz`);
      }
      if (filters.validationStatus !== undefined) {
        params.push(filters.validationStatus);
        conditions.push(`validation_status = $${params.length}`);
      }
      if (filters.handoffOnly) {
        conditions.push("handoff_triggered <> 0");
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countResult = await db.query<CountRow>(
        `SELECT count(*) AS count FROM ai_logs ${where}`,
        params
      );
      const total = Number(countResult.rows[0]?.count ?? 0);

      const listResult = await db.query<AiLogRow>(
        `SELECT ${AI_LOG_COLUMNS}
           FROM ai_logs ${where}
          ORDER BY created_at::timestamptz DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, filters.limit, filters.offset]
      );

      return { items: listResult.rows.map(mapAiLogRow), total };
    }
  };
}

export type LogStore = ReturnType<typeof createLogStore>;

function mapHandoffOrderRow(row: HandoffOrderRow): HandoffOrderRecord {
  return {
    orderId: row.order_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerWa: row.customer_wa,
    customerName: row.customer_name,
    productsText: row.products_text,
    totalQuantity: row.total_quantity,
    estimatedSubtotal: row.estimated_subtotal,
    paymentStatus: row.payment_status as PaymentStatus,
    orderStatus: row.order_status as OrderStatus
  };
}

function mapMessageRow(row: MessageRow): MessageLogRecord {
  return {
    messageId: row.message_id,
    customerWa: row.customer_wa,
    chatId: row.chat_id,
    messageType: row.message_type,
    messageText: row.message_text,
    detectedIntent: row.detected_intent,
    processingStatus: row.processing_status,
    errorMessage: row.error_message,
    receivedAt: row.received_at,
    direction: row.direction as MessageDirection
  };
}

function mapAiLogRow(row: AiLogRow): AiLogRecord {
  return {
    logId: row.log_id,
    createdAt: row.created_at,
    messageId: row.message_id,
    customerWa: row.customer_wa,
    promptVersion: row.prompt_version,
    model: row.model,
    intent: row.intent,
    confidence: row.confidence,
    validationStatus: row.validation_status,
    errorType: row.error_type,
    handoffTriggered: row.handoff_triggered !== 0,
    latencyMs: row.latency_ms
  };
}
