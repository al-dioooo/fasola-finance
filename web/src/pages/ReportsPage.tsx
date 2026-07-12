import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { api, buildQuery } from "../api/client";
import type {
  ProfitBucket,
  ProfitResponse,
  ReportGranularity,
  RevenueResponse,
  TopProductsResponse
} from "../api/types";
import {
  Badge,
  Card,
  CardTitle,
  CHART_COLORS,
  EmptyState,
  ErrorNote,
  FilterChips,
  PageHeader,
  SkeletonCard,
  Tabs,
  type TabItem
} from "../components/ui";
import { Rise } from "../components/motion/primitives";
import { formatDateJakarta, formatIDR, todayJakarta } from "../lib/format";
import { expenseCategoryLabels } from "../lib/labels";

type TabKey = "omzet" | "laba" | "produk";
type ProfitGranularity = Exclude<ReportGranularity, "daily">;

interface DateRange {
  from: string;
  to: string;
}

const TABS: readonly TabItem<TabKey>[] = [
  { id: "omzet", label: "Omzet" },
  { id: "laba", label: "Laba" },
  { id: "produk", label: "Produk Terlaris" }
];

const OMZET_GRANULARITIES: readonly TabItem<ReportGranularity>[] = [
  { id: "daily", label: "Harian" },
  { id: "weekly", label: "Mingguan" },
  { id: "monthly", label: "Bulanan" }
];

const LABA_GRANULARITIES: readonly TabItem<ProfitGranularity>[] = [
  { id: "weekly", label: "Mingguan" },
  { id: "monthly", label: "Bulanan" }
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

// Shared Recharts styling: warm ink ticks on a cream grid, cream tooltip card.
const AXIS_TICK = { fontSize: 11, fill: CHART_COLORS.ink };

const TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: "#fdfcf7",
  border: "1px solid #e7dcc0",
  borderRadius: 12,
  boxShadow: "0 4px 16px -4px rgb(41 32 25 / 0.14)",
  fontSize: 12,
  color: CHART_COLORS.ink
};

const TOOLTIP_CURSOR = { fill: "#f2ebd9", opacity: 0.5 };

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

// Tiny color-dot captions in place of the Recharts <Legend>.
function ChartDots({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-3">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 text-xs text-ink-500">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function EmptyRangeCard() {
  return (
    <Card>
      <EmptyState emoji="📊" message="Belum ada data pada rentang ini." />
    </Card>
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
      <FilterChips items={OMZET_GRANULARITIES} activeId={granularity} onChange={setGranularity} />

      {revenue.isPending ? <SkeletonCard lines={6} /> : null}
      {revenue.isError ? <ErrorNote message="Gagal memuat data omzet." /> : null}

      {revenue.data ? (
        buckets.length === 0 ? (
          <EmptyRangeCard />
        ) : (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Grafik Omzet</CardTitle>
              <ChartDots items={[{ color: CHART_COLORS.pandan, label: "Omzet" }]} />
            </div>

            {unpricedTotal > 0 ? (
              <p className="mt-3 rounded-xl border border-kunyit-200 bg-kunyit-50 px-3.5 py-2.5 text-xs text-kunyit-800">
                {unpricedTotal} pesanan tanpa harga tidak termasuk dalam omzet.
              </p>
            ) : null}

            <div className="mt-3">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={CHART_COLORS.grid}
                  />
                  <XAxis
                    dataKey="label"
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={{ stroke: CHART_COLORS.grid }}
                  />
                  <YAxis
                    tick={AXIS_TICK}
                    width={56}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => formatAxisIDR(Number(value))}
                  />
                  <Tooltip
                    formatter={(value) => formatIDR(Number(value))}
                    contentStyle={TOOLTIP_STYLE}
                    cursor={TOOLTIP_CURSOR}
                  />
                  <Bar
                    dataKey="revenue"
                    name="Omzet"
                    fill={CHART_COLORS.pandan}
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )
      ) : null}
    </div>
  );
}

function ProfitTable({ rows }: { rows: (ProfitBucket & { label: string })[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-cream-300 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            <th className="py-2 pr-2 font-semibold">Periode</th>
            <th className="py-2 pr-2 text-right font-semibold">Omzet</th>
            <th className="py-2 pr-2 text-right font-semibold">Pengeluaran</th>
            <th className="py-2 text-right font-semibold">Laba</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.bucket} className="border-b border-cream-200 last:border-0">
              <td className="py-2.5 pr-2 text-ink-700">{row.label}</td>
              <td className="py-2.5 pr-2 text-right tabular-nums text-ink-700">
                {formatIDR(row.revenue)}
              </td>
              <td className="py-2.5 pr-2 text-right tabular-nums text-ink-700">
                {formatIDR(row.expenses)}
              </td>
              <td
                className={`py-2.5 text-right font-semibold tabular-nums ${
                  row.profit < 0 ? "text-sambal-600" : "text-ink-900"
                }`}
              >
                {formatIDR(row.profit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpenseCategoryList({ rows }: { rows: ProfitResponse["expensesByCategory"] }) {
  if (rows.length === 0) {
    return <p className="mt-2 text-sm text-ink-500">Tidak ada pengeluaran pada periode ini.</p>;
  }

  return (
    <ul className="mt-1 divide-y divide-cream-200">
      {rows.map((row) => (
        <li key={row.category} className="flex items-center justify-between gap-2 py-2.5 text-sm">
          <span className="text-ink-700">{expenseCategoryLabels[row.category]}</span>
          <Badge className="bg-kunyit-100 text-kunyit-800 tabular-nums">
            {formatIDR(row.total)}
          </Badge>
        </li>
      ))}
    </ul>
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
      <FilterChips items={LABA_GRANULARITIES} activeId={granularity} onChange={setGranularity} />

      {profit.isPending ? <SkeletonCard lines={6} /> : null}
      {profit.isError ? <ErrorNote message="Gagal memuat data laba." /> : null}

      {profit.data ? (
        buckets.length === 0 ? (
          <EmptyRangeCard />
        ) : (
          <>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Omzet vs Pengeluaran</CardTitle>
                <ChartDots
                  items={[
                    { color: CHART_COLORS.pandan, label: "Omzet" },
                    { color: CHART_COLORS.kunyit, label: "Pengeluaran" }
                  ]}
                />
              </div>

              <div className="mt-3">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke={CHART_COLORS.grid}
                    />
                    <XAxis
                      dataKey="label"
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={{ stroke: CHART_COLORS.grid }}
                    />
                    <YAxis
                      tick={AXIS_TICK}
                      width={56}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => formatAxisIDR(Number(value))}
                    />
                    <Tooltip
                      formatter={(value) => formatIDR(Number(value))}
                      contentStyle={TOOLTIP_STYLE}
                      cursor={TOOLTIP_CURSOR}
                    />
                    <Bar
                      dataKey="revenue"
                      name="Omzet"
                      fill={CHART_COLORS.pandan}
                      radius={[6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="expenses"
                      name="Pengeluaran"
                      fill={CHART_COLORS.kunyit}
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardTitle className="mb-2">Rincian Laba</CardTitle>
              <ProfitTable rows={chartData} />
            </Card>

            <Card>
              <CardTitle className="mb-1">Pengeluaran per Kategori</CardTitle>
              <ExpenseCategoryList rows={profit.data.expensesByCategory} />
            </Card>
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
      {topProducts.isPending ? <SkeletonCard lines={6} /> : null}
      {topProducts.isError ? <ErrorNote message="Gagal memuat produk terlaris." /> : null}

      {topProducts.data ? (
        items.length === 0 ? (
          <EmptyRangeCard />
        ) : (
          <Card>
            <CardTitle className="mb-2">Produk Terlaris</CardTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-cream-300 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                    <th className="py-2 pr-3 font-semibold">No</th>
                    <th className="py-2 pr-2 font-semibold">Produk</th>
                    <th className="py-2 pr-2 text-right font-semibold">Jumlah Terjual</th>
                    <th className="py-2 text-right font-semibold">Est. Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((product, index) => (
                    <tr key={product.productId} className="border-b border-cream-200 last:border-0">
                      <td className="py-2.5 pr-3 font-display text-lg font-semibold text-pandan-700 tabular-nums">
                        {index + 1}
                      </td>
                      <td className="py-2.5 pr-2 text-ink-900">{product.name}</td>
                      <td className="py-2.5 pr-2 text-right tabular-nums text-ink-700">
                        {product.totalQty}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-ink-900">
                        {formatIDR(product.estRevenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
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

  const presetItems: TabItem[] = presets.map((preset) => ({
    id: preset.label,
    label: preset.label
  }));

  return (
    <div>
      <PageHeader title="Laporan" subtitle="Omzet, laba, dan produk terlaris" />

      <div className="space-y-4">
        <Rise>
          <Tabs items={TABS} activeId={tab} onChange={setTab} />
        </Rise>

        <Rise>
          <div className="space-y-1">
            <FilterChips items={presetItems} activeId={presetLabel} onChange={setPresetLabel} />
            <p className="text-xs text-ink-400 tabular-nums">
              {formatDateJakarta(range.from)} – {formatDateJakarta(range.to)}
            </p>
          </div>
        </Rise>

        <Rise>
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {tab === "omzet" ? <OmzetTab range={range} /> : null}
              {tab === "laba" ? <LabaTab range={range} /> : null}
              {tab === "produk" ? <ProdukTab range={range} /> : null}
            </motion.div>
          </AnimatePresence>
        </Rise>
      </div>
    </div>
  );
}
