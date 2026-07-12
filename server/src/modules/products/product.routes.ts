import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppConfig } from "../../config/env.js";
import type { Db } from "../../db/client.js";
import { stockStatusSchema } from "../../shared/enums.js";
import { createProductStore } from "./product.store.js";

// Bodies per web/src/api/types.ts Product. There is deliberately no DELETE:
// the bot reads this table as its live menu, so removal is stockStatus
// "Hidden" via PATCH.
const createProductBodySchema = z.object({
  productName: z.string().trim().min(1),
  price: z.number().int().positive(),
  stockStatus: stockStatusSchema,
  category: z.string().nullable().optional(),
  aliases: z.array(z.string()).optional(),
  variants: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  description: z.string().nullable().optional()
});

const updateProductBodySchema = z.object({
  productName: z.string().trim().min(1).optional(),
  price: z.number().int().positive().optional(),
  stockStatus: stockStatusSchema.optional(),
  category: z.string().nullable().optional(),
  aliases: z.array(z.string()).optional(),
  variants: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  description: z.string().nullable().optional()
});

const productParamsSchema = z.object({
  productId: z.string().min(1)
});

export interface RegisterProductRoutesOptions {
  db: Db;
  config: AppConfig;
}

// Not declared `async` (nothing to await — route registration is synchronous)
// but keeps the Promise<void> signature app.ts awaits.
export function registerProductRoutes(
  app: FastifyInstance,
  options: RegisterProductRoutesOptions
): Promise<void> {
  const store = createProductStore(options.db);

  app.get("/api/products", async () => {
    const [items, pendingMenuChanges] = await Promise.all([
      store.listProducts(),
      store.countPendingMenuChanges()
    ]);

    return { items, pendingMenuChanges };
  });

  app.post("/api/products", async (request, reply) => {
    const parsed = createProductBodySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: "Data produk tidak valid" });
    }

    const result = await store.createProduct(parsed.data);

    if (result.status === "duplicate_name") {
      return reply.status(409).send({ error: "Nama produk sudah dipakai" });
    }

    return reply.status(201).send({ product: result.product });
  });

  app.patch("/api/products/:productId", async (request, reply) => {
    const params = productParamsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({ error: "ID produk tidak valid" });
    }

    const parsed = updateProductBodySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: "Data produk tidak valid" });
    }

    const result = await store.updateProduct(params.data.productId, parsed.data);

    if (result.status === "not_found") {
      return reply.status(404).send({ error: "Produk tidak ditemukan" });
    }

    if (result.status === "duplicate_name") {
      return reply.status(409).send({ error: "Nama produk sudah dipakai" });
    }

    return reply.send({ product: result.product });
  });

  return Promise.resolve();
}
