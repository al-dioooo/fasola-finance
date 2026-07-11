import type { FastifyInstance } from "fastify";

import { createApp } from "../../server/src/app.js";
import type { AppConfig } from "../../server/src/config/env.js";
import { loadEnv } from "../../server/src/config/env.js";
import type { Db } from "../../server/src/db/client.js";

export const TEST_ADMIN_PASSWORD = "test-admin-password";

export function buildTestConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  return loadEnv({
    NODE_ENV: "test",
    PORT: "3100",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgres://postgres@localhost:5432/fasola_finance_test",
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    SESSION_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    SESSION_TTL_DAYS: "30",
    GOWA_BASE_URL: "http://127.0.0.1:3001",
    GOWA_BASIC_AUTH_USER: "test-gowa-user",
    GOWA_BASIC_AUTH_PASSWORD: "test-gowa-password",
    BOT_BASE_URL: "http://127.0.0.1:3010",
    ...overrides
  });
}

export interface BuildTestAppOptions {
  db: Db;
  config?: AppConfig;
  fetchImpl?: typeof fetch;
}

export async function buildTestApp(options: BuildTestAppOptions): Promise<FastifyInstance> {
  const config = options.config ?? buildTestConfig();

  return createApp(config, {
    db: options.db,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
}

// Logs in via the real route and returns the session cookie header for
// authenticated app.inject() calls.
export async function loginAndGetCookie(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { password: TEST_ADMIN_PASSWORD }
  });

  if (response.statusCode !== 200) {
    throw new Error(`Test login failed with status ${response.statusCode}`);
  }

  const setCookie = response.headers["set-cookie"];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;

  if (!cookieHeader) {
    throw new Error("Test login returned no session cookie");
  }

  return cookieHeader.split(";")[0] ?? "";
}
