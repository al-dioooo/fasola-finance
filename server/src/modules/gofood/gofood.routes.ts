import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { AppConfig } from "../../config/env.js";
import type { Db } from "../../db/client.js";
import { createGofoodBotClient, type GofoodCatalogSyncResult } from "./gofood-bot.client.js";
import {
  createGofoodConfigStore,
  createGofoodSyncRunStore,
  type GofoodPublicSettings,
  type GofoodSyncRun
} from "./gofood.store.js";

// GoFood control plane. The dashboard edits credentials (stored in the
// bot-owned gofood_settings table) and proxies status/test/subscribe to the
// bot's /internal/gofood/* endpoints. The client_secret is never echoed back.

export interface RegisterGofoodRoutesOptions {
  db: Db;
  config: AppConfig;
  fetchImpl?: typeof fetch;
}

interface GofoodSettingsResponse {
  settings: GofoodPublicSettings;
}

interface GofoodStatusResponse {
  botReachable: boolean;
  enabled: boolean;
  configured: boolean;
  environment: string;
  outletId: string;
  signatureVerification: boolean;
}

interface GofoodSyncLogResponse {
  items: GofoodSyncRun[];
}

const SYNC_LOG_LIMIT = 20;

const updateSettingsSchema = z
  .object({
    clientId: z.string().max(200).optional(),
    clientSecret: z.string().max(500).optional(),
    partnerId: z.string().max(200).optional(),
    outletId: z.string().max(200).optional(),
    enabled: z.boolean().optional(),
    environment: z.enum(["sandbox", "production"]).optional()
  })
  .strict();

const subscribeSchema = z.object({
  webhookUrl: z.string().url()
});

export function registerGofoodRoutes(
  app: FastifyInstance,
  options: RegisterGofoodRoutesOptions
): Promise<void> {
  const { db, config } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const configStore = createGofoodConfigStore(db);
  const syncRunStore = createGofoodSyncRunStore(db);
  const bot = createGofoodBotClient({
    baseUrl: config.BOT_BASE_URL,
    internalToken: config.BOT_INTERNAL_TOKEN,
    fetchImpl
  });

  app.get("/api/gofood/settings", async (): Promise<GofoodSettingsResponse> => {
    return { settings: await configStore.getPublicSettings() };
  });

  app.put("/api/gofood/settings", async (request, reply) => {
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Data pengaturan GoFood tidak valid" });
    }
    const settings = await configStore.updateSettings(parsed.data);
    const body: GofoodSettingsResponse = { settings };
    return reply.send(body);
  });

  // The bot being unreachable is an expected operational state the UI renders,
  // so this always answers 200 (mirrors /api/bot/status).
  app.get("/api/gofood/status", async (): Promise<GofoodStatusResponse> => {
    const status = await bot.getStatus();
    if (!status.ok) {
      return {
        botReachable: false,
        enabled: false,
        configured: false,
        environment: "sandbox",
        outletId: "",
        signatureVerification: false
      };
    }
    return { botReachable: true, ...status.value };
  });

  app.post("/api/gofood/test-connection", async (_request, reply) => {
    const result = await bot.testConnection();
    if (!result.ok) {
      return reply.status(502).send({ error: result.error });
    }
    return result.value;
  });

  app.post("/api/gofood/subscribe", async (request, reply) => {
    const parsed = subscribeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "URL webhook tidak valid" });
    }
    const result = await bot.subscribe(parsed.data.webhookUrl);
    if (!result.ok) {
      return reply.status(502).send({ error: result.error });
    }
    return result.value;
  });

  app.post("/api/gofood/sync-menu", async (_request, reply) => {
    const result = await bot.syncMenu();
    if (!result.ok) {
      return reply.status(502).send({ error: result.error });
    }

    const report = result.value;
    const errors = [
      ...report.excluded.map((issue) => ({ ...issue, kind: "excluded" as const })),
      ...report.warnings.map((issue) => ({ ...issue, kind: "warning" as const })),
      ...(report.error ? [{ kind: "error" as const, reason: report.error }] : [])
    ];

    await syncRunStore.recordRun({
      runId: nanoid(),
      status: report.status,
      itemsTotal: report.itemsTotal,
      itemsPushed: report.itemsPushed,
      errors,
      message: summarizeSyncReport(report)
    });

    return report;
  });

  app.get("/api/gofood/sync-log", async (): Promise<GofoodSyncLogResponse> => {
    return { items: await syncRunStore.listRuns(SYNC_LOG_LIMIT) };
  });

  return Promise.resolve();
}

function summarizeSyncReport(report: GofoodCatalogSyncResult): string {
  if (report.status === "not_configured") {
    return "Kredensial GoFood belum lengkap.";
  }
  if (report.status === "no_items") {
    return "Tidak ada menu yang bisa disinkronkan.";
  }
  if (report.status === "failed") {
    return report.error ? `Gagal: ${report.error}` : "Sinkronisasi gagal.";
  }
  return `${report.itemsPushed}/${report.itemsTotal} menu terkirim`;
}
