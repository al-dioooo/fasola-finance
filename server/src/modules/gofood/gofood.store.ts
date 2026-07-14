import type { Db } from "../../db/client.js";

// Two concerns, two stores:
//  - GofoodConfigStore writes the bot-owned `gofood_settings` table (like
//    business-profile.store.ts writes business_profile). The bot reads it for
//    OAuth/webhooks. The client_secret is never returned to the browser.
//  - GofoodSyncRunStore owns the dashboard's `fin_gofood_sync_runs` history.

export type GofoodEnvironment = "sandbox" | "production";

export interface GofoodPublicSettings {
  clientId: string;
  partnerId: string;
  outletId: string;
  enabled: boolean;
  environment: GofoodEnvironment;
  secretSet: boolean;
  secretLast4: string | null;
  updatedAt: string | null;
}

export interface GofoodSettingsPatch {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  partnerId?: string | undefined;
  outletId?: string | undefined;
  enabled?: boolean | undefined;
  environment?: GofoodEnvironment | undefined;
}

interface GofoodSettingRow {
  config_key: string;
  config_value: string;
  updated_at: string;
}

export function createGofoodConfigStore(db: Db) {
  return {
    async getPublicSettings(): Promise<GofoodPublicSettings> {
      const result = await db.query<GofoodSettingRow>(
        "SELECT config_key, config_value, updated_at FROM gofood_settings"
      );
      const map = new Map(result.rows.map((row) => [row.config_key, row.config_value]));
      const secret = map.get("client_secret") ?? "";
      const updatedValues = result.rows
        .map((row) => row.updated_at)
        .filter((value): value is string => Boolean(value))
        .sort();
      const updatedAt = updatedValues[updatedValues.length - 1] ?? null;

      return {
        clientId: map.get("client_id") ?? "",
        partnerId: map.get("partner_id") ?? "",
        outletId: map.get("outlet_id") ?? "",
        enabled: (map.get("enabled") ?? "false") === "true",
        environment: map.get("environment") === "production" ? "production" : "sandbox",
        secretSet: secret.length > 0,
        secretLast4: secret.length >= 4 ? secret.slice(-4) : null,
        updatedAt
      };
    },

    // Upserts only the provided keys. The secret is written only when a
    // non-empty value is supplied (a blank field means "keep existing").
    async updateSettings(patch: GofoodSettingsPatch): Promise<GofoodPublicSettings> {
      const now = new Date().toISOString();
      const entries: [string, string][] = [];

      if (patch.clientId !== undefined) entries.push(["client_id", patch.clientId.trim()]);
      if (patch.partnerId !== undefined) entries.push(["partner_id", patch.partnerId.trim()]);
      if (patch.outletId !== undefined) entries.push(["outlet_id", patch.outletId.trim()]);
      if (patch.enabled !== undefined) entries.push(["enabled", patch.enabled ? "true" : "false"]);
      if (patch.environment !== undefined) entries.push(["environment", patch.environment]);
      if (patch.clientSecret !== undefined && patch.clientSecret.trim().length > 0) {
        entries.push(["client_secret", patch.clientSecret.trim()]);
      }

      for (const [key, value] of entries) {
        await db.query(
          `INSERT INTO gofood_settings (config_key, config_value, updated_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (config_key) DO UPDATE
           SET config_value = EXCLUDED.config_value,
             updated_at = EXCLUDED.updated_at`,
          [key, value, now]
        );
      }

      return this.getPublicSettings();
    }
  };
}

export type GofoodConfigStore = ReturnType<typeof createGofoodConfigStore>;

export interface GofoodSyncRun {
  runId: string;
  startedAt: string;
  status: string;
  itemsTotal: number | null;
  itemsPushed: number | null;
  errors: unknown[];
  message: string | null;
}

interface GofoodSyncRunRow {
  run_id: string;
  started_at: string;
  status: string;
  items_total: number | null;
  items_pushed: number | null;
  errors_json: unknown;
  message: string | null;
}

export interface RecordSyncRunInput {
  runId: string;
  status: string;
  itemsTotal: number | null;
  itemsPushed: number | null;
  errors: unknown[];
  message: string | null;
}

export function createGofoodSyncRunStore(db: Db) {
  return {
    async listRuns(limit: number): Promise<GofoodSyncRun[]> {
      const result = await db.query<GofoodSyncRunRow>(
        `SELECT run_id, started_at::text AS started_at, status, items_total, items_pushed,
                errors_json, message
         FROM fin_gofood_sync_runs
         ORDER BY started_at DESC
         LIMIT $1`,
        [limit]
      );
      return result.rows.map(mapSyncRunRow);
    },

    async recordRun(input: RecordSyncRunInput): Promise<void> {
      await db.query(
        `INSERT INTO fin_gofood_sync_runs
           (run_id, status, items_total, items_pushed, errors_json, message)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          input.runId,
          input.status,
          input.itemsTotal,
          input.itemsPushed,
          JSON.stringify(input.errors),
          input.message
        ]
      );
    }
  };
}

export type GofoodSyncRunStore = ReturnType<typeof createGofoodSyncRunStore>;

function mapSyncRunRow(row: GofoodSyncRunRow): GofoodSyncRun {
  return {
    runId: row.run_id,
    startedAt: row.started_at,
    status: row.status,
    itemsTotal: row.items_total,
    itemsPushed: row.items_pushed,
    errors: Array.isArray(row.errors_json) ? row.errors_json : [],
    message: row.message
  };
}
