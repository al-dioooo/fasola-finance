import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "../../server/src/db/client.js";
import type {
  GofoodSettingsResponse,
  GofoodStatusResponse,
  GofoodSyncLogResponse,
  GofoodSyncResult,
  OrderDetailResponse,
  OrdersListResponse
} from "../../web/src/api/types.js";
import { buildTestApp, loginAndGetCookie } from "../helpers/app.js";
import { createMigratedTestDatabase, type TestDatabase } from "../helpers/db.js";

const STATUS_URL = "http://127.0.0.1:3010/internal/gofood/status";
const TEST_CONNECTION_URL = "http://127.0.0.1:3010/internal/gofood/test-connection";
const SYNC_CATALOG_URL = "http://127.0.0.1:3010/internal/gofood/sync-catalog";

type FetchParams = Parameters<typeof fetch>;
const fetchMock = vi.fn<(input: FetchParams[0], init?: FetchParams[1]) => Promise<Response>>();

function toUrlString(input: FetchParams[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function parseBody<T>(response: { body: string }): T {
  return JSON.parse(response.body) as T;
}

async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.query(
    `INSERT INTO gofood_settings (config_key, config_value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (config_key) DO UPDATE
       SET config_value = EXCLUDED.config_value, updated_at = EXCLUDED.updated_at`,
    [key, value, new Date().toISOString()]
  );
}

describe("GoFood API", () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    fetchMock.mockReset();
    testDb = await createMigratedTestDatabase();
    app = await buildTestApp({ db: testDb.db, fetchImpl: fetchMock });
    cookie = await loginAndGetCookie(app);
  });

  afterEach(async () => {
    await app.close();
    await testDb.close();
  });

  it("requires authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/api/gofood/settings" });
    expect(response.statusCode).toBe(401);
  });

  it("never returns the client secret, only whether one is set + last 4", async () => {
    await setSetting(testDb.db, "client_id", "APPID");
    await setSetting(testDb.db, "client_secret", "supersecret1234");

    const response = await app.inject({
      method: "GET",
      url: "/api/gofood/settings",
      headers: { cookie }
    });
    expect(response.statusCode).toBe(200);
    const body = parseBody<GofoodSettingsResponse>(response);
    expect(body.settings.clientId).toBe("APPID");
    expect(body.settings.secretSet).toBe(true);
    expect(body.settings.secretLast4).toBe("1234");
    expect(JSON.stringify(body)).not.toContain("supersecret1234");
  });

  it("keeps the existing secret when PUT omits it, and replaces it when provided", async () => {
    await setSetting(testDb.db, "client_secret", "originalsecret9999");

    const keepResponse = await app.inject({
      method: "PUT",
      url: "/api/gofood/settings",
      headers: { cookie },
      payload: { clientId: "APP2", enabled: true }
    });
    expect(keepResponse.statusCode).toBe(200);
    const kept = parseBody<GofoodSettingsResponse>(keepResponse);
    expect(kept.settings.clientId).toBe("APP2");
    expect(kept.settings.enabled).toBe(true);
    expect(kept.settings.secretLast4).toBe("9999");

    const replaceResponse = await app.inject({
      method: "PUT",
      url: "/api/gofood/settings",
      headers: { cookie },
      payload: { clientSecret: "brandnewsecret5555" }
    });
    const replaced = parseBody<GofoodSettingsResponse>(replaceResponse);
    expect(replaced.settings.secretLast4).toBe("5555");
  });

  it("returns 200 with botReachable=false when the bot is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));

    const response = await app.inject({ method: "GET", url: "/api/gofood/status", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const body = parseBody<GofoodStatusResponse>(response);
    expect(body.botReachable).toBe(false);
  });

  it("reflects the bot status when reachable", async () => {
    fetchMock.mockImplementation((input) => {
      if (toUrlString(input) === STATUS_URL) {
        return Promise.resolve(
          jsonResponse({
            enabled: true,
            configured: true,
            environment: "sandbox",
            outletId: "M1",
            signatureVerification: false
          })
        );
      }
      return Promise.resolve(jsonResponse({}, 404));
    });

    const response = await app.inject({ method: "GET", url: "/api/gofood/status", headers: { cookie } });
    const body = parseBody<GofoodStatusResponse>(response);
    expect(body).toMatchObject({ botReachable: true, enabled: true, configured: true, outletId: "M1" });
  });

  it("sends the internal Bearer token and 502s when test-connection fails", async () => {
    fetchMock.mockImplementation((input) => {
      if (toUrlString(input) === TEST_CONNECTION_URL) {
        return Promise.resolve(jsonResponse({ error: "boom" }, 500));
      }
      return Promise.resolve(jsonResponse({}, 404));
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/gofood/test-connection",
      headers: { cookie }
    });
    expect(response.statusCode).toBe(502);
    const init = fetchMock.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer ");
  });

  it("returns an empty sync log initially", async () => {
    const response = await app.inject({ method: "GET", url: "/api/gofood/sync-log", headers: { cookie } });
    const body = parseBody<GofoodSyncLogResponse>(response);
    expect(body.items).toEqual([]);
  });

  it("proxies sync-menu to the bot and records a run", async () => {
    fetchMock.mockImplementation((input) => {
      if (toUrlString(input) === SYNC_CATALOG_URL) {
        return Promise.resolve(
          jsonResponse({
            status: "partial",
            itemsTotal: 3,
            itemsPushed: 2,
            excluded: [{ productId: "PRD-003", name: "X", reason: "missing_price" }],
            warnings: [],
            requestId: "req-1"
          })
        );
      }
      return Promise.resolve(jsonResponse({}, 404));
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/gofood/sync-menu",
      headers: { cookie }
    });
    expect(response.statusCode).toBe(200);
    const report = parseBody<GofoodSyncResult>(response);
    expect(report).toMatchObject({ status: "partial", itemsPushed: 2 });

    const log = await app.inject({ method: "GET", url: "/api/gofood/sync-log", headers: { cookie } });
    const logBody = parseBody<GofoodSyncLogResponse>(log);
    expect(logBody.items).toHaveLength(1);
    expect(logBody.items[0]).toMatchObject({ status: "partial", itemsPushed: 2, itemsTotal: 3 });
  });

  it("502s sync-menu when the bot is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));
    const response = await app.inject({
      method: "POST",
      url: "/api/gofood/sync-menu",
      headers: { cookie }
    });
    expect(response.statusCode).toBe(502);
  });
});

describe("GoFood orders surfacing", () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    testDb = await createMigratedTestDatabase();
    app = await buildTestApp({ db: testDb.db });
    cookie = await loginAndGetCookie(app);

    await testDb.db.query(
      `INSERT INTO orders (
         order_id, created_at, updated_at, customer_wa, customer_name, products_text,
         products_json, total_quantity, estimated_subtotal, address, payment_method,
         payment_status, order_status, source, external_order_number, gofood_pin, outlet_id
       ) VALUES (
         'GFO-1', '2026-07-14T10:00:00+07:00', '2026-07-14T10:00:00+07:00', 'gofood:CUST1', 'Jane',
         'Iced Coffee x1', '[{"productId":"PRD-001","name":"Iced Coffee","quantity":1,"unitPrice":20000}]',
         1, 20000, 'GoFood delivery (Gojek)', 'gofood', 'Unpaid', 'Confirmed', 'gofood',
         'F-1', '8832', 'M1'
       )`
    );
    await testDb.db.query(
      `INSERT INTO orders (
         order_id, created_at, updated_at, customer_wa, customer_name, products_text,
         products_json, total_quantity, estimated_subtotal, address, payment_method,
         payment_status, order_status, source
       ) VALUES (
         'ORD-1', '2026-07-14T09:00:00+07:00', '2026-07-14T09:00:00+07:00', '+620000000001', 'Budi',
         'Nasi Box x2', '[{"productId":"PRD-002","name":"Nasi Box","quantity":2,"unitPrice":30000}]',
         2, 60000, 'Jl. Contoh 1', 'cash', 'Unpaid', 'Confirmed', 'whatsapp'
       )`
    );
  });

  afterEach(async () => {
    await app.close();
    await testDb.close();
  });

  it("filters the order list by source and carries source in the DTO", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/orders?source=gofood",
      headers: { cookie }
    });
    const body = parseBody<OrdersListResponse>(response);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ orderId: "GFO-1", source: "gofood" });
  });

  it("exposes GoFood detail fields on the order", async () => {
    const response = await app.inject({ method: "GET", url: "/api/orders/GFO-1", headers: { cookie } });
    const body = parseBody<OrderDetailResponse>(response);
    expect(body.order).toMatchObject({
      source: "gofood",
      channelOrderNumber: "F-1",
      pickupPin: "8832",
      outletId: "M1"
    });
  });

  it("leaves GoFood detail fields null for WhatsApp orders", async () => {
    const response = await app.inject({ method: "GET", url: "/api/orders/ORD-1", headers: { cookie } });
    const body = parseBody<OrderDetailResponse>(response);
    expect(body.order).toMatchObject({
      source: "whatsapp",
      channelOrderNumber: null,
      pickupPin: null,
      outletId: null
    });
  });
});
