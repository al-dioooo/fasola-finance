import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions
} from "fastify";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AppConfig } from "./config/env.js";
import type { Db } from "./db/client.js";
import { buildAuthGuard } from "./modules/auth/auth.guard.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { registerBotOpsRoutes } from "./modules/bot-ops/bot-ops.routes.js";
import { registerBusinessProfileRoutes } from "./modules/business-profile/business-profile.routes.js";
import { registerExpenseRoutes } from "./modules/expenses/expense.routes.js";
import { buildLoggerOptions } from "./modules/logs/logger.js";
import { registerOrderRoutes } from "./modules/orders/order.routes.js";
import { registerProductRoutes } from "./modules/products/product.routes.js";
import { registerReportRoutes } from "./modules/reports/report.routes.js";
import { SERVICE_NAME } from "./shared/constants.js";

export interface AppDependencies {
  db: Db;
  fetchImpl?: typeof fetch;
}

export async function createApp(
  config: AppConfig,
  dependencies: AppDependencies
): Promise<FastifyInstance> {
  const options: FastifyServerOptions = {
    logger: buildLoggerOptions(config),
    // nginx terminates TLS and forwards X-Forwarded-For; trust it so the
    // login rate limit keys on the real client IP.
    trustProxy: true,
    genReqId: (request) => request.headers["x-request-id"]?.toString() ?? randomUUID()
  };

  const app: FastifyInstance = fastify(options);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Recharts and the QR data-URL image need these two relaxations.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        // Helmet defaults this directive on, which makes the browser
        // force-upgrade every subresource on the page to https — fatal on a
        // plain-HTTP origin (dev, or this process itself; nginx terminates
        // TLS in production, so upgrading here is never correct).
        upgradeInsecureRequests: null
      }
    },
    // Same reasoning: an app-level HSTS header on a plain-HTTP origin (e.g.
    // localhost/127.0.0.1 in dev) makes browsers force-upgrade every future
    // request to https and then fail outright, since nothing here serves TLS.
    hsts: false
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute"
  });
  await app.register(cookie, {
    secret: config.SESSION_SECRET
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "request failed");

    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;

    void reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal Server Error" : error.message
    });
  });

  app.get("/healthz", () => ({
    status: "ok",
    service: SERVICE_NAME
  }));

  await registerAuthRoutes(app, { config });

  // Every other /api route requires a valid session.
  await app.register(async (authenticated) => {
    authenticated.addHook("onRequest", buildAuthGuard(config));

    await registerOrderRoutes(authenticated, { db: dependencies.db, config });
    await registerReportRoutes(authenticated, { db: dependencies.db, config });
    await registerProductRoutes(authenticated, { db: dependencies.db, config });
    await registerBusinessProfileRoutes(authenticated, { db: dependencies.db, config });
    await registerExpenseRoutes(authenticated, { db: dependencies.db, config });
    await registerBotOpsRoutes(authenticated, {
      db: dependencies.db,
      config,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {})
    });
  });

  registerSpaServing(app);

  return app;
}

// In production the built SPA lives at dist/web next to dist/server; in dev
// Vite serves the frontend itself, so this quietly no-ops.
function registerSpaServing(app: FastifyInstance): void {
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), "../web");

  if (!existsSync(join(webRoot, "index.html"))) {
    return;
  }

  void app.register(fastifyStatic, {
    root: webRoot,
    index: "index.html"
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }

    return reply.status(404).send({ error: "Not Found" });
  });
}
