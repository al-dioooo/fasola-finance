import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppConfig } from "../../config/env.js";
import type { Db } from "../../db/client.js";
import { isBusinessDate, jakartaDateRangeToUtc } from "../../shared/dates.js";
import { paginationOffset, paginationSchema } from "../../shared/pagination.js";
import { createGowaClient, type GowaDevice } from "./gowa.client.js";
import {
  createLogStore,
  type AiLogRecord,
  type HandoffOrderRecord,
  type MessageLogRecord
} from "./log.store.js";

export interface RegisterBotOpsRoutesOptions {
  db: Db;
  config: AppConfig;
  fetchImpl?: typeof fetch;
}

// Response shapes mirror web/src/api/types.ts (the canonical API contract).
interface BotStatusResponse {
  gowaReachable: boolean;
  connected: boolean;
  devices: GowaDevice[];
}

interface BotLoginResponse {
  qrImageDataUrl: string;
  durationSeconds: number;
}

interface BotHealthResponse {
  bot: "ok" | "down";
  gowa: "ok" | "down";
  db: "ok" | "down";
}

interface HandoffResponse {
  items: { order: HandoffOrderRecord; recentMessages: MessageLogRecord[] }[];
}

interface MessagesResponse {
  items: MessageLogRecord[];
  total: number;
  page: number;
  limit: number;
}

interface AiLogsResponse {
  items: AiLogRecord[];
  total: number;
  page: number;
  limit: number;
}

const HEALTH_TIMEOUT_MS = 2000;
const HANDOFF_RECENT_MESSAGE_COUNT = 10;

const businessDateSchema = z.string().refine(isBusinessDate, "Expected a YYYY-MM-DD business date");

const messagesQuerySchema = paginationSchema.extend({
  customerWa: z.string().min(1).optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
  processingStatus: z.string().min(1).optional()
});

const aiLogsQuerySchema = paginationSchema.extend({
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
  validationStatus: z.string().min(1).optional(),
  handoffOnly: z.enum(["true", "false"]).optional()
});

export function registerBotOpsRoutes(
  app: FastifyInstance,
  options: RegisterBotOpsRoutesOptions
): Promise<void> {
  const { db, config } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const store = createLogStore(db);
  const gowa = createGowaClient({
    baseUrl: config.GOWA_BASE_URL,
    basicAuthUser: config.GOWA_BASIC_AUTH_USER,
    basicAuthPassword: config.GOWA_BASIC_AUTH_PASSWORD,
    fetchImpl
  });
  const botHealthUrl = `${config.BOT_BASE_URL.replace(/\/+$/, "")}/health`;

  // GoWA being down is an expected operational state the UI must render,
  // so this endpoint always answers 200.
  app.get("/api/bot/status", async (): Promise<BotStatusResponse> => {
    const devices = await gowa.getDevices();
    if (!devices.ok) {
      return { gowaReachable: false, connected: false, devices: [] };
    }

    return { gowaReachable: true, connected: devices.value.length > 0, devices: devices.value };
  });

  app.post("/api/bot/login", async (_request, reply) => {
    const login = await gowa.requestLoginQr();
    if (!login.ok) {
      return reply.status(502).send({ error: login.error });
    }

    // The QR PNG sits behind GoWA basic auth, so the browser cannot load it
    // directly — proxy it as a data URL instead.
    const png = await gowa.fetchQrPngBase64(login.value.qrLink);
    if (!png.ok) {
      return reply.status(502).send({ error: png.error });
    }

    const body: BotLoginResponse = {
      qrImageDataUrl: `data:image/png;base64,${png.value}`,
      durationSeconds: login.value.durationSeconds
    };
    return body;
  });

  app.post("/api/bot/logout", async (_request, reply) => {
    const result = await gowa.logout();
    if (!result.ok) {
      return reply.status(502).send({ error: result.error });
    }

    return { ok: true };
  });

  app.post("/api/bot/reconnect", async (_request, reply) => {
    const result = await gowa.reconnect();
    if (!result.ok) {
      return reply.status(502).send({ error: result.error });
    }

    return { ok: true };
  });

  app.get("/api/bot/health", async (): Promise<BotHealthResponse> => {
    const [botOk, gowaDevices, dbOk] = await Promise.all([
      probeHttpOk(fetchImpl, botHealthUrl, HEALTH_TIMEOUT_MS),
      gowa.getDevices(HEALTH_TIMEOUT_MS),
      db.query("SELECT 1").then(
        () => true,
        () => false
      )
    ]);

    return {
      bot: botOk ? "ok" : "down",
      gowa: gowaDevices.ok ? "ok" : "down",
      db: dbOk ? "ok" : "down"
    };
  });

  app.get("/api/handoff", async (): Promise<HandoffResponse> => {
    const orders = await store.listHandoffOrders();
    const recentByCustomer = await store.listRecentMessagesByCustomer(
      orders.map((order) => order.customerWa),
      HANDOFF_RECENT_MESSAGE_COUNT
    );

    return {
      items: orders.map((order) => ({
        order,
        recentMessages: recentByCustomer.get(order.customerWa) ?? []
      }))
    };
  });

  app.get("/api/messages", async (request, reply) => {
    const parsed = messagesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query parameters" });
    }

    const query = parsed.data;
    const range = resolveJakartaRange(query.from, query.to);
    const { items, total } = await store.listMessages({
      ...(query.customerWa !== undefined ? { customerWa: query.customerWa } : {}),
      ...(range.fromUtc !== undefined ? { fromUtc: range.fromUtc } : {}),
      ...(range.toUtc !== undefined ? { toUtc: range.toUtc } : {}),
      ...(query.processingStatus !== undefined ? { processingStatus: query.processingStatus } : {}),
      limit: query.limit,
      offset: paginationOffset(query)
    });

    const body: MessagesResponse = { items, total, page: query.page, limit: query.limit };
    return body;
  });

  app.get("/api/ai-logs", async (request, reply) => {
    const parsed = aiLogsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query parameters" });
    }

    const query = parsed.data;
    const range = resolveJakartaRange(query.from, query.to);
    const { items, total } = await store.listAiLogs({
      ...(range.fromUtc !== undefined ? { fromUtc: range.fromUtc } : {}),
      ...(range.toUtc !== undefined ? { toUtc: range.toUtc } : {}),
      ...(query.validationStatus !== undefined ? { validationStatus: query.validationStatus } : {}),
      handoffOnly: query.handoffOnly === "true",
      limit: query.limit,
      offset: paginationOffset(query)
    });

    const body: AiLogsResponse = { items, total, page: query.page, limit: query.limit };
    return body;
  });

  return Promise.resolve();
}

// Half-open UTC range covering the given Jakarta business dates; each bound
// is optional and independent.
function resolveJakartaRange(from?: string, to?: string): { fromUtc?: string; toUtc?: string } {
  const range: { fromUtc?: string; toUtc?: string } = {};

  if (from !== undefined) {
    range.fromUtc = jakartaDateRangeToUtc(from, from).fromUtc;
  }
  if (to !== undefined) {
    range.toUtc = jakartaDateRangeToUtc(to, to).toUtc;
  }

  return range;
}

async function probeHttpOk(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
