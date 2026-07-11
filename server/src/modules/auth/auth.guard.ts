import type { FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../../config/env.js";
import { hasValidSession } from "./auth.session.js";

export function buildAuthGuard(config: Pick<AppConfig, "SESSION_TTL_DAYS">) {
  return async function authGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!hasValidSession(request, config)) {
      await reply.status(401).send({ error: "Belum login" });
    }
  };
}
