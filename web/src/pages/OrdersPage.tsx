import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";

import { api, buildQuery } from "../api/client";
import type { OrdersListResponse, OrderStatus } from "../api/types";
import { Badge, Card, EmptyNote, ErrorNote, Spinner } from "../components/ui";
import { formatDateTimeJakarta, formatIDR, todayJakarta } from "../lib/format";
import {
  orderStatusBadgeClasses,
  orderStatusLabels,
  paymentStatusBadgeClasses,
  paymentStatusLabels
} from "../lib/labels";

const PAGE_LIMIT = 25;

const ORDER_STATUSES = Object.keys(orderStatusLabels) as OrderStatus[];

function isOrderStatus(value: string | null): value is OrderStatus {
  return value !== null && value in orderStatusLabels;
}

function chipClass(selected: boolean): string {
  return `rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap ${
    selected
      ? "border-emerald-800 bg-emerald-800 text-white"
      : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
  }`;
}

const pagerButtonClass =
  "rounded border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 " +
  "hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40";

export function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get("status");
  const status = isOrderStatus(statusParam) ? statusParam : null;

  const [allDates, setAllDates] = useState(false);
  const [fromDate, setFromDate] = useState(todayJakarta);
  const [toDate, setToDate] = useState(todayJakarta);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQ(searchInput.trim());
      setPage(1);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const from = allDates ? undefined : fromDate;
  const to = allDates ? undefined : toDate;

  const orders = useQuery({
    queryKey: ["orders", "list", { status, q, from: from ?? "", to: to ?? "", page }],
    queryFn: () =>
      api<OrdersListResponse>(
        `/api/orders${buildQuery({ status, q, from, to, page, limit: PAGE_LIMIT })}`
      ),
    placeholderData: keepPreviousData
  });

  function selectStatus(next: OrderStatus | null) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === null) {
        params.delete("status");
      } else {
        params.set("status", next);
      }
      return params;
    });
    setPage(1);
  }

  function toggleAllDates(checked: boolean) {
    setAllDates(checked);
    if (!checked) {
      setFromDate(todayJakarta());
      setToDate(todayJakarta());
    }
    setPage(1);
  }

  const total = orders.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (orders.data?.limit ?? PAGE_LIMIT)));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-stone-900">Pesanan</h2>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={chipClass(status === null)}
          onClick={() => selectStatus(null)}
        >
          Semua
        </button>
        {ORDER_STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            className={chipClass(status === value)}
            onClick={() => selectStatus(value)}
          >
            {orderStatusLabels[value]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={fromDate}
          disabled={allDates}
          onChange={(event) => {
            setFromDate(event.target.value);
            setPage(1);
          }}
          aria-label="Dari tanggal"
          className="rounded border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-700 disabled:bg-stone-100 disabled:text-stone-400"
        />
        <span className="text-xs text-stone-500">s.d.</span>
        <input
          type="date"
          value={toDate}
          disabled={allDates}
          onChange={(event) => {
            setToDate(event.target.value);
            setPage(1);
          }}
          aria-label="Sampai tanggal"
          className="rounded border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-700 disabled:bg-stone-100 disabled:text-stone-400"
        />
        <label className="flex items-center gap-1.5 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={allDates}
            onChange={(event) => toggleAllDates(event.target.checked)}
            className="rounded border-stone-300"
          />
          Semua Tanggal
        </label>
      </div>

      <input
        type="search"
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
        placeholder="Cari nama, nomor WA, atau produk..."
        aria-label="Cari pesanan"
        className="w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 placeholder:text-stone-400"
      />

      {orders.isPending ? <Spinner label="Memuat pesanan..." /> : null}
      {orders.isError ? <ErrorNote message="Gagal memuat daftar pesanan." /> : null}

      {orders.data && orders.data.items.length === 0 ? (
        <EmptyNote message="Tidak ada pesanan yang cocok dengan filter." />
      ) : null}

      {orders.data && orders.data.items.length > 0 ? (
        <>
          <ul className="space-y-2">
            {orders.data.items.map((order) => (
              <li key={order.orderId}>
                <Link to={`/orders/${encodeURIComponent(order.orderId)}`} className="block">
                  <Card className="transition-colors hover:border-emerald-300">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-stone-900">{order.orderId}</p>
                        <p className="text-xs text-stone-500">
                          {formatDateTimeJakarta(order.createdAt)}
                        </p>
                        <p className="mt-1 text-sm text-stone-800">
                          {order.customerName ?? order.customerWa}
                        </p>
                        <p className="truncate text-xs text-stone-500">{order.productsText}</p>
                      </div>
                      <p className="text-sm font-semibold whitespace-nowrap text-stone-900">
                        {formatIDR(order.estimatedSubtotal)}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge className={orderStatusBadgeClasses[order.orderStatus]}>
                        {orderStatusLabels[order.orderStatus]}
                      </Badge>
                      <Badge className={paymentStatusBadgeClasses[order.paymentStatus]}>
                        {paymentStatusLabels[order.paymentStatus]}
                      </Badge>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className={pagerButtonClass}
              disabled={page <= 1 || orders.isFetching}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Sebelumnya
            </button>
            <span className="text-sm text-stone-600">
              Halaman {orders.data.page} dari {totalPages}
            </span>
            <button
              type="button"
              className={pagerButtonClass}
              disabled={page >= totalPages || orders.isFetching}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Berikutnya
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
