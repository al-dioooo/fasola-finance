import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppConfig } from "../../config/env.js";
import { destroySession, hasValidSession, issueSession, passwordMatches } from "./auth.session.js";

const loginBodySchema = z.object({
  password: z.string().min(1)
});

export interface RegisterAuthRoutesOptions {
  config: AppConfig;
}

// Not declared `async` (route registration is synchronous) but keeps the
// Promise<void> signature app.ts awaits.
export function registerAuthRoutes(
  app: FastifyInstance,
  options: RegisterAuthRoutesOptions
): Promise<void> {
  app.post(
    "/api/auth/login",
    {
      config: {
        // Brute-force guard on top of the global limiter.
        rateLimit: {
          max: 5,
          timeWindow: "1 minute"
        }
      }
    },
    async (request, reply) => {
      const parsed = loginBodySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({ error: "Password wajib diisi" });
      }

      if (!passwordMatches(parsed.data.password, options.config.ADMIN_PASSWORD)) {
        return reply.status(401).send({ error: "Password salah" });
      }

      issueSession(reply, options.config);
      return reply.send({ authenticated: true });
    }
  );

  app.post("/api/auth/logout", async (_request, reply) => {
    destroySession(reply);
    return reply.send({ authenticated: false });
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (!hasValidSession(request, options.config)) {
      return reply.status(401).send({ authenticated: false });
    }

    return reply.send({ authenticated: true });
  });

  return Promise.resolve();
}
