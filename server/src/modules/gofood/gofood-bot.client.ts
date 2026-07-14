import { z } from "zod";

// Thin client for the fasola-order-bot internal GoFood control endpoints
// (/internal/gofood/*), which are loopback-only and require a Bearer token.
// Mirrors bot-ops/gowa.client.ts: lenient parsing, timeouts, and a discriminated
// result so an unreachable bot is a renderable state, not a crash.

const DEFAULT_TIMEOUT_MS = 5000;

const statusSchema = z
  .object({
    enabled: z.boolean().optional(),
    configured: z.boolean().optional(),
    environment: z.string().optional(),
    outletId: z.string().optional(),
    signatureVerification: z.boolean().optional()
  })
  .passthrough();

const testConnectionSchema = z
  .object({
    ok: z.boolean().optional(),
    message: z.string().optional()
  })
  .passthrough();

const subscribeSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            event: z.string(),
            ok: z.boolean(),
            error: z.string().optional()
          })
          .passthrough()
      )
      .default([])
  })
  .passthrough();

const catalogItemIssueSchema = z
  .object({
    productId: z.string().optional(),
    name: z.string().optional(),
    reason: z.string().optional()
  })
  .passthrough();

const syncReportSchema = z
  .object({
    status: z.string().optional(),
    itemsTotal: z.number().optional(),
    itemsPushed: z.number().optional(),
    excluded: z.array(catalogItemIssueSchema).default([]),
    warnings: z.array(catalogItemIssueSchema).default([]),
    requestId: z.string().optional(),
    error: z.string().optional()
  })
  .passthrough();

export interface GofoodBotStatus {
  enabled: boolean;
  configured: boolean;
  environment: string;
  outletId: string;
  signatureVerification: boolean;
}

export interface GofoodTestConnectionResult {
  ok: boolean;
  message: string;
}

export interface GofoodSubscribeResult {
  results: { event: string; ok: boolean; error?: string }[];
}

export interface GofoodCatalogItemIssue {
  productId: string;
  name: string;
  reason: string;
}

export interface GofoodCatalogSyncResult {
  status: string;
  itemsTotal: number;
  itemsPushed: number;
  excluded: GofoodCatalogItemIssue[];
  warnings: GofoodCatalogItemIssue[];
  requestId?: string;
  error?: string;
}

export type GofoodBotResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface GofoodBotClientOptions {
  baseUrl: string;
  internalToken: string;
  fetchImpl?: typeof fetch;
}

export interface GofoodBotClient {
  getStatus(timeoutMs?: number): Promise<GofoodBotResult<GofoodBotStatus>>;
  testConnection(): Promise<GofoodBotResult<GofoodTestConnectionResult>>;
  subscribe(webhookUrl: string): Promise<GofoodBotResult<GofoodSubscribeResult>>;
  syncMenu(): Promise<GofoodBotResult<GofoodCatalogSyncResult>>;
}

const SYNC_TIMEOUT_MS = 30_000;

function normalizeIssues(
  issues: {
    productId?: string | undefined;
    name?: string | undefined;
    reason?: string | undefined;
  }[]
): GofoodCatalogItemIssue[] {
  return issues.map((issue) => ({
    productId: issue.productId ?? "",
    name: issue.name ?? "",
    reason: issue.reason ?? "unknown"
  }));
}

export function createGofoodBotClient(options: GofoodBotClientOptions): GofoodBotClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const authorization = `Bearer ${options.internalToken}`;

  async function requestJson(
    path: string,
    method: "GET" | "POST",
    timeoutMs: number,
    body?: unknown
  ): Promise<GofoodBotResult<unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = { authorization };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });

      if (!response.ok) {
        return { ok: false, error: `Bot responded with HTTP ${response.status}` };
      }

      try {
        const value: unknown = await response.json();
        return { ok: true, value };
      } catch {
        return { ok: false, error: "Bot returned a non-JSON response" };
      }
    } catch (error) {
      return { ok: false, error: describeFetchError(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getStatus(timeoutMs = DEFAULT_TIMEOUT_MS) {
      const result = await requestJson("/internal/gofood/status", "GET", timeoutMs);
      if (!result.ok) {
        return result;
      }
      const parsed = statusSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: "Unexpected bot status response" };
      }
      return {
        ok: true,
        value: {
          enabled: parsed.data.enabled ?? false,
          configured: parsed.data.configured ?? false,
          environment: parsed.data.environment ?? "sandbox",
          outletId: parsed.data.outletId ?? "",
          signatureVerification: parsed.data.signatureVerification ?? false
        }
      };
    },

    async testConnection() {
      const result = await requestJson(
        "/internal/gofood/test-connection",
        "POST",
        DEFAULT_TIMEOUT_MS,
        {}
      );
      if (!result.ok) {
        return result;
      }
      const parsed = testConnectionSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: "Unexpected bot test-connection response" };
      }
      return {
        ok: true,
        value: { ok: parsed.data.ok ?? false, message: parsed.data.message ?? "" }
      };
    },

    async subscribe(webhookUrl: string) {
      const result = await requestJson(
        "/internal/gofood/subscribe",
        "POST",
        DEFAULT_TIMEOUT_MS,
        { webhookUrl }
      );
      if (!result.ok) {
        return result;
      }
      const parsed = subscribeSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: "Unexpected bot subscribe response" };
      }
      // Normalize so `error` is omitted (not `undefined`) — required under
      // exactOptionalPropertyTypes.
      const results = parsed.data.results.map((entry) => ({
        event: entry.event,
        ok: entry.ok,
        ...(entry.error ? { error: entry.error } : {})
      }));
      return { ok: true, value: { results } };
    },

    async syncMenu() {
      const result = await requestJson("/internal/gofood/sync-catalog", "POST", SYNC_TIMEOUT_MS, {});
      if (!result.ok) {
        return result;
      }
      const parsed = syncReportSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: "Unexpected bot sync-catalog response" };
      }
      return {
        ok: true,
        value: {
          status: parsed.data.status ?? "failed",
          itemsTotal: parsed.data.itemsTotal ?? 0,
          itemsPushed: parsed.data.itemsPushed ?? 0,
          excluded: normalizeIssues(parsed.data.excluded),
          warnings: normalizeIssues(parsed.data.warnings),
          ...(parsed.data.requestId ? { requestId: parsed.data.requestId } : {}),
          ...(parsed.data.error ? { error: parsed.data.error } : {})
        }
      };
    }
  };
}

function describeFetchError(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "Bot request failed";
  }
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "AbortError" || name === "TimeoutError") {
    return "Bot request timed out";
  }
  return typeof message === "string" && message !== "" ? `Bot request failed: ${message}` : "Bot request failed";
}
