import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppConfig } from "../../config/env.js";
import type { Db } from "../../db/client.js";
import { createBusinessProfileStore } from "./business-profile.store.js";

// Keys are snake_case identifiers (opening_hours, store_address, ...); the
// value is free customer-facing text and may be empty ("not provided").
const profileParamsSchema = z.object({
  profileKey: z.string().regex(/^[a-z0-9_]+$/u)
});

const updateProfileBodySchema = z.object({
  value: z.string()
});

export interface RegisterBusinessProfileRoutesOptions {
  db: Db;
  config: AppConfig;
}

export function registerBusinessProfileRoutes(
  app: FastifyInstance,
  options: RegisterBusinessProfileRoutesOptions
): Promise<void> {
  const store = createBusinessProfileStore(options.db);

  app.get("/api/business-profile", async () => {
    const items = await store.listEntries();
    return { items };
  });

  app.put("/api/business-profile/:profileKey", async (request, reply) => {
    const params = profileParamsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({ error: "Kunci info usaha tidak valid" });
    }

    const parsed = updateProfileBodySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: "Data info usaha tidak valid" });
    }

    const item = await store.setValue(params.data.profileKey, parsed.data.value);
    return reply.send({ item });
  });

  return Promise.resolve();
}
