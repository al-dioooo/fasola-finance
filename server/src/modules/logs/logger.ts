import type { FastifyServerOptions } from "fastify";

import type { AppConfig } from "../../config/env.js";

type FastifyLoggerConfig = NonNullable<FastifyServerOptions["logger"]>;

export function buildLoggerOptions(config: Pick<AppConfig, "LOG_LEVEL">): FastifyLoggerConfig {
  return {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "ADMIN_PASSWORD",
        "SESSION_SECRET",
        "GOWA_BASIC_AUTH_PASSWORD",
        "*.ADMIN_PASSWORD",
        "*.SESSION_SECRET",
        "*.GOWA_BASIC_AUTH_PASSWORD"
      ],
      censor: "[redacted]"
    }
  };
}
