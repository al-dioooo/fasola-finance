import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppConfig } from "../../config/env.js";
import type { Db } from "../../db/client.js";
import { isBusinessDate, jakartaDateRangeToUtc } from "../../shared/dates.js";
import { orderStatusSchema, paymentStatusSchema } from "../../shared/enums.js";
import { paginationOffset, paginationSchema } from "../../shared/pagination.js";
import {
  orderStatusSourcesFor,
  orderStatusTransitions,
  paymentStatusSourcesFor,
  paymentStatusTransitions
} from "./order-transitions.js";
import type { OrderDetail } from "./order.store.js";
import { createOrderStore } from "./order.store.js";

const businessDateSchema = z
  .string()
  .refine(isBusinessDate, "Tanggal harus berformat YYYY-MM-DD");

const listQuerySchema = paginationSchema.extend({
  status: z
    .union([orderStatusSchema, z.array(orderStatusSchema)])
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }
      return Array.isArray(value) ? value : [value];
    }),
  paymentStatus: paymentStatusSchema.optional(),
  source: z.enum(["whatsapp", "gofood"]).optional(),
  q: z.string().trim().min(1).optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional()
});

const orderParamsSchema = z.object({
  orderId: z.string().min(1)
});

const statusBodySchema = z.object({
  orderStatus: orderStatusSchema,
  expectedUpdatedAt: z.string().min(1)
});

const paymentBodySchema = z.object({
  paymentStatus: paymentStatusSchema,
  expectedUpdatedAt: z.string().min(1)
});

function detailResponse(order: OrderDetail) {
  return {
    order,
    allowedStatusTransitions: orderStatusTransitions[order.orderStatus],
    allowedPaymentTransitions: paymentStatusTransitions[order.paymentStatus]
  };
}

export interface RegisterOrderRoutesOptions {
  db: Db;
  config: AppConfig;
}

export function registerOrderRoutes(
  app: FastifyInstance,
  options: RegisterOrderRoutesOptions
): Promise<void> {
  const store = createOrderStore(options.db);

  app.get("/api/orders", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({ error: "Parameter pencarian tidak valid" });
    }

    const { status, paymentStatus, source, q, from, to, page, limit } = parsed.data;

    const result = await store.listOrders({
      ...(status && status.length > 0 ? { statuses: status } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(source ? { source } : {}),
      ...(q ? { q } : {}),
      // Business dates are Jakarta calendar days; created_at is compared as
      // UTC instants ([from 00:00, to+1 00:00) Jakarta).
      ...(from ? { createdFromUtc: jakartaDateRangeToUtc(from, from).fromUtc } : {}),
      ...(to ? { createdToUtc: jakartaDateRangeToUtc(to, to).toUtc } : {}),
      limit,
      offset: paginationOffset({ page, limit })
    });

    return reply.send({
      items: result.items,
      total: result.total,
      page,
      limit
    });
  });

  app.get("/api/orders/:orderId", async (request, reply) => {
    const params = orderParamsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({ error: "Parameter tidak valid" });
    }

    const order = await store.getOrder(params.data.orderId);

    if (!order) {
      return reply.status(404).send({ error: "Pesanan tidak ditemukan" });
    }

    return reply.send(detailResponse(order));
  });

  app.patch("/api/orders/:orderId/status", async (request, reply) => {
    const params = orderParamsSchema.safeParse(request.params);
    const body = statusBodySchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "Data perubahan status tidak valid" });
    }

    const updated = await store.updateOrderStatus({
      orderId: params.data.orderId,
      orderStatus: body.data.orderStatus,
      expectedUpdatedAt: body.data.expectedUpdatedAt,
      allowedSourceStatuses: orderStatusSourcesFor(body.data.orderStatus)
    });

    if (updated) {
      return reply.send(detailResponse(updated));
    }

    // The compare-and-swap matched no row: work out why from a fresh read.
    const fresh = await store.getOrder(params.data.orderId);

    if (!fresh) {
      return reply.status(404).send({ error: "Pesanan tidak ditemukan" });
    }

    if (fresh.updatedAt !== body.data.expectedUpdatedAt) {
      return reply.status(409).send({ error: "Data pesanan berubah", order: fresh });
    }

    return reply.status(422).send({
      error: "Perubahan status tidak diizinkan",
      allowed: orderStatusTransitions[fresh.orderStatus]
    });
  });

  app.patch("/api/orders/:orderId/payment", async (request, reply) => {
    const params = orderParamsSchema.safeParse(request.params);
    const body = paymentBodySchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "Data perubahan pembayaran tidak valid" });
    }

    const updated = await store.updatePaymentStatus({
      orderId: params.data.orderId,
      paymentStatus: body.data.paymentStatus,
      expectedUpdatedAt: body.data.expectedUpdatedAt,
      allowedSourceStatuses: paymentStatusSourcesFor(body.data.paymentStatus)
    });

    if (updated) {
      return reply.send(detailResponse(updated));
    }

    const fresh = await store.getOrder(params.data.orderId);

    if (!fresh) {
      return reply.status(404).send({ error: "Pesanan tidak ditemukan" });
    }

    if (fresh.updatedAt !== body.data.expectedUpdatedAt) {
      return reply.status(409).send({ error: "Data pesanan berubah", order: fresh });
    }

    return reply.status(422).send({
      error: "Perubahan status pembayaran tidak diizinkan",
      allowed: paymentStatusTransitions[fresh.paymentStatus]
    });
  });

  return Promise.resolve();
}
