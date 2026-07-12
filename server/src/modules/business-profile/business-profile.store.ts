import type { Db } from "../../db/client.js";

// Restaurant facts the order bot answers customer questions from
// (bot migration 004). Per the db contract the dashboard may write
// profile_value + updated_at and may insert new keys; empty string means
// "not provided" and the bot deflects that topic to admin.
export interface BusinessProfileEntry {
  key: string;
  value: string;
  updatedAt: string;
}

interface BusinessProfileRow {
  profile_key: string;
  profile_value: string;
  updated_at: string;
}

export function createBusinessProfileStore(db: Db) {
  return {
    async listEntries(): Promise<BusinessProfileEntry[]> {
      const result = await db.query<BusinessProfileRow>(
        `SELECT profile_key, profile_value, updated_at
         FROM business_profile
         ORDER BY profile_key ASC`
      );
      return result.rows.map(mapRow);
    },

    // Upsert mirrors the bot's setProfileFact so both writers agree on
    // semantics; the contract allows the dashboard to add new keys.
    async setValue(key: string, value: string): Promise<BusinessProfileEntry> {
      const result = await db.query<BusinessProfileRow>(
        `INSERT INTO business_profile (profile_key, profile_value, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (profile_key) DO UPDATE
         SET profile_value = EXCLUDED.profile_value,
           updated_at = EXCLUDED.updated_at
         RETURNING profile_key, profile_value, updated_at`,
        [key, value.trim(), new Date().toISOString()]
      );

      const row = result.rows[0];

      if (!row) {
        throw new Error(`business_profile upsert returned no row for key ${key}`);
      }

      return mapRow(row);
    }
  };
}

export type BusinessProfileStore = ReturnType<typeof createBusinessProfileStore>;

function mapRow(row: BusinessProfileRow): BusinessProfileEntry {
  return {
    key: row.profile_key,
    value: row.profile_value,
    updatedAt: row.updated_at
  };
}
