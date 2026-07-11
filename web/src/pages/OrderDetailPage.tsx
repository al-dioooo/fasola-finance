import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { api, ApiError } from "../api/client";
import type {
  OrderDetailResponse,
  OrderStatus,
  OrderUpdateResponse,
  PaymentStatus
} from "../api/types";
import { Badge, Card, ErrorNote, Spinner } from "../components/ui";
import { formatDateTimeJakarta, formatIDR } from "../lib/format";
import {
  orderStatusBadgeClasses,
  orderStatusLabels,
  paymentStatusBadgeClasses,
  paymentStatusLabels
} from "../lib/labels";

function transitionButtonClass(destructive: boolean): string {
  return `rounded border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
    destructive
      ? "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100"
      : "border-stone-300 bg-white text-stone-800 hover:bg-stone-50"
  }`;
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
      <Link to="/orders" className="inline-block text-sm text-emerald-800 hover:underline">
        &larr; Kembali ke Pesanan
      </Link>

      {orderId === "" ? <ErrorNote message="Pesanan tidak ditemukan." /> : null}

      {orderId !== "" && detail.isPending ? <Spinner label="Memuat pesanan..." /> : null}

      {detail.isError ? (
        <ErrorNote
          message={
            detail.error instanceof ApiError && detail.error.status === 404
              ? "Pesanan tidak ditemukan."
              : "Gagal memuat detail pesanan."
          }
        />
      ) : null}

      {data ? (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-stone-900">{data.order.orderId}</h2>
                <p className="text-xs text-stone-500">
                  Dibuat {formatDateTimeJakarta(data.order.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge className={orderStatusBadgeClasses[data.order.orderStatus]}>
                  {orderStatusLabels[data.order.orderStatus]}
                </Badge>
                <Badge className={paymentStatusBadgeClasses[data.order.paymentStatus]}>
                  {paymentStatusLabels[data.order.paymentStatus]}
                </Badge>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-stone-900">
                  {data.order.customerName ?? data.order.customerWa}
                </p>
                <p className="text-xs text-stone-500">{data.order.customerWa}</p>
              </div>
              <a
                href={`https://wa.me/${data.order.customerWa.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
              >
                Chat WhatsApp
              </a>
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-stone-900">Item Pesanan</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                    <th className="py-2 pr-2 font-medium">Produk</th>
                    <th className="py-2 pr-2 text-right font-medium">Jml</th>
                    <th className="py-2 pr-2 text-right font-medium">Harga Satuan</th>
                    <th className="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.order.products.map((item, index) => (
                    <tr key={`${item.productId}-${index}`} className="border-b border-stone-100">
                      <td className="py-2 pr-2">
                        <span className="text-stone-900">{item.name}</span>
                        {item.variant ? (
                          <span className="text-xs text-stone-500"> ({item.variant})</span>
                        ) : null}
                        {item.notes ? <p className="text-xs text-stone-500">{item.notes}</p> : null}
                      </td>
                      <td className="py-2 pr-2 text-right">{item.quantity}</td>
                      <td className="py-2 pr-2 text-right">
                        {item.unitPrice === null ? "—" : formatIDR(item.unitPrice)}
                      </td>
                      <td className="py-2 text-right">
                        {item.unitPrice === null ? "—" : formatIDR(item.unitPrice * item.quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td
                      colSpan={3}
                      className="py-2 pr-2 text-right text-xs font-medium text-stone-500"
                    >
                      Subtotal Estimasi
                    </td>
                    <td className="py-2 text-right font-semibold text-stone-900">
                      {formatIDR(data.order.estimatedSubtotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-stone-900">Info Pesanan</h3>
            <dl className="mt-2 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-stone-500">Alamat</dt>
                <dd className="whitespace-pre-wrap text-stone-800">{data.order.address || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">Catatan</dt>
                <dd className="whitespace-pre-wrap text-stone-800">{data.order.notes ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">Waktu Diminta</dt>
                <dd className="text-stone-800">{data.order.requestedTime ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">Metode Pembayaran</dt>
                <dd className="text-stone-800">{data.order.paymentMethod || "—"}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-stone-900">Ubah Status</h3>

            {mutationError ? (
              <div className="mt-2">
                <ErrorNote message={mutationError} />
              </div>
            ) : null}

            <div className="mt-3">
              <p className="text-xs text-stone-500">Status Pesanan</p>
              {data.allowedStatusTransitions.length === 0 ? (
                <p className="mt-1 text-sm text-stone-500">
                  Tidak ada perubahan status yang tersedia.
                </p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-2">
                  {data.allowedStatusTransitions.map((next) => (
                    <button
                      key={next}
                      type="button"
                      disabled={busy}
                      className={transitionButtonClass(next === "Cancelled")}
                      onClick={() => {
                        if (next === "Cancelled" && !window.confirm("Batalkan pesanan ini?")) {
                          return;
                        }
                        setMutationError(null);
                        statusMutation.mutate({
                          orderStatus: next,
                          expectedUpdatedAt: data.order.updatedAt
                        });
                      }}
                    >
                      Ubah ke: {orderStatusLabels[next]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4">
              <p className="text-xs text-stone-500">Status Pembayaran</p>
              {data.allowedPaymentTransitions.length === 0 ? (
                <p className="mt-1 text-sm text-stone-500">
                  Tidak ada perubahan pembayaran yang tersedia.
                </p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-2">
                  {data.allowedPaymentTransitions.map((next) => (
                    <button
                      key={next}
                      type="button"
                      disabled={busy}
                      className={transitionButtonClass(next === "Cancelled")}
                      onClick={() => {
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
                    >
                      Pembayaran: {paymentStatusLabels[next]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <details className="rounded-lg border border-stone-200 bg-white shadow-sm">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-stone-900">
              Data Mentah &amp; AI
            </summary>
            <div className="space-y-3 border-t border-stone-100 px-4 py-3 text-sm">
              <div>
                <p className="text-xs text-stone-500">Pesan Asli</p>
                {data.order.rawMessage ? (
                  <pre className="mt-1 rounded bg-stone-50 p-2 text-xs whitespace-pre-wrap text-stone-700">
                    {data.order.rawMessage}
                  </pre>
                ) : (
                  <p className="text-stone-800">—</p>
                )}
              </div>
              <div>
                <p className="text-xs text-stone-500">Model AI</p>
                <p className="text-stone-800">{data.order.aiModel ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-stone-500">Keyakinan AI</p>
                <p className="text-stone-800">
                  {data.order.aiConfidence === null
                    ? "—"
                    : `${Math.round(data.order.aiConfidence * 100)}%`}
                </p>
              </div>
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
