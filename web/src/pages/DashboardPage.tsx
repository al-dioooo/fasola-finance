import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { api } from "../api/client";
import type { BotStatusResponse, SummaryResponse, TopProduct } from "../api/types";
import {
  Card,
  CardTitle,
  EmptyState,
  ErrorNote,
  PageHeader,
  Skeleton,
  SkeletonCard,
  StatCard
} from "../components/ui";
import { Rise, StaggerItem, StaggerList } from "../components/motion/primitives";
import { formatDateJakarta, formatIDR } from "../lib/format";

const formatCount = (value: number) => String(value);

function BotStatusPill() {
  const status = useQuery({
    queryKey: ["bot", "status"],
    queryFn: () => api<BotStatusResponse>("/api/bot/status"),
    refetchInterval: 60_000
  });

  let pillClassName = "border-cream-300 bg-cream-200 text-ink-500";
  let dotClassName = "bg-ink-300";
  let label = "Memeriksa bot...";

  if (status.isError || (status.data && !status.data.gowaReachable)) {
    label = "GoWA tidak terjangkau";
  } else if (status.data) {
    if (status.data.connected) {
      pillClassName = "border-pandan-200 bg-pandan-100 text-pandan-800";
      dotClassName = "bg-pandan-500";
      label = "Bot Terhubung";
    } else {
      pillClassName = "border-sambal-200 bg-sambal-100 text-sambal-800";
      dotClassName = "bg-sambal-500";
      label = "Bot Terputus";
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${pillClassName}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${dotClassName}`} />
      {label}
    </span>
  );
}

function KpiGrid({ data }: { data: SummaryResponse }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        label="Pendapatan"
        value={data.revenue}
        format={formatIDR}
        tone="brand"
        {...(data.unpricedOrders > 0
          ? { footnote: `${data.unpricedOrders} pesanan tanpa harga` }
          : {})}
      />
      <StatCard label="Jumlah Pesanan" value={data.ordersCount} format={formatCount} />
      <StatCard label="Pengeluaran" value={data.expensesTotal} format={formatIDR} />
      <StatCard
        label="Laba"
        value={data.profit}
        format={formatIDR}
        {...(data.profit < 0 ? { tone: "negative" as const } : {})}
      />
    </div>
  );
}

const ACTION_ROW_TONES = {
  kunyit: {
    row: "border-kunyit-200 bg-kunyit-50 text-kunyit-900 hover:bg-kunyit-100 active:bg-kunyit-100",
    count: "text-kunyit-700",
    arrow: "text-kunyit-600"
  },
  sambal: {
    row: "border-sambal-200 bg-sambal-50 text-sambal-900 hover:bg-sambal-100 active:bg-sambal-100",
    count: "text-sambal-700",
    arrow: "text-sambal-600"
  }
} as const;

function ActionRow({
  to,
  count,
  label,
  tone
}: {
  to: string;
  count: number;
  label: string;
  tone: keyof typeof ACTION_ROW_TONES;
}) {
  const classes = ACTION_ROW_TONES[tone];

  return (
    <li>
      <Link
        to={to}
        className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors ${classes.row}`}
      >
        <span className={`font-display text-2xl font-semibold tabular-nums ${classes.count}`}>
          {count}
        </span>
        <span className="flex-1 text-sm font-medium">{label}</span>
        <span aria-hidden className={`text-lg ${classes.arrow}`}>
          →
        </span>
      </Link>
    </li>
  );
}

function NeedActionCard({ needAction }: { needAction: SummaryResponse["needAction"] }) {
  const allClear = needAction.pendingConfirmation === 0 && needAction.needAdminHelp === 0;

  return (
    <Card>
      <CardTitle>Perlu Tindakan</CardTitle>
      {allClear ? (
        <EmptyState emoji="🎉" message="Semua beres, tidak ada pesanan yang perlu ditindak." />
      ) : (
        <ul className="mt-3 space-y-2">
          {needAction.pendingConfirmation > 0 ? (
            <ActionRow
              to="/orders?status=Pending%20Admin%20Confirmation"
              count={needAction.pendingConfirmation}
              label="menunggu konfirmasi"
              tone="kunyit"
            />
          ) : null}
          {needAction.needAdminHelp > 0 ? (
            <ActionRow
              to="/orders?status=Need%20Admin%20Help"
              count={needAction.needAdminHelp}
              label="perlu bantuan admin"
              tone="sambal"
            />
          ) : null}
        </ul>
      )}
    </Card>
  );
}

function TopProductsCard({ products }: { products: TopProduct[] }) {
  return (
    <Card>
      <CardTitle>Top 5 Produk Hari Ini</CardTitle>
      {products.length === 0 ? (
        <EmptyState emoji="🍳" message="Belum ada penjualan hari ini." />
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cream-300 text-left text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                <th className="py-2 pr-2 font-semibold">Produk</th>
                <th className="py-2 pr-2 text-right font-semibold">Jumlah</th>
                <th className="py-2 text-right font-semibold">Est. Omzet</th>
              </tr>
            </thead>
            <tbody>
              {products.slice(0, 5).map((product) => (
                <tr key={product.productId} className="border-b border-cream-200 last:border-0">
                  <td className="py-2.5 pr-2 text-ink-700">{product.name}</td>
                  <td className="py-2.5 pr-2 text-right tabular-nums text-ink-700">
                    {product.totalQty}
                  </td>
                  <td className="py-2.5 text-right font-medium tabular-nums text-ink-900">
                    {formatIDR(product.estRevenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[104px]" />
        ))}
      </div>
      <SkeletonCard lines={2} />
      <SkeletonCard lines={5} />
    </div>
  );
}

function DashboardContent({ data }: { data: SummaryResponse }) {
  return (
    <StaggerList className="space-y-4">
      <StaggerItem>
        <KpiGrid data={data} />
      </StaggerItem>
      <StaggerItem>
        <NeedActionCard needAction={data.needAction} />
      </StaggerItem>
      <StaggerItem>
        <TopProductsCard products={data.topProducts} />
      </StaggerItem>
    </StaggerList>
  );
}

export function DashboardPage() {
  const summary = useQuery({
    queryKey: ["reports", "summary"],
    queryFn: () => api<SummaryResponse>("/api/reports/summary")
  });

  return (
    <div>
      <Rise>
        <PageHeader
          title="Ringkasan Hari Ini"
          {...(summary.data ? { subtitle: formatDateJakarta(summary.data.date) } : {})}
          actions={<BotStatusPill />}
        />
      </Rise>

      <div className="space-y-4">
        {summary.isPending ? (
          <Rise>
            <DashboardSkeleton />
          </Rise>
        ) : null}
        {summary.isError ? (
          <Rise>
            <ErrorNote message="Gagal memuat ringkasan harian." />
          </Rise>
        ) : null}
        {summary.data ? <DashboardContent data={summary.data} /> : null}
      </div>
    </div>
  );
}
