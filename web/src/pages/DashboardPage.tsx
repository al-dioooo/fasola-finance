import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { api } from "../api/client";
import type { BotStatusResponse, SummaryResponse } from "../api/types";
import { Card, EmptyNote, ErrorNote, Spinner } from "../components/ui";
import { formatDateJakarta, formatIDR } from "../lib/format";

function BotStatusPill() {
  const status = useQuery({
    queryKey: ["bot", "status"],
    queryFn: () => api<BotStatusResponse>("/api/bot/status"),
    refetchInterval: 60_000
  });

  let className = "bg-stone-200 text-stone-600";
  let label = "Memeriksa bot...";

  if (status.isError || (status.data && !status.data.gowaReachable)) {
    label = "GoWA tidak terjangkau";
  } else if (status.data) {
    if (status.data.connected) {
      className = "bg-emerald-100 text-emerald-800";
      label = "Bot Terhubung";
    } else {
      className = "bg-rose-100 text-rose-800";
      label = "Bot Terputus";
    }
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function KpiCard({
  label,
  value,
  valueClassName = "text-stone-900",
  extra = null
}: {
  label: string;
  value: string;
  valueClassName?: string;
  extra?: ReactNode;
}) {
  return (
    <Card>
      <p className="text-xs text-stone-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${valueClassName}`}>{value}</p>
      {extra}
    </Card>
  );
}

export function DashboardPage() {
  const summary = useQuery({
    queryKey: ["reports", "summary"],
    queryFn: () => api<SummaryResponse>("/api/reports/summary")
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Ringkasan Hari Ini</h2>
          {summary.data ? (
            <p className="text-xs text-stone-500">{formatDateJakarta(summary.data.date)}</p>
          ) : null}
        </div>
        <BotStatusPill />
      </div>

      {summary.isPending ? <Spinner label="Memuat ringkasan..." /> : null}
      {summary.isError ? <ErrorNote message="Gagal memuat ringkasan harian." /> : null}

      {summary.data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Pendapatan Hari Ini"
              value={formatIDR(summary.data.revenue)}
              extra={
                summary.data.unpricedOrders > 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {summary.data.unpricedOrders} pesanan tanpa harga
                  </p>
                ) : null
              }
            />
            <KpiCard label="Jumlah Pesanan" value={String(summary.data.ordersCount)} />
            <KpiCard label="Pengeluaran Hari Ini" value={formatIDR(summary.data.expensesTotal)} />
            <KpiCard
              label="Laba Hari Ini"
              value={formatIDR(summary.data.profit)}
              valueClassName={summary.data.profit < 0 ? "text-rose-600" : "text-stone-900"}
            />
          </div>

          <Card>
            <h3 className="text-sm font-semibold text-stone-900">Perlu Tindakan</h3>
            {summary.data.needAction.pendingConfirmation === 0 &&
            summary.data.needAction.needAdminHelp === 0 ? (
              <p className="mt-2 text-sm text-stone-500">Tidak ada pesanan yang perlu ditindak.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {summary.data.needAction.pendingConfirmation > 0 ? (
                  <li>
                    <Link
                      to="/orders?status=Pending%20Admin%20Confirmation"
                      className="flex items-center justify-between rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100"
                    >
                      <span>{summary.data.needAction.pendingConfirmation} menunggu konfirmasi</span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  </li>
                ) : null}
                {summary.data.needAction.needAdminHelp > 0 ? (
                  <li>
                    <Link
                      to="/orders?status=Need%20Admin%20Help"
                      className="flex items-center justify-between rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 hover:bg-rose-100"
                    >
                      <span>{summary.data.needAction.needAdminHelp} perlu bantuan admin</span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  </li>
                ) : null}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-stone-900">Top 5 Produk Hari Ini</h3>
            {summary.data.topProducts.length === 0 ? (
              <EmptyNote message="Belum ada penjualan hari ini." />
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                      <th className="py-2 pr-2 font-medium">Produk</th>
                      <th className="py-2 pr-2 text-right font-medium">Jumlah</th>
                      <th className="py-2 text-right font-medium">Est. Omzet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.data.topProducts.slice(0, 5).map((product) => (
                      <tr key={product.productId} className="border-b border-stone-100">
                        <td className="py-2 pr-2">{product.name}</td>
                        <td className="py-2 pr-2 text-right">{product.totalQty}</td>
                        <td className="py-2 text-right">{formatIDR(product.estRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
