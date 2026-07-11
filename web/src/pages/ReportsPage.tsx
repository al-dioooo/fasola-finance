import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { api, buildQuery } from "../api/client";
import type {
  ProfitResponse,
  ReportGranularity,
  RevenueResponse,
  TopProductsResponse
} from "../api/types";
import { Card, EmptyNote, ErrorNote, Spinner } from "../components/ui";
import { formatDateJakarta, formatIDR, todayJakarta } from "../lib/format";
import { expenseCategoryLabels } from "../lib/labels";

type TabKey = "omzet" | "laba" | "produk";
type ProfitGranularity = Exclude<ReportGranularity, "daily">;

interface DateRange {
  from: string;
  to: string;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "omzet", label: "Omzet" },
  { key: "laba", label: "Laba" },
  { key: "produk", label: "Produk Terlaris" }
];

const OMZET_GRANULARITIES: { value: ReportGranularity; label: string }[] = [
  { value: "daily", label: "Harian" },
  { value: "weekly", label: "Mingguan" },
  { value: "monthly", label: "Bulanan" }
];

const LABA_GRANULARITIES: { value: ProfitGranularity; label: string }[] = [
  { value: "weekly", label: "Mingguan" },
  { value: "monthly", label: "Bulanan" }
];

const MONTHS_ID = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des"
];

// Shift a YYYY-MM-DD business date by whole days. Built from string parts and
// UTC component math only — never local-timezone Date parsing.
function addDaysIso(date: string, days: number): string {
  const [y = "1970", m = "01", d = "01"] = date.split("-");
  const shifted = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + days));
  return shifted.toISOString().slice(0, 10);
}

function buildPresets(today: string): { label: string; range: DateRange }[] {
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthEnd = addDaysIso(monthStart, -1);
  const prevMonthStart = `${prevMonthEnd.slice(0, 7)}-01`;

  return [
    { label: "Hari Ini", range: { from: today, to: today } },
    { label: "7 Hari Terakhir", range: { from: addDaysIso(today, -6), to: today } },
    { label: "Bulan Ini", range: { from: monthStart, to: today } },
    { label: "Bulan Lalu", range: { from: prevMonthStart, to: prevMonthEnd } }
  ];
}

// Buckets come back as YYYY-MM-DD (daily/weekly start date) or YYYY-MM (monthly).
function bucketLabel(bucket: string, granularity: ReportGranularity): string {
  const parts = bucket.split("-");
  const year = parts[0] ?? "";
  const month = parts[1] ?? "";
  const day = parts[2];
  const monthName = MONTHS_ID[Number(month) - 1] ?? month;

  if (granularity === "monthly" || day === undefined) {
    return `${monthName} ${year}`;
  }

  return `${day} ${monthName}`;
}

function formatAxisIDR(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("id-ID")} jt`;
  }

  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toLocaleString("id-ID")} rb`;
  }

  return String(value);
}

function ToggleGroup<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-stone-200 bg-white p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded px-3 py-1 text-xs ${
            option.value === value
              ? "bg-emerald-700 font-medium text-white"
              : "text-stone-600 hover:bg-stone-100"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function OmzetTab({ range }: { range: DateRange }) {
  const [granularity, setGranularity] = useState<ReportGranularity>("daily");

  const revenue = useQuery({
    queryKey: ["reports", "revenue", granularity, range.from, range.to],
    queryFn: () =>
      api<RevenueResponse>(
        `/api/reports/revenue${buildQuery({ granularity, from: range.from, to: range.to })}`
      )
  });

  const buckets = revenue.data?.buckets ?? [];
  const chartData = buckets.map((bucket) => ({
    ...bucket,
    label: bucketLabel(bucket.bucket, granularity)
  }));
  const unpricedTotal = buckets.reduce((sum, bucket) => sum + bucket.unpricedOrders, 0);

  return (
    <div className="space-y-3">
      <ToggleGroup options={OMZET_GRANULARITIES} value={granularity} onChange={setGranularity} />

      {revenue.isPending ? <Spinner label="Memuat data omzet..." /> : null}
      {revenue.isError ? <ErrorNote message="Gagal memuat data omzet." /> : null}

      {revenue.data ? (
        buckets.length === 0 ? (
          <EmptyNote message="Tidak ada data omzet pada periode ini." />
        ) : (
          <>
            {unpricedTotal > 0 ? (
              <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {unpricedTotal} pesanan tanpa harga tidak termasuk dalam omzet.
              </p>
            ) : null}
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    width={56}
                    tickFormatter={(value) => formatAxisIDR(Number(value))}
                  />
                  <Tooltip formatter={(value) => formatIDR(Number(value))} />
                  <Bar dataKey="revenue" name="Omzet" fill="#047857" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )
      ) : null}
    </div>
  );
}

function LabaTab({ range }: { range: DateRange }) {
  const [granularity, setGranularity] = useState<ProfitGranularity>("weekly");

  const profit = useQuery({
    queryKey: ["reports", "profit", granularity, range.from, range.to],
    queryFn: () =>
      api<ProfitResponse>(
        `/api/reports/profit${buildQuery({ granularity, from: range.from, to: range.to })}`
      )
  });

  const buckets = profit.data?.buckets ?? [];
  const chartData = buckets.map((bucket) => ({
    ...bucket,
    label: bucketLabel(bucket.bucket, granularity)
  }));

  return (
    <div className="space-y-3">
      <ToggleGroup options={LABA_GRANULARITIES} value={granularity} onChange={setGranularity} />

      {profit.isPending ? <Spinner label="Memuat data laba..." /> : null}
      {profit.isError ? <ErrorNote message="Gagal memuat data laba." /> : null}

      {profit.data ? (
        buckets.length === 0 ? (
          <EmptyNote message="Tidak ada data laba pada periode ini." />
        ) : (
          <>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    width={56}
                    tickFormatter={(value) => formatAxisIDR(Number(value))}
                  />
                  <Tooltip formatter={(value) => formatIDR(Number(value))} />
                  <Legend />
                  <Bar dataKey="revenue" name="Omzet" fill="#047857" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expenses" name="Pengeluaran" fill="#e11d48" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                    <th className="py-2 pr-2 font-medium">Periode</th>
                    <th className="py-2 pr-2 text-right font-medium">Omzet</th>
                    <th className="py-2 pr-2 text-right font-medium">Pengeluaran</th>
                    <th className="py-2 text-right font-medium">Laba</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((row) => (
                    <tr key={row.bucket} className="border-b border-stone-100">
                      <td className="py-2 pr-2">{row.label}</td>
                      <td className="py-2 pr-2 text-right">{formatIDR(row.revenue)}</td>
                      <td className="py-2 pr-2 text-right">{formatIDR(row.expenses)}</td>
                      <td
                        className={`py-2 text-right font-medium ${
                          row.profit < 0 ? "text-rose-600" : "text-stone-900"
                        }`}
                      >
                        {formatIDR(row.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-stone-900">Pengeluaran per Kategori</h3>
              {profit.data.expensesByCategory.length === 0 ? (
                <p className="mt-2 text-sm text-stone-500">
                  Tidak ada pengeluaran pada periode ini.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-stone-100">
                  {profit.data.expensesByCategory.map((row) => (
                    <li key={row.category} className="flex justify-between py-2 text-sm">
                      <span>{expenseCategoryLabels[row.category]}</span>
                      <span className="font-medium">{formatIDR(row.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )
      ) : null}
    </div>
  );
}

function ProdukTab({ range }: { range: DateRange }) {
  const topProducts = useQuery({
    queryKey: ["reports", "top-products", range.from, range.to],
    queryFn: () =>
      api<TopProductsResponse>(
        `/api/reports/top-products${buildQuery({ from: range.from, to: range.to })}`
      )
  });

  const items = topProducts.data?.items ?? [];

  return (
    <div className="space-y-3">
      {topProducts.isPending ? <Spinner label="Memuat produk terlaris..." /> : null}
      {topProducts.isError ? <ErrorNote message="Gagal memuat produk terlaris." /> : null}

      {topProducts.data ? (
        items.length === 0 ? (
          <EmptyNote message="Tidak ada penjualan pada periode ini." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                  <th className="py-2 pr-2 font-medium">No</th>
                  <th className="py-2 pr-2 font-medium">Produk</th>
                  <th className="py-2 pr-2 text-right font-medium">Jumlah Terjual</th>
                  <th className="py-2 text-right font-medium">Est. Omzet</th>
                </tr>
              </thead>
              <tbody>
                {items.map((product, index) => (
                  <tr key={product.productId} className="border-b border-stone-100">
                    <td className="py-2 pr-2 text-stone-500">{index + 1}</td>
                    <td className="py-2 pr-2">{product.name}</td>
                    <td className="py-2 pr-2 text-right">{product.totalQty}</td>
                    <td className="py-2 text-right">{formatIDR(product.estRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}

export function ReportsPage() {
  const presets = buildPresets(todayJakarta());
  const [tab, setTab] = useState<TabKey>("omzet");
  const [presetLabel, setPresetLabel] = useState("7 Hari Terakhir");

  const fallback = presets[1] ?? presets[0];
  const range = presets.find((preset) => preset.label === presetLabel)?.range ??
    fallback?.range ?? { from: todayJakarta(), to: todayJakarta() };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-stone-900">Laporan</h2>

      <div className="flex gap-1 border-b border-stone-200">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`-mb-px rounded-t px-3 py-2 text-sm ${
              tab === item.key
                ? "border-x border-t border-stone-200 bg-white font-medium text-emerald-800"
                : "text-stone-500 hover:text-stone-800"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => setPresetLabel(preset.label)}
            className={`rounded-full border px-3 py-1 text-xs ${
              preset.label === presetLabel
                ? "border-emerald-700 bg-emerald-700 text-white"
                : "border-stone-200 bg-white text-stone-600 hover:bg-stone-100"
            }`}
          >
            {preset.label}
          </button>
        ))}
        <span className="text-xs text-stone-500">
          {formatDateJakarta(range.from)} – {formatDateJakarta(range.to)}
        </span>
      </div>

      <Card>
        {tab === "omzet" ? <OmzetTab range={range} /> : null}
        {tab === "laba" ? <LabaTab range={range} /> : null}
        {tab === "produk" ? <ProdukTab range={range} /> : null}
      </Card>
    </div>
  );
}
