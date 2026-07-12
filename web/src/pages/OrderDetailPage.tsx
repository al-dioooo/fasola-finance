import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Link, useParams } from "react-router";

import { api, ApiError } from "../api/client";
import type {
  OrderDetail,
  OrderDetailResponse,
  OrderItem,
  OrderStatus,
  OrderUpdateResponse,
  PaymentStatus
} from "../api/types";
import { Rise, StaggerItem, StaggerList } from "../components/motion/primitives";
import {
  Button,
  Card,
  CardTitle,
  ErrorNote,
  OrderStatusBadge,
  PaymentStatusBadge,
  SkeletonCard
} from "../components/ui";
import { formatDateTimeJakarta, formatIDR } from "../lib/format";
import { orderStatusLabels, paymentStatusLabels } from "../lib/labels";

type TransitionVariant = "primary" | "secondary" | "dangerOutline";

// Forward moves along the order flow read as primary; Cancelled is the
// destructive path; sideways moves (help/info) stay quiet.
function orderTransitionVariant(next: OrderStatus): TransitionVariant {
  if (next === "Cancelled") {
    return "dangerOutline";
  }
  if (next === "Need Admin Help" || next === "Need Info") {
    return "secondary";
  }
  return "primary";
}

function paymentTransitionVariant(next: PaymentStatus): TransitionVariant {
  if (next === "Cancelled") {
    return "dangerOutline";
  }
  return next === "Paid" ? "primary" : "secondary";
}

const MICRO_LABEL_CLASSES = "text-xs font-semibold tracking-wide text-ink-400 uppercase";

// Anchor styled like Button variant="secondary" — a real link so the chat
// opens in WhatsApp with proper href semantics.
function WhatsAppChatLink({ customerWa }: { customerWa: string }) {
  return (
    <motion.a
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      href={`https://wa.me/${customerWa.replace(/\D/g, "")}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center justify-center gap-2 rounded-full border border-cream-300 bg-cream-50 px-4 py-2.5 text-sm font-semibold text-ink-900 shadow-card transition-colors hover:border-pandan-300 hover:bg-pandan-50"
    >
      Chat WhatsApp
    </motion.a>
  );
}

function OrderHeaderCard({ order }: { order: OrderDetail }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-pandan-900 sm:text-2xl">
            {order.orderId}
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Dibuat {formatDateTimeJakarta(order.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <OrderStatusBadge status={order.orderStatus} />
          <PaymentStatusBadge status={order.paymentStatus} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-cream-200 pt-3.5">
        <div>
          <p className="text-sm font-semibold text-ink-900">
            {order.customerName ?? order.customerWa}
          </p>
          <p className="text-xs text-ink-500 tabular-nums">{order.customerWa}</p>
        </div>
        <WhatsAppChatLink customerWa={order.customerWa} />
      </div>
    </Card>
  );
}

function OrderItemsTable({
  items,
  estimatedSubtotal
}: {
  items: OrderItem[];
  estimatedSubtotal: number | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-cream-300 text-left">
            <th className={`py-2 pr-2 ${MICRO_LABEL_CLASSES}`}>Produk</th>
            <th className={`py-2 pr-2 text-right ${MICRO_LABEL_CLASSES}`}>Jml</th>
            <th className={`py-2 pr-2 text-right ${MICRO_LABEL_CLASSES}`}>Harga Satuan</th>
            <th className={`py-2 text-right ${MICRO_LABEL_CLASSES}`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={`${item.productId}-${index}`} className="border-b border-cream-200">
              <td className="py-2.5 pr-2">
                <span className="font-medium text-ink-900">{item.name}</span>
                {item.variant ? (
                  <span className="text-xs text-ink-500"> ({item.variant})</span>
                ) : null}
                {item.notes ? <p className="text-xs text-ink-500">{item.notes}</p> : null}
              </td>
              <td className="py-2.5 pr-2 text-right text-ink-700 tabular-nums">
                {item.quantity}
              </td>
              <td className="py-2.5 pr-2 text-right whitespace-nowrap text-ink-700 tabular-nums">
                {item.unitPrice === null ? "—" : formatIDR(item.unitPrice)}
              </td>
              <td className="py-2.5 text-right whitespace-nowrap text-ink-900 tabular-nums">
                {item.unitPrice === null ? "—" : formatIDR(item.unitPrice * item.quantity)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className={`pt-3 pr-2 text-right ${MICRO_LABEL_CLASSES}`}>
              Subtotal Estimasi
            </td>
            <td className="pt-3 text-right font-display text-base font-semibold whitespace-nowrap text-pandan-900 tabular-nums">
              {formatIDR(estimatedSubtotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function InfoRow({
  label,
  value,
  preWrap = false
}: {
  label: string;
  value: string;
  preWrap?: boolean;
}) {
  return (
    <div>
      <dt className={MICRO_LABEL_CLASSES}>{label}</dt>
      <dd className={`mt-0.5 text-sm text-ink-700 ${preWrap ? "whitespace-pre-wrap" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function TransitionButtons<TStatus extends string>({
  label,
  transitions,
  emptyMessage,
  disabled,
  variantFor,
  buttonLabel,
  onSelect
}: {
  label: string;
  transitions: readonly TStatus[];
  emptyMessage: string;
  disabled: boolean;
  variantFor: (next: TStatus) => TransitionVariant;
  buttonLabel: (next: TStatus) => string;
  onSelect: (next: TStatus) => void;
}) {
  return (
    <div>
      <p className={MICRO_LABEL_CLASSES}>{label}</p>
      {transitions.length === 0 ? (
        <p className="mt-1.5 text-sm text-ink-500">{emptyMessage}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {transitions.map((next) => (
            <Button
              key={next}
              variant={variantFor(next)}
              disabled={disabled}
              onClick={() => onSelect(next)}
            >
              {buttonLabel(next)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function RawDataSection({ order }: { order: OrderDetail }) {
  return (
    <details className="rounded-card border border-cream-200 bg-cream-50 shadow-card">
      <summary className="cursor-pointer px-4 py-3.5 font-display text-base font-semibold text-ink-900 select-none sm:px-5">
        Data Mentah &amp; AI
      </summary>
      <div className="space-y-4 border-t border-cream-200 px-4 py-4 text-sm sm:px-5">
        <div>
          <p className={MICRO_LABEL_CLASSES}>Pesan Asli</p>
          {order.rawMessage ? (
            <pre className="mt-1.5 rounded-xl bg-cream-100 p-3 text-xs whitespace-pre-wrap text-ink-700">
              {order.rawMessage}
            </pre>
          ) : (
            <p className="mt-0.5 text-ink-700">—</p>
          )}
        </div>
        <div>
          <p className={MICRO_LABEL_CLASSES}>Model AI</p>
          <p className="mt-0.5 text-ink-700">{order.aiModel ?? "—"}</p>
        </div>
        <div>
          <p className={MICRO_LABEL_CLASSES}>Keyakinan AI</p>
          <p className="mt-0.5 text-ink-700 tabular-nums">
            {order.aiConfidence === null ? "—" : `${Math.round(order.aiConfidence * 100)}%`}
          </p>
        </div>
      </div>
    </details>
  );
}

export function OrderDetailPage() {
  const params = useParams();
  const orderId = params.orderId ?? "";
  const queryClient = useQueryClient();
  const queryKey = ["orders", "detail", orderId];

  const [mutationError, setMutationError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey,
    queryFn: () => api<OrderDetailResponse>(`/api/orders/${encodeURIComponent(orderId)}`),
    enabled: orderId !== ""
  });

  async function handleMutationError(error: Error): Promise<void> {
    if (error instanceof ApiError && error.status === 409) {
      setMutationError("Data berubah, dimuat ulang");
      await queryClient.invalidateQueries({ queryKey });
      return;
    }
    if (error instanceof ApiError && error.status === 422) {
      setMutationError(error.message);
      return;
    }
    setMutationError("Gagal menyimpan perubahan. Coba lagi.");
  }

  function handleMutationSuccess(data: OrderUpdateResponse): void {
    setMutationError(null);
    queryClient.setQueryData<OrderDetailResponse>(queryKey, data);
  }

  const statusMutation = useMutation({
    mutationFn: (input: { orderStatus: OrderStatus; expectedUpdatedAt: string }) =>
      api<OrderUpdateResponse>(`/api/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        body: input
      }),
    onSuccess: handleMutationSuccess,
    onError: handleMutationError
  });

  const paymentMutation = useMutation({
    mutationFn: (input: { paymentStatus: PaymentStatus; expectedUpdatedAt: string }) =>
      api<OrderUpdateResponse>(`/api/orders/${encodeURIComponent(orderId)}/payment`, {
        method: "PATCH",
        body: input
      }),
    onSuccess: handleMutationSuccess,
    onError: handleMutationError
  });

  const busy = statusMutation.isPending || paymentMutation.isPending;
  // Const binding so TS narrowing survives into the onClick closures below.
  const data = detail.data;

  return (
    <div className="space-y-4">
      <Rise>
        <Link
          to="/orders"
          className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-pandan-700 hover:text-pandan-600 hover:underline"
        >
          &larr; Kembali ke Pesanan
        </Link>
      </Rise>

      {orderId === "" ? (
        <Rise>
          <ErrorNote message="Pesanan tidak ditemukan." />
        </Rise>
      ) : null}

      {orderId !== "" && detail.isPending ? (
        <Rise>
          <div className="space-y-4">
            <SkeletonCard lines={3} />
            <SkeletonCard lines={5} />
          </div>
        </Rise>
      ) : null}

      {detail.isError ? (
        <Rise>
          <ErrorNote
            message={
              detail.error instanceof ApiError && detail.error.status === 404
                ? "Pesanan tidak ditemukan."
                : "Gagal memuat detail pesanan."
            }
          />
        </Rise>
      ) : null}

      {data ? (
        <StaggerList className="space-y-4">
          <StaggerItem>
            <OrderHeaderCard order={data.order} />
          </StaggerItem>

          <StaggerItem>
            <Card>
              <CardTitle>Item Pesanan</CardTitle>
              <div className="mt-3">
                <OrderItemsTable
                  items={data.order.products}
                  estimatedSubtotal={data.order.estimatedSubtotal}
                />
              </div>
            </Card>
          </StaggerItem>

          <StaggerItem>
            <Card>
              <CardTitle>Info Pesanan</CardTitle>
              <dl className="mt-3 space-y-3.5">
                <InfoRow label="Alamat" value={data.order.address || "—"} preWrap />
                <InfoRow label="Catatan" value={data.order.notes ?? "—"} preWrap />
                <InfoRow label="Waktu Diminta" value={data.order.requestedTime ?? "—"} />
                <InfoRow label="Metode Pembayaran" value={data.order.paymentMethod || "—"} />
              </dl>
            </Card>
          </StaggerItem>

          <StaggerItem>
            <Card>
              <CardTitle>Ubah Status</CardTitle>

              <AnimatePresence initial={false}>
                {mutationError ? (
                  <motion.div
                    key="mutation-error"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-3">
                      <ErrorNote message={mutationError} />
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <div className="mt-4 space-y-5">
                <TransitionButtons
                  label="Status Pesanan"
                  transitions={data.allowedStatusTransitions}
                  emptyMessage="Tidak ada perubahan status yang tersedia."
                  disabled={busy}
                  variantFor={orderTransitionVariant}
                  buttonLabel={(next) => `Ubah ke: ${orderStatusLabels[next]}`}
                  onSelect={(next) => {
                    if (next === "Cancelled" && !window.confirm("Batalkan pesanan ini?")) {
                      return;
                    }
                    setMutationError(null);
                    statusMutation.mutate({
                      orderStatus: next,
                      expectedUpdatedAt: data.order.updatedAt
                    });
                  }}
                />

                <TransitionButtons
                  label="Status Pembayaran"
                  transitions={data.allowedPaymentTransitions}
                  emptyMessage="Tidak ada perubahan pembayaran yang tersedia."
                  disabled={busy}
                  variantFor={paymentTransitionVariant}
                  buttonLabel={(next) => `Pembayaran: ${paymentStatusLabels[next]}`}
                  onSelect={(next) => {
                    if (
                      next === "Cancelled" &&
                      !window.confirm("Ubah status pembayaran menjadi Dibatalkan?")
                    ) {
                      return;
                    }
                    setMutationError(null);
                    paymentMutation.mutate({
                      paymentStatus: next,
                      expectedUpdatedAt: data.order.updatedAt
                    });
                  }}
                />
              </div>
            </Card>
          </StaggerItem>

          <StaggerItem>
            <RawDataSection order={data.order} />
          </StaggerItem>
        </StaggerList>
      ) : null}
    </div>
  );
}
