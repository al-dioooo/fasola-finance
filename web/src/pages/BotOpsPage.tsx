import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";

import { api, buildQuery } from "../api/client";
import type {
  AiLogItem,
  AiLogsResponse,
  BotHealthResponse,
  BotLoginResponse,
  BotStatusResponse,
  HandoffItem,
  HandoffResponse,
  MessageDirection,
  MessageLogItem,
  MessagesResponse
} from "../api/types";
import { Rise, StaggerItem, StaggerList } from "../components/motion/primitives";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  DropUpSelect,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Pagination,
  Skeleton,
  SkeletonCard,
  SkeletonRows,
  Tabs
} from "../components/ui";
import { formatDateTimeJakarta } from "../lib/format";

const TAB_ITEMS = [
  { id: "status", label: "Status & QR" },
  { id: "handoff", label: "Perlu Bantuan" },
  { id: "messages", label: "Log Pesan" },
  { id: "ai", label: "Log AI" }
] as const;

type TabKey = (typeof TAB_ITEMS)[number]["id"];

const LOG_PAGE_LIMIT = 25;

// Table cells share one treatment across "Log Pesan" and "Log AI".
const TH_BASE =
  "sticky top-0 z-10 border-b border-cream-200 bg-cream-50 px-2.5 py-2 text-xs font-semibold tracking-wide text-ink-500 uppercase whitespace-nowrap";
const thLeft = `${TH_BASE} text-left`;
const thRight = `${TH_BASE} text-right`;
const tdClass = "border-b border-cream-100 px-2.5 py-2 align-top text-ink-700";

// Link-shaped buttons keep real anchor semantics (router link / wa.me new tab).
const ghostLinkClasses =
  "inline-flex items-center justify-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-pandan-700 transition-colors hover:bg-pandan-50";
const secondaryLinkClasses =
  "inline-flex items-center justify-center gap-2 rounded-full border border-cream-300 bg-cream-50 px-3 py-1.5 text-xs font-semibold text-ink-900 shadow-card transition-colors hover:border-pandan-300 hover:bg-pandan-50";

// Local UI copy for the bot's message processing statuses (enum values stay English).
const processingStatusLabels: Record<string, string> = {
  Received: "Diterima",
  Ignored: "Diabaikan",
  Success: "Berhasil",
  Failed: "Gagal",
  Duplicate: "Duplikat",
  Unsupported: "Tidak Didukung"
};

const PROCESSING_STATUS_OPTIONS = [
  "Received",
  "Ignored",
  "Success",
  "Failed",
  "Duplicate",
  "Unsupported"
];

const directionLabels: Record<MessageDirection, string> = {
  inbound: "Pelanggan",
  outbound: "Bot"
};

// Mirrors the server's direction query param; "inbound" is the server default.
const DIRECTION_OPTIONS = [
  { value: "inbound", label: "Pelanggan" },
  { value: "outbound", label: "Bot" },
  { value: "all", label: "Semua" }
] as const;

interface BadgeTone {
  badge: string;
  dot: string;
}

const TONE_OK: BadgeTone = { badge: "bg-pandan-100 text-pandan-800", dot: "bg-pandan-500" };
const TONE_DOWN: BadgeTone = { badge: "bg-sambal-100 text-sambal-800", dot: "bg-sambal-500" };
const TONE_NEUTRAL: BadgeTone = { badge: "bg-cream-200 text-ink-500", dot: "bg-ink-400" };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Terjadi kesalahan yang tidak diketahui";
}

function truncateText(text: string | null, max = 60): string {
  if (!text) {
    return "—";
  }

  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// customer_wa comes from the bot as a JID like "628123456789@s.whatsapp.net".
function waMeLink(customerWa: string): string {
  const beforeAt = customerWa.split("@")[0] ?? customerWa;
  return `https://wa.me/${beforeAt.replace(/\D/g, "")}`;
}

function DotBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <Badge className={tone.badge}>
      <span aria-hidden className={`size-1.5 rounded-full ${tone.dot}`} />
      {children}
    </Badge>
  );
}

function ProcessingStatusBadge({ status }: { status: string }) {
  const tone = status === "Success" ? TONE_OK : status === "Failed" ? TONE_DOWN : TONE_NEUTRAL;

  return <DotBadge tone={tone}>{processingStatusLabels[status] ?? status}</DotBadge>;
}

function DirectionBadge({ direction }: { direction: MessageDirection }) {
  return (
    <DotBadge tone={direction === "outbound" ? TONE_OK : TONE_NEUTRAL}>
      {directionLabels[direction]}
    </DotBadge>
  );
}

// ---------------------------------------------------------------------------
// Tab "Status & QR"
// ---------------------------------------------------------------------------

function HealthPill({ label, state }: { label: string; state: "ok" | "down" | undefined }) {
  const tone = state === "ok" ? TONE_OK : state === "down" ? TONE_DOWN : TONE_NEUTRAL;
  const text = state === "ok" ? "Aktif" : state === "down" ? "Mati" : "Memeriksa...";

  return (
    <DotBadge tone={tone}>
      {label}: {text}
    </DotBadge>
  );
}

// Thin bar that drains linearly over the QR lifetime; re-keyed per issued QR.
function QrCountdownBar({ durationSeconds }: { durationSeconds: number }) {
  return (
    <div className="h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-cream-200">
      <motion.div
        className="h-full rounded-full bg-pandan-500"
        initial={{ width: "100%" }}
        animate={{ width: "0%" }}
        transition={{ duration: durationSeconds, ease: "linear" }}
      />
    </div>
  );
}

function QrPanel({
  qr,
  qrIssuedAt,
  secondsLeft,
  reloadPending,
  onReload
}: {
  qr: BotLoginResponse;
  qrIssuedAt: number;
  secondsLeft: number;
  reloadPending: boolean;
  onReload: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="overflow-hidden"
    >
      <div className="mt-4 rounded-card border border-cream-200 bg-white p-5 shadow-card">
        {secondsLeft > 0 ? (
          <div className="flex flex-col items-center gap-3">
            <img
              src={qr.qrImageDataUrl}
              alt="QR pairing WhatsApp"
              className="h-56 w-56 max-w-full rounded-xl border border-cream-200"
            />
            <QrCountdownBar key={qrIssuedAt} durationSeconds={qr.durationSeconds} />
            <p className="text-center text-sm text-ink-500">
              Pindai dengan WhatsApp. QR kedaluwarsa dalam{" "}
              <span className="font-semibold text-ink-900 tabular-nums">{secondsLeft}</span> detik.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-2">
            <Button variant="secondary" loading={reloadPending} onClick={onReload}>
              QR kedaluwarsa — muat ulang
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ConnectionSummary({ status }: { status: BotStatusResponse }) {
  const connected = status.connected;

  return (
    <div className="space-y-3">
      {!status.gowaReachable ? (
        <ErrorNote message="GoWA tidak dapat dihubungi — periksa layanan GoWA di server." />
      ) : null}

      <DotBadge tone={connected ? TONE_OK : TONE_DOWN}>
        {connected ? "Terhubung" : "Terputus"}
      </DotBadge>

      {status.devices.length > 0 ? (
        <ul className="space-y-1 text-sm text-ink-500">
          {status.devices.map((device) => (
            <li key={device.device}>
              <span className="font-medium text-ink-900">{device.name}</span> — {device.device}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-500">Tidak ada perangkat yang terhubung.</p>
      )}
    </div>
  );
}

function StatusTab() {
  const queryClient = useQueryClient();
  const [qr, setQr] = useState<BotLoginResponse | null>(null);
  const [qrIssuedAt, setQrIssuedAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const qrActive = qr !== null && secondsLeft > 0;

  const health = useQuery({
    queryKey: ["bot", "health"],
    queryFn: () => api<BotHealthResponse>("/api/bot/health"),
    refetchInterval: 30_000
  });

  // Poll the connection state while a QR is on screen so the page notices the scan.
  const status = useQuery({
    queryKey: ["bot", "status"],
    queryFn: () => api<BotStatusResponse>("/api/bot/status"),
    refetchInterval: qrActive ? 5_000 : false
  });

  const login = useMutation({
    mutationFn: () => api<BotLoginResponse>("/api/bot/login", { method: "POST" }),
    onSuccess: (data) => {
      setQr(data);
      setQrIssuedAt(Date.now());
      setSecondsLeft(data.durationSeconds);
    }
  });

  const reconnect = useMutation({
    mutationFn: () => api<{ ok: boolean }>("/api/bot/reconnect", { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["bot"] });
    }
  });

  const logout = useMutation({
    mutationFn: () => api<{ ok: boolean }>("/api/bot/logout", { method: "POST" }),
    onSuccess: async () => {
      setQr(null);
      await queryClient.invalidateQueries({ queryKey: ["bot"] });
    }
  });

  useEffect(() => {
    if (qr === null) {
      return;
    }

    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [qr]);

  const connected = status.data?.connected === true;

  // Once the scan lands the session is connected — drop the QR view.
  useEffect(() => {
    if (connected) {
      setQr(null);
    }
  }, [connected]);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle className="mb-3">Kesehatan Sistem</CardTitle>
        {health.isError ? (
          <ErrorNote message={`Gagal memuat status kesehatan: ${errorText(health.error)}`} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <HealthPill label="Bot" state={health.data?.bot} />
            <HealthPill label="GoWA" state={health.data?.gowa} />
            <HealthPill label="Database" state={health.data?.db} />
          </div>
        )}
      </Card>

      <Card>
        <CardTitle className="mb-3">Koneksi WhatsApp</CardTitle>

        {status.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-52" />
          </div>
        ) : status.isError ? (
          <ErrorNote message={`Gagal memuat status: ${errorText(status.error)}`} />
        ) : (
          <ConnectionSummary status={status.data} />
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" loading={login.isPending} onClick={() => login.mutate()}>
            {login.isPending ? "Memuat QR..." : "Tampilkan QR"}
          </Button>
          <Button
            variant="secondary"
            loading={reconnect.isPending}
            onClick={() => reconnect.mutate()}
          >
            {reconnect.isPending ? "Menyambungkan..." : "Sambungkan Ulang"}
          </Button>
          <Button
            variant="dangerOutline"
            loading={logout.isPending}
            onClick={() => {
              if (
                window.confirm("Yakin? Bot akan terputus dari WhatsApp dan harus scan QR lagi.")
              ) {
                logout.mutate();
              }
            }}
          >
            {logout.isPending ? "Memutuskan..." : "Putuskan (Logout)"}
          </Button>
        </div>

        {login.isError ? (
          <div className="mt-3">
            <ErrorNote message={`Gagal memuat QR: ${errorText(login.error)}`} />
          </div>
        ) : null}
        {reconnect.isError ? (
          <div className="mt-3">
            <ErrorNote message={`Gagal menyambungkan ulang: ${errorText(reconnect.error)}`} />
          </div>
        ) : null}
        {logout.isError ? (
          <div className="mt-3">
            <ErrorNote message={`Gagal memutuskan: ${errorText(logout.error)}`} />
          </div>
        ) : null}

        <AnimatePresence initial={false}>
          {qr !== null ? (
            <QrPanel
              key="qr-panel"
              qr={qr}
              qrIssuedAt={qrIssuedAt}
              secondsLeft={secondsLeft}
              reloadPending={login.isPending}
              onReload={() => login.mutate()}
            />
          ) : null}
        </AnimatePresence>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab "Perlu Bantuan"
// ---------------------------------------------------------------------------

// Chat-style transcript: customer messages left, bot replies right, so the
// admin can skim the conversation before taking over. The API returns
// newest-first; a chat reads oldest-first, so render reversed.
function RecentMessages({ messages }: { messages: MessageLogItem[] }) {
  if (messages.length === 0) {
    return <p className="mt-2 text-sm text-ink-500">Belum ada pesan tercatat.</p>;
  }

  return (
    <ul className="mt-2 space-y-2">
      {[...messages].reverse().map((message) => {
        const outbound = message.direction === "outbound";

        return (
          <li key={message.messageId} className={outbound ? "flex justify-end" : "flex"}>
            <div
              className={`max-w-[85%] rounded-xl p-3 text-sm ${
                outbound ? "bg-pandan-50" : "bg-cream-100"
              }`}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                <DirectionBadge direction={message.direction} />
                <span>{formatDateTimeJakarta(message.receivedAt)}</span>
                {!outbound ? <ProcessingStatusBadge status={message.processingStatus} /> : null}
              </div>
              <p className="whitespace-pre-wrap text-ink-700">
                {message.messageText ?? "(tanpa teks)"}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function HandoffCard({ item }: { item: HandoffItem }) {
  const { order, recentMessages } = item;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold text-ink-900">
            {order.customerName ?? order.customerWa}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {order.orderId} · {formatDateTimeJakarta(order.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/orders/${order.orderId}`} className={ghostLinkClasses}>
            Lihat Pesanan
          </Link>
          <a
            href={waMeLink(order.customerWa)}
            target="_blank"
            rel="noreferrer"
            className={secondaryLinkClasses}
          >
            Balas via WhatsApp
          </a>
        </div>
      </div>

      <p className="mt-3 text-sm text-ink-700">{order.productsText}</p>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-pandan-700 hover:text-pandan-800">
          Pesan terakhir ({recentMessages.length})
        </summary>
        <RecentMessages messages={recentMessages} />
      </details>
    </Card>
  );
}

function HandoffTab() {
  const handoff = useQuery({
    queryKey: ["bot", "handoff"],
    queryFn: () => api<HandoffResponse>("/api/handoff")
  });

  if (handoff.isPending) {
    return (
      <div className="space-y-3">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </div>
    );
  }

  if (handoff.isError) {
    return <ErrorNote message={`Gagal memuat data: ${errorText(handoff.error)}`} />;
  }

  if (handoff.data.items.length === 0) {
    return (
      <Card>
        <EmptyState emoji="🎉" message="Tidak ada yang perlu bantuan." />
      </Card>
    );
  }

  return (
    <StaggerList className="space-y-3">
      {handoff.data.items.map((item) => (
        <StaggerItem key={item.order.orderId}>
          <HandoffCard item={item} />
        </StaggerItem>
      ))}
    </StaggerList>
  );
}

// ---------------------------------------------------------------------------
// Tab "Log Pesan"
// ---------------------------------------------------------------------------

interface MessageFilters {
  customerWa: string;
  processingStatus: string;
  direction: string;
  from: string;
  to: string;
}

const emptyMessageFilters: MessageFilters = {
  customerWa: "",
  processingStatus: "",
  direction: "inbound",
  from: "",
  to: ""
};

function MessageFilterForm({
  draft,
  onDraftChange,
  onApply,
  onReset
}: {
  draft: MessageFilters;
  onDraftChange: (draft: MessageFilters) => void;
  onApply: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
}) {
  return (
    <form onSubmit={onApply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Field label="Nomor WA">
        <Input
          type="text"
          placeholder="Nomor WA customer"
          value={draft.customerWa}
          onChange={(event) => onDraftChange({ ...draft, customerWa: event.target.value })}
        />
      </Field>
      <Field label="Pengirim">
        <DropUpSelect
          ariaLabel="Pengirim"
          value={draft.direction}
          onChange={(value) => onDraftChange({ ...draft, direction: value })}
          options={DIRECTION_OPTIONS}
        />
      </Field>
      <Field label="Status">
        <DropUpSelect
          ariaLabel="Status"
          value={draft.processingStatus}
          onChange={(value) => onDraftChange({ ...draft, processingStatus: value })}
          options={[
            { value: "", label: "Semua Status" },
            ...PROCESSING_STATUS_OPTIONS.map((value) => ({
              value,
              label: processingStatusLabels[value] ?? value
            }))
          ]}
        />
      </Field>
      <Field label="Dari Tanggal">
        <Input
          type="date"
          value={draft.from}
          onChange={(event) => onDraftChange({ ...draft, from: event.target.value })}
        />
      </Field>
      <Field label="Sampai Tanggal">
        <Input
          type="date"
          value={draft.to}
          onChange={(event) => onDraftChange({ ...draft, to: event.target.value })}
        />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit" variant="primary">
          Terapkan
        </Button>
        <Button variant="secondary" onClick={onReset}>
          Reset
        </Button>
      </div>
    </form>
  );
}

function MessagesTable({ items }: { items: MessageLogItem[] }) {
  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={thLeft}>Waktu</th>
            <th className={thLeft}>Customer</th>
            <th className={thLeft}>Pengirim</th>
            <th className={thLeft}>Tipe</th>
            <th className={thLeft}>Pesan</th>
            <th className={thLeft}>Intent</th>
            <th className={thLeft}>Status</th>
            <th className={thLeft}>Error</th>
          </tr>
        </thead>
        <tbody>
          {items.map((message) => (
            <tr key={message.messageId}>
              <td className={`${tdClass} whitespace-nowrap`}>
                {formatDateTimeJakarta(message.receivedAt)}
              </td>
              <td className={tdClass}>{message.customerWa}</td>
              <td className={tdClass}>
                <DirectionBadge direction={message.direction} />
              </td>
              <td className={tdClass}>{message.messageType}</td>
              <td className={tdClass} title={message.messageText ?? undefined}>
                {truncateText(message.messageText)}
              </td>
              <td className={tdClass}>{message.detectedIntent ?? "—"}</td>
              <td className={tdClass}>
                <ProcessingStatusBadge status={message.processingStatus} />
              </td>
              <td className={tdClass} title={message.errorMessage ?? undefined}>
                {truncateText(message.errorMessage, 40)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MessagesTab() {
  const [draft, setDraft] = useState<MessageFilters>(emptyMessageFilters);
  const [applied, setApplied] = useState<MessageFilters>(emptyMessageFilters);
  const [page, setPage] = useState(1);

  const messages = useQuery({
    queryKey: ["bot", "messages", applied, page],
    queryFn: () =>
      api<MessagesResponse>(
        `/api/messages${buildQuery({
          customerWa: applied.customerWa,
          processingStatus: applied.processingStatus,
          direction: applied.direction,
          from: applied.from,
          to: applied.to,
          page,
          limit: LOG_PAGE_LIMIT
        })}`
      ),
    placeholderData: keepPreviousData
  });

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApplied(draft);
    setPage(1);
  }

  function resetFilters() {
    setDraft(emptyMessageFilters);
    setApplied(emptyMessageFilters);
    setPage(1);
  }

  return (
    <div className="space-y-3">
      <Card>
        <MessageFilterForm
          draft={draft}
          onDraftChange={setDraft}
          onApply={applyFilters}
          onReset={resetFilters}
        />
      </Card>

      {messages.isPending ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : messages.isError ? (
        <ErrorNote message={`Gagal memuat log pesan: ${errorText(messages.error)}`} />
      ) : (
        <Card>
          {messages.data.items.length === 0 ? (
            <EmptyState message="Tidak ada pesan yang cocok dengan filter." />
          ) : (
            <MessagesTable items={messages.data.items} />
          )}
          <Pagination
            page={messages.data.page}
            limit={messages.data.limit}
            total={messages.data.total}
            onPageChange={setPage}
          />
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab "Log AI"
// ---------------------------------------------------------------------------

function AiLogsTable({ items }: { items: AiLogItem[] }) {
  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={thLeft}>Waktu</th>
            <th className={thLeft}>Model</th>
            <th className={thLeft}>Intent</th>
            <th className={thRight}>Confidence</th>
            <th className={thLeft}>Validasi</th>
            <th className={thLeft}>Handoff</th>
            <th className={thRight}>Latency</th>
          </tr>
        </thead>
        <tbody>
          {items.map((log) => (
            <tr key={log.logId}>
              <td className={`${tdClass} whitespace-nowrap`}>
                {formatDateTimeJakarta(log.createdAt)}
              </td>
              <td className={tdClass}>{log.model}</td>
              <td className={tdClass}>{log.intent ?? "—"}</td>
              <td className={`${tdClass} text-right tabular-nums`}>
                {log.confidence !== null ? log.confidence.toFixed(2) : "—"}
              </td>
              <td className={tdClass}>{log.validationStatus}</td>
              <td className={tdClass}>{log.handoffTriggered ? "Ya" : "Tidak"}</td>
              <td className={`${tdClass} text-right whitespace-nowrap tabular-nums`}>
                {log.latencyMs !== null ? `${log.latencyMs} ms` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AiLogsTab() {
  const [page, setPage] = useState(1);

  const aiLogs = useQuery({
    queryKey: ["bot", "ai-logs", page],
    queryFn: () =>
      api<AiLogsResponse>(`/api/ai-logs${buildQuery({ page, limit: LOG_PAGE_LIMIT })}`),
    placeholderData: keepPreviousData
  });

  if (aiLogs.isPending) {
    return (
      <Card>
        <SkeletonRows rows={6} />
      </Card>
    );
  }

  if (aiLogs.isError) {
    return <ErrorNote message={`Gagal memuat log AI: ${errorText(aiLogs.error)}`} />;
  }

  if (aiLogs.data.total === 0) {
    return (
      <Card>
        <EmptyState
          emoji="🤖"
          message="Bot belum menulis log AI — tabel ini akan terisi setelah fitur bot diaktifkan."
        />
      </Card>
    );
  }

  return (
    <Card>
      <AiLogsTable items={aiLogs.data.items} />
      <Pagination
        page={aiLogs.data.page}
        limit={aiLogs.data.limit}
        total={aiLogs.data.total}
        onPageChange={setPage}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BotOpsPage() {
  const [tab, setTab] = useState<TabKey>("status");

  return (
    <div>
      <Rise>
        <PageHeader
          title="Bot WhatsApp"
          subtitle="Pantau koneksi, log pesan, dan permintaan bantuan pelanggan."
        />
      </Rise>

      <Rise className="mb-4">
        <Tabs items={TAB_ITEMS} activeId={tab} onChange={setTab} />
      </Rise>

      <Rise>
        {tab === "status" ? <StatusTab /> : null}
        {tab === "handoff" ? <HandoffTab /> : null}
        {tab === "messages" ? <MessagesTab /> : null}
        {tab === "ai" ? <AiLogsTab /> : null}
      </Rise>
    </div>
  );
}
