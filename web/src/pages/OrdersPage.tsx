import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";

import { api, buildQuery } from "../api/client";
import type { OrderListItem, OrdersListResponse, OrderStatus } from "../api/types";
import { Rise, StaggerItem, StaggerList } from "../components/motion/primitives";
import {
  Card,
  EmptyState,
  ErrorNote,
  Field,
  FilterChips,
  Input,
  OrderStatusBadge,
  PageHeader,
  Pagination,
  PaymentStatusBadge,
  SkeletonRows,
  type TabItem
} from "../components/ui";
import { formatDateTimeJakarta, formatIDR, todayJakarta } from "../lib/format";
import { orderStatusLabels } from "../lib/labels";

const PAGE_LIMIT = 25;

const ORDER_STATUSES = Object.keys(orderStatusLabels) as OrderStatus[];

type StatusFilterId = "all" | OrderStatus;

const STATUS_FILTER_ITEMS: readonly TabItem<StatusFilterId>[] = [
  { id: "all", label: "Semua" },
  ...ORDER_STATUSES.map((value) => ({ id: value, label: orderStatusLabels[value] }))
];

function isOrderStatus(value: string | null): value is OrderStatus {
  return value !== null && value in orderStatusLabels;
}

function OrdersFilterCard({
  allDates,
  fromDate,
  toDate,
  searchInput,
  onFromDateChange,
  onToDateChange,
  onAllDatesChange,
  onSearchInputChange
}: {
  allDates: boolean;
  fromDate: string;
  toDate: string;
  searchInput: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  onAllDatesChange: (checked: boolean) => void;
  onSearchInputChange: (value: string) => void;
}) {
  return (
    <Card>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dari Tanggal">
          <Input
            type="date"
            value={fromDate}
            disabled={allDates}
            onChange={(event) => onFromDateChange(event.target.value)}
          />
        </Field>
        <Field label="Sampai Tanggal">
          <Input
            type="date"
            value={toDate}
            disabled={allDates}
            onChange={(event) => onToDateChange(event.target.value)}
          />
        </Field>
      </div>
      <label className="mt-2 flex min-h-10 items-center gap-2 text-sm font-medium text-ink-700">
        <input
          type="checkbox"
          checked={allDates}
          onChange={(event) => onAllDatesChange(event.target.checked)}
          className="size-4 rounded border-cream-300 accent-pandan-600"
        />
        Semua Tanggal
      </label>
      <div className="mt-2">
        <Field label="Cari">
          <Input
            type="search"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            placeholder="Cari nama, nomor WA, atau produk..."
          />
        </Field>
      </div>
    </Card>
  );
}

function OrderCard({ order }: { order: OrderListItem }) {
  return (
    <Link to={`/orders/${encodeURIComponent(order.orderId)}`} className="block">
      <Card className="transition-colors hover:border-pandan-300">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs font-semibold text-ink-500">{order.orderId}</p>
            <p className="mt-0.5 text-xs text-ink-400">{formatDateTimeJakarta(order.createdAt)}</p>
            <p className="mt-1.5 text-sm font-medium text-ink-900">
              {order.customerName ?? order.customerWa}
            </p>
            <p className="truncate text-xs text-ink-500">{order.productsText}</p>
          </div>
          <p className="font-display text-lg font-semibold whitespace-nowrap text-pandan-900 tabular-nums">
            {formatIDR(order.estimatedSubtotal)}
          </p>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <OrderStatusBadge status={order.orderStatus} />
          <PaymentStatusBadge status={order.paymentStatus} />
        </div>
      </Card>
    </Link>
  );
}

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

  function handlePageChange(next: number) {
    if (orders.isFetching) {
      return;
    }
    setPage(next);
  }

  return (
    <div className="space-y-4">
      <Rise>
        <PageHeader title="Pesanan" />
      </Rise>

      <Rise>
        <FilterChips
          items={STATUS_FILTER_ITEMS}
          activeId={status ?? "all"}
          onChange={(id) => selectStatus(id === "all" ? null : id)}
        />
      </Rise>

      <Rise>
        <OrdersFilterCard
          allDates={allDates}
          fromDate={fromDate}
          toDate={toDate}
          searchInput={searchInput}
          onFromDateChange={(value) => {
            setFromDate(value);
            setPage(1);
          }}
          onToDateChange={(value) => {
            setToDate(value);
            setPage(1);
          }}
          onAllDatesChange={toggleAllDates}
          onSearchInputChange={setSearchInput}
        />
      </Rise>

      <Rise>
        {orders.isPending ? <SkeletonRows rows={5} /> : null}
        {orders.isError ? <ErrorNote message="Gagal memuat daftar pesanan." /> : null}

        {orders.data && orders.data.items.length === 0 ? (
          <Card>
            <EmptyState emoji="🍽️" message="Tidak ada pesanan yang cocok dengan filter." />
          </Card>
        ) : null}

        {orders.data && orders.data.items.length > 0 ? (
          <>
            <StaggerList className="space-y-2.5">
              {orders.data.items.map((order) => (
                <StaggerItem key={order.orderId}>
                  <OrderCard order={order} />
                </StaggerItem>
              ))}
            </StaggerList>
            <Pagination
              page={orders.data.page}
              limit={orders.data.limit}
              total={orders.data.total}
              onPageChange={handlePageChange}
            />
          </>
        ) : null}
      </Rise>
    </div>
  );
}
