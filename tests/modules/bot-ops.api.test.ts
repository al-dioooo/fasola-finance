import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Db } from "../../server/src/db/client.js";
import type {
  AiLogsResponse,
  BotHealthResponse,
  BotLoginResponse,
  BotStatusResponse,
  HandoffResponse,
  MessagesResponse
} from "../../web/src/api/types.js";
import { buildTestApp, loginAndGetCookie } from "../helpers/app.js";
import { createMigratedTestDatabase, type TestDatabase } from "../helpers/db.js";

const GOWA_DEVICES_URL = "http://127.0.0.1:3001/app/devices";
const GOWA_LOGIN_URL = "http://127.0.0.1:3001/app/login";
const GOWA_LOGOUT_URL = "http://127.0.0.1:3001/app/logout";
const GOWA_RECONNECT_URL = "http://127.0.0.1:3001/app/reconnect";
const BOT_HEALTH_URL = "http://127.0.0.1:3010/health";
const QR_LINK = "http://127.0.0.1:3001/statics/qrcode/scan-qr-abc123.png";

const EXPECTED_GOWA_AUTH = `Basic ${Buffer.from("test-gowa-user:test-gowa-password").toString(
  "base64"
)}`;

type FetchParams = Parameters<typeof fetch>;
const fetchMock = vi.fn<(input: FetchParams[0], init?: FetchParams[1]) => Promise<Response>>();

// Request objects have no custom toString, so String(input) trips
// no-base-to-string — extract the URL explicitly instead.
function toUrlString(input: FetchParams[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function parseBody<T>(response: { body: string }): T {
  return JSON.parse(response.body) as T;
}

interface SeedOrderInput {
  orderId: string;
  createdAt: string;
  customerWa: string;
  customerName: string | null;
  orderStatus: string;
  estimatedSubtotal: number | null;
}

async function insertOrder(db: Db, input: SeedOrderInput): Promise<void> {
  await db.query(
    `INSERT INTO orders (
       order_id, created_at, updated_at, customer_wa, customer_name, products_text,
       products_json, total_quantity, estimated_subtotal, address, payment_method,
       payment_status, order_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      input.orderId,
      input.createdAt,
      input.createdAt,
      input.customerWa,
      input.customerName,
      "2x Ayam Bakar",
      "[]",
      2,
      input.estimatedSubtotal,
      "Jl. Melati 1",
      "cash",
      "Unpaid",
      input.orderStatus
    ]
  );
}

interface SeedMessageInput {
  messageId: string;
  customerWa: string;
  receivedAt: string;
  processingStatus: string;
}

async function insertMessage(db: Db, input: SeedMessageInput): Promise<void> {
  await db.query(
    `INSERT INTO messages (
       message_id, customer_wa, chat_id, message_type, message_text, raw_payload_json,
       received_at, detected_intent, processing_status, error_message
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.messageId,
      input.customerWa,
      `${input.customerWa}@s.whatsapp.net`,
      "text",
      "Halo, mau pesan",
      '{"secret":"never-expose"}',
      input.receivedAt,
      "order",
      input.processingStatus,
      null
    ]
  );
}

describe("bot ops API", () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();

    await insertOrder(testDb.db, {
      orderId: "ord-help-1",
      createdAt: "2026-07-01T03:00:00Z",
      customerWa: "628111",
      customerName: "Ibu Sari",
      orderStatus: "Need Admin Help",
      estimatedSubtotal: 50000
    });
    await insertOrder(testDb.db, {
      orderId: "ord-help-2",
      createdAt: "2026-07-02T03:00:00Z",
      customerWa: "628222",
      customerName: null,
      orderStatus: "Need Admin Help",
      estimatedSubtotal: null
    });
    await insertOrder(testDb.db, {
      orderId: "ord-done-1",
      createdAt: "2026-07-01T05:00:00Z",
      customerWa: "628333",
      customerName: "Pak Budi",
      orderStatus: "Completed",
      estimatedSubtotal: 75000
    });

    // 12 messages for 628111 (2 failed), minutes 10..21 so text order == time order.
    for (let i = 0; i < 12; i += 1) {
      const minute = String(10 + i).padStart(2, "0");
      await insertMessage(testDb.db, {
        messageId: `msg-111-${i}`,
        customerWa: "628111",
        receivedAt: `2026-07-01T02:${minute}:00Z`,
        processingStatus: i < 2 ? "failed" : "done"
      });
    }
    // Jakarta boundary pair: 16:59:59Z is still 2026-07-04 in Jakarta,
    // 17:00:00Z is already 2026-07-05.
    await insertMessage(testDb.db, {
      messageId: "msg-222-a",
      customerWa: "628222",
      receivedAt: "2026-07-04T16:59:59Z",
      processingStatus: "done"
    });
    await insertMessage(testDb.db, {
      messageId: "msg-222-b",
      customerWa: "628222",
      receivedAt: "2026-07-04T17:00:00Z",
      processingStatus: "done"
    });

    app = await buildTestApp({ db: testDb.db, fetchImpl: fetchMock });
    cookie = await loginAndGetCookie(app);
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it("returns 401 without a session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/handoff" });

    expect(response.statusCode).toBe(401);
  });

  it("reports GoWA status when a device is connected", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          code: "SUCCESS",
          message: "Fetch device success",
          results: [{ name: "Fasola", device: "628123:1@s.whatsapp.net" }]
        })
      )
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/bot/status",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = parseBody<BotStatusResponse>(response);
    expect(body).toEqual({
      gowaReachable: true,
      connected: true,
      devices: [{ name: "Fasola", device: "628123:1@s.whatsapp.net" }]
    });

    const call = fetchMock.mock.calls[0];
    expect(call && toUrlString(call[0])).toBe(GOWA_DEVICES_URL);
    expect(call?.[1]?.headers).toEqual({ authorization: EXPECTED_GOWA_AUTH });
  });

  it("reports connected=false when GoWA has no devices", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ code: "SUCCESS", message: "ok", results: [] }))
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/bot/status",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(parseBody<BotStatusResponse>(response)).toEqual({
      gowaReachable: true,
      connected: false,
      devices: []
    });
  });

  it("returns gowaReachable=false with HTTP 200 when GoWA is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:3001"));

    const response = await app.inject({
      method: "GET",
      url: "/api/bot/status",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(parseBody<BotStatusResponse>(response)).toEqual({
      gowaReachable: false,
      connected: false,
      devices: []
    });
  });

  it("returns gowaReachable=false when GoWA answers non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502 }));

    const response = await app.inject({
      method: "GET",
      url: "/api/bot/status",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(parseBody<BotStatusResponse>(response)).toEqual({
      gowaReachable: false,
      connected: false,
      devices: []
    });
  });

  it("returns the QR image as a data URL on login", async () => {
    fetchMock.mockImplementation((input) => {
      const url = toUrlString(input);
      if (url === GOWA_LOGIN_URL) {
        return Promise.resolve(
          jsonResponse({
            code: "SUCCESS",
            message: "Success",
            results: { qr_duration: 30, qr_link: QR_LINK }
          })
        );
      }
      if (url === QR_LINK) {
        return Promise.resolve(new Response(new Uint8Array([137, 80, 78, 71])));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/bot/login",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = parseBody<BotLoginResponse>(response);
    const expectedBase64 = Buffer.from([137, 80, 78, 71]).toString("base64");
    expect(body.qrImageDataUrl).toBe(`data:image/png;base64,${expectedBase64}`);
    expect(body.durationSeconds).toBe(30);

    // The QR PNG itself must be fetched with GoWA basic auth.
    const qrCall = fetchMock.mock.calls.find((call) => toUrlString(call[0]) === QR_LINK);
    expect(qrCall?.[1]?.headers).toEqual({ authorization: EXPECTED_GOWA_AUTH });
  });

  it("returns 502 when GoWA login fails", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: "ERROR", message: "you are already logged in" }, 500)
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/bot/login",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(502);
    const body = parseBody<{ error: string }>(response);
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("logs out via GoWA", async () => {
    fetchMock.mockImplementation((input) => {
      expect(toUrlString(input)).toBe(GOWA_LOGOUT_URL);
      return Promise.resolve(
        jsonResponse({ code: "SUCCESS", message: "Success logout", results: null })
      );
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/bot/logout",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(parseBody<{ ok: boolean }>(response)).toEqual({ ok: true });
  });

  it("returns 502 when reconnect fails", async () => {
    fetchMock.mockImplementation((input) => {
      expect(toUrlString(input)).toBe(GOWA_RECONNECT_URL);
      return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:3001"));
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/bot/reconnect",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(502);
    const body = parseBody<{ error: string }>(response);
    expect(body.error).toContain("GoWA request failed");
  });

  it("reports composite health with the bot down", async () => {
    fetchMock.mockImplementation((input) => {
      const url = toUrlString(input);
      if (url === BOT_HEALTH_URL) {
        return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:3010"));
      }
      if (url === GOWA_DEVICES_URL) {
        return Promise.resolve(jsonResponse({ code: "SUCCESS", message: "ok", results: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/bot/health",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(parseBody<BotHealthResponse>(response)).toEqual({
      bot: "down",
      gowa: "ok",
      db: "ok"
    });
  });

  it("lists handoff orders oldest-first with their recent messages", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/handoff",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = parseBody<HandoffResponse>(response);
    expect(body.items).toHaveLength(2);

    const first = body.items[0];
    expect(first?.order.orderId).toBe("ord-help-1");
    expect(first?.order.customerWa).toBe("628111");
    expect(first?.order.customerName).toBe("Ibu Sari");
    expect(first?.order.orderStatus).toBe("Need Admin Help");
    expect(first?.order.paymentStatus).toBe("Unpaid");
    expect(first?.order.estimatedSubtotal).toBe(50000);
    expect(first?.order.totalQuantity).toBe(2);
    // Last 10 messages, newest first; the two oldest (msg-111-0/1) fall off.
    expect(first?.recentMessages).toHaveLength(10);
    expect(first?.recentMessages[0]?.messageId).toBe("msg-111-11");
    expect(first?.recentMessages[9]?.messageId).toBe("msg-111-2");
    expect(first?.recentMessages[0]).not.toHaveProperty("rawPayloadJson");
    expect(first?.recentMessages[0]).not.toHaveProperty("raw_payload_json");

    const second = body.items[1];
    expect(second?.order.orderId).toBe("ord-help-2");
    expect(second?.recentMessages).toHaveLength(2);
    expect(second?.recentMessages[0]?.messageId).toBe("msg-222-b");
  });

  it("lists messages newest-first with default pagination", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/messages",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = parseBody<MessagesResponse>(response);
    expect(body.total).toBe(14);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(25);
    expect(body.items).toHaveLength(14);
    expect(body.items[0]?.messageId).toBe("msg-222-b");
    expect(body.items[1]?.messageId).toBe("msg-222-a");
    expect(body.items[2]?.messageId).toBe("msg-111-11");
    expect(body.items[0]).not.toHaveProperty("rawPayloadJson");
  });

  it("filters messages by customer, processing status, and Jakarta date", async () => {
    const byCustomer = await app.inject({
      method: "GET",
      url: "/api/messages?customerWa=628111",
      headers: { cookie }
    });
    expect(parseBody<MessagesResponse>(byCustomer).total).toBe(12);

    const byStatus = await app.inject({
      method: "GET",
      url: "/api/messages?processingStatus=failed",
      headers: { cookie }
    });
    const failed = parseBody<MessagesResponse>(byStatus);
    expect(failed.total).toBe(2);
    expect(failed.items.map((item) => item.messageId)).toEqual(["msg-111-1", "msg-111-0"]);

    // 2026-07-04T17:00:00Z is 2026-07-05 00:00 in Jakarta — boundary check.
    const byDate = await app.inject({
      method: "GET",
      url: "/api/messages?from=2026-07-05&to=2026-07-05",
      headers: { cookie }
    });
    const onJul5 = parseBody<MessagesResponse>(byDate);
    expect(onJul5.total).toBe(1);
    expect(onJul5.items[0]?.messageId).toBe("msg-222-b");

    const dayBefore = await app.inject({
      method: "GET",
      url: "/api/messages?from=2026-07-04&to=2026-07-04",
      headers: { cookie }
    });
    const onJul4 = parseBody<MessagesResponse>(dayBefore);
    expect(onJul4.total).toBe(1);
    expect(onJul4.items[0]?.messageId).toBe("msg-222-a");
  });

  it("paginates messages", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/messages?customerWa=628111&limit=5&page=3",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = parseBody<MessagesResponse>(response);
    expect(body.total).toBe(12);
    expect(body.page).toBe(3);
    expect(body.limit).toBe(5);
    expect(body.items.map((item) => item.messageId)).toEqual(["msg-111-1", "msg-111-0"]);
  });

  it("rejects invalid date filters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/messages?from=04/07/2026",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns an empty ai-logs page when the table has no rows", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/ai-logs?handoffOnly=true&validationStatus=valid",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(parseBody<AiLogsResponse>(response)).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 25
    });
  });

  it("maps ai log rows and filters handoff-only", async () => {
    const insertAiLogSql = `
      INSERT INTO ai_logs (
        log_id, created_at, message_id, customer_wa, prompt_version, model, intent,
        confidence, validation_status, error_type, handoff_triggered, latency_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;
    await testDb.db.query(insertAiLogSql, [
      "log-old",
      "2026-07-02T04:00:00Z",
      "msg-111-5",
      "628111",
      "v3",
      "claude-haiku",
      "order",
      0.92,
      "valid",
      null,
      0,
      420
    ]);
    await testDb.db.query(insertAiLogSql, [
      "log-new",
      "2026-07-03T04:00:00Z",
      null,
      "628222",
      "v3",
      "claude-haiku",
      null,
      null,
      "failed",
      "schema_mismatch",
      1,
      850
    ]);

    const all = await app.inject({ method: "GET", url: "/api/ai-logs", headers: { cookie } });
    expect(all.statusCode).toBe(200);
    const allBody = parseBody<AiLogsResponse>(all);
    expect(allBody.total).toBe(2);
    expect(allBody.items[0]?.logId).toBe("log-new");
    expect(allBody.items[0]?.handoffTriggered).toBe(true);
    expect(allBody.items[0]?.latencyMs).toBe(850);
    expect(allBody.items[0]?.confidence).toBeNull();
    expect(allBody.items[1]?.logId).toBe("log-old");
    expect(allBody.items[1]?.handoffTriggered).toBe(false);
    expect(allBody.items[1]?.confidence).toBeCloseTo(0.92);

    const handoffOnly = await app.inject({
      method: "GET",
      url: "/api/ai-logs?handoffOnly=true",
      headers: { cookie }
    });
    const handoffBody = parseBody<AiLogsResponse>(handoffOnly);
    expect(handoffBody.total).toBe(1);
    expect(handoffBody.items[0]?.logId).toBe("log-new");

    const byValidation = await app.inject({
      method: "GET",
      url: "/api/ai-logs?validationStatus=valid",
      headers: { cookie }
    });
    const validBody = parseBody<AiLogsResponse>(byValidation);
    expect(validBody.total).toBe(1);
    expect(validBody.items[0]?.logId).toBe("log-old");
  });
});
