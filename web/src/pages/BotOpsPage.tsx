import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";

import { api, buildQuery } from "../api/client";
import type {
  AiLogsResponse,
  BotHealthResponse,
  BotLoginResponse,
  BotStatusResponse,
  HandoffItem,
  HandoffResponse,
  MessagesResponse
} from "../api/types";
import { Badge, Card, EmptyNote, ErrorNote, Spinner } from "../components/ui";
import { formatDateTimeJakarta } from "../lib/format";

const TABS = [
  { key: "status", label: "Status & QR" },
  { key: "handoff", label: "Perlu Bantuan" },
  { key: "messages", label: "Log Pesan" },
  { key: "ai", label: "Log AI" }
] as const;

type TabKey = (typeof TABS)[number]["key"];

const LOG_PAGE_LIMIT = 25;

const primaryButtonClass =
  "rounded bg-emerald-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50";
const secondaryButtonClass =
  "rounded border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50";
const dangerButtonClass =
  "rounded border border-rose-300 bg-white px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50";
const inputClass = "w-full rounded border border-stone-300 px-2 py-1.5 text-sm";
const thClass = "px-2 py-1.5 text-left font-medium text-stone-600";
const tdClass = "px-2 py-1.5 align-top";

// Local UI copy for the bot's message processing statuses (enum values stay English).
const processingStatusLabels: Record<string, string> = {
  Received: "Diterima",
  Ignored: "Diabaikan",
  Success: "Berhasil",
  Failed: "Gagal",
  Duplicate: "Duplikat",
  Unsupported: "Tidak Didukung"
};

const processingStatusBadgeClasses: Record<string, string> = {
  Received: "bg-sky-100 text-sky-800",
  Ignored: "bg-stone-200 text-stone-600",
  Success: "bg-emerald-100 text-emerald-800",
  Failed: "bg-rose-100 text-rose-800",
  Duplicate: "bg-amber-100 text-amber-800",
  Unsupported: "bg-stone-200 text-stone-600"
};

const PROCESSING_STATUS_OPTIONS = [
  "Received",
  "Ignored",
  "Success",
  "Failed",
  "Duplicate",
  "Unsupported"
];

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

function ProcessingStatusBadge({ status }: { status: string }) {
  return (
    <Badge className={processingStatusBadgeClasses[status] ?? "bg-stone-200 text-stone-600"}>
      {processingStatusLabels[status] ?? status}
    </Badge>
  );
}

function Pager({
  page,
  limit,
  total,
  onPageChange
}: {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <span className="text-stone-500">
        Halaman {page} dari {totalPages} ({total} data)
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Sebelumnya
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Berikutnya
        </button>
      </div>
    </div>
  );
}

function HealthPill({ label, state }: { label: string; state: "ok" | "down" | undefined }) {
  const className =
    state === "ok"
      ? "bg-emerald-100 text-emerald-800"
      : state === "down"
        ? "bg-rose-100 text-rose-800"
        : "bg-stone-200 text-stone-600";
  const text = state === "ok" ? "Aktif" : state === "down" ? "Mati" : "Memeriksa...";

  return (
    <Badge className={className}>
      {label}: {text}
    </Badge>
  );
}

function StatusTab() {
  const queryClient = useQueryClient();
  const [qr, setQr] = useState<BotLoginResponse | null>(null);
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
        <h2 className="mb-3 text-sm font-semibold text-stone-700">Kesehatan Sistem</h2>
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
        <h2 className="mb-3 text-sm font-semibold text-stone-700">Koneksi WhatsApp</h2>

        {status.isPending ? (
          <Spinner label="Memuat status koneksi..." />
        ) : status.isError ? (
          <ErrorNote message={`Gagal memuat status: ${errorText(status.error)}`} />
        ) : (
          <div className="space-y-3">
            {!status.data.gowaReachable ? (
              <ErrorNote message="GoWA tidak dapat dihubungi — periksa layanan GoWA di server." />
            ) : null}

            <div className="flex items-center gap-2">
              <Badge
                className={
                  connected ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                }
              >
                {connected ? "Terhubung" : "Terputus"}
              </Badge>
            </div>

            {status.data.devices.length > 0 ? (
              <ul className="space-y-1 text-sm text-stone-600">
                {status.data.devices.map((device) => (
                  <li key={device.device}>
                    <span className="font-medium text-stone-800">{device.name}</span> —{" "}
                    {device.device}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">Tidak ada perangkat yang terhubung.</p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={primaryButtonClass}
            disabled={login.isPending}
            onClick={() => login.mutate()}
          >
            {login.isPending ? "Memuat QR..." : "Tampilkan QR"}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={reconnect.isPending}
            onClick={() => reconnect.mutate()}
          >
            {reconnect.isPending ? "Menyambungkan..." : "Sambungkan Ulang"}
          </button>
          <button
            type="button"
            className={dangerButtonClass}
            disabled={logout.isPending}
            onClick={() => {
              if (
                window.confirm("Yakin? Bot akan terputus dari WhatsApp dan harus scan QR lagi.")
              ) {
                logout.mutate();
              }
            }}
          >
            {logout.isPending ? "Memutuskan..." : "Putuskan (Logout)"}
          </button>
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

        {qr !== null ? (
          <div className="mt-4 flex flex-col items-center gap-2">
            {secondsLeft > 0 ? (
              <>
                <img
                  src={qr.qrImageDataUrl}
                  alt="QR pairing WhatsApp"
                  className="h-56 w-56 rounded border border-stone-200"
                />
                <p className="text-sm text-stone-600">
                  Pindai dengan WhatsApp. QR kedaluwarsa dalam {secondsLeft} detik.
                </p>
              </>
            ) : (
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={login.isPending}
                onClick={() => login.mutate()}
              >
                QR kedaluwarsa — muat ulang
              </button>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function HandoffCard({ item }: { item: HandoffItem }) {
  const { order, recentMessages } = item;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-stone-800">
            {order.customerName ?? order.customerWa}
          </p>
          <p className="text-xs text-stone-500">
            {order.orderId} · {formatDateTimeJakarta(order.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/orders/${order.orderId}`}
            className="rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
          >
            Lihat Pesanan
          </Link>
          <a
            href={waMeLink(order.customerWa)}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
          >
            Balas via WhatsApp
          </a>
        </div>
      </div>

      <p className="mt-2 text-sm text-stone-700">{order.productsText}</p>

      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-emerald-800">
          Pesan terakhir ({recentMessages.length})
        </summary>
        {recentMessages.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Belum ada pesan tercatat.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recentMessages.map((message) => (
              <li key={message.messageId} className="rounded bg-stone-50 p-2 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  <span>{formatDateTimeJakarta(message.receivedAt)}</span>
                  <ProcessingStatusBadge status={message.processingStatus} />
                </div>
                <p className="whitespace-pre-wrap text-stone-700">
                  {message.messageText ?? "(tanpa teks)"}
                </p>
              </li>
            ))}
          </ul>
        )}
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
    return <Spinner label="Memuat daftar bantuan..." />;
  }

  if (handoff.isError) {
    return <ErrorNote message={`Gagal memuat data: ${errorText(handoff.error)}`} />;
  }

  if (handoff.data.items.length === 0) {
    return <EmptyNote message="Tidak ada yang perlu bantuan 🎉" />;
  }

  return (
    <div className="space-y-3">
      {handoff.data.items.map((item) => (
        <HandoffCard key={item.order.orderId} item={item} />
      ))}
    </div>
  );
}

interface MessageFilters {
  customerWa: string;
  processingStatus: string;
  from: string;
  to: string;
}

const emptyMessageFilters: MessageFilters = {
  customerWa: "",
  processingStatus: "",
  from: "",
  to: ""
};

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

  return (
    <div className="space-y-3">
      <Card>
        <form onSubmit={applyFilters} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input
            type="text"
            className={inputClass}
            placeholder="Nomor WA customer"
            value={draft.customerWa}
            onChange={(event) => setDraft({ ...draft, customerWa: event.target.value })}
          />
          <select
            className={inputClass}
            value={draft.processingStatus}
            onChange={(event) => setDraft({ ...draft, processingStatus: event.target.value })}
          >
            <option value="">Semua Status</option>
            {PROCESSING_STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {processingStatusLabels[value] ?? value}
              </option>
            ))}
          </select>
          <input
            type="date"
            className={inputClass}
            aria-label="Dari tanggal"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
          <input
            type="date"
            className={inputClass}
            aria-label="Sampai tanggal"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
          <div className="flex gap-2">
            <button type="submit" className={primaryButtonClass}>
              Terapkan
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => {
                setDraft(emptyMessageFilters);
                setApplied(emptyMessageFilters);
                setPage(1);
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </Card>

      {messages.isPending ? (
        <Spinner label="Memuat log pesan..." />
      ) : messages.isError ? (
        <ErrorNote message={`Gagal memuat log pesan: ${errorText(messages.error)}`} />
      ) : (
        <Card>
          {messages.data.items.length === 0 ? (
            <EmptyNote message="Tidak ada pesan yang cocok dengan filter." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200">
                    <th className={thClass}>Waktu</th>
                    <th className={thClass}>Customer</th>
                    <th className={thClass}>Tipe</th>
                    <th className={thClass}>Pesan</th>
                    <th className={thClass}>Intent</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.data.items.map((message) => (
                    <tr key={message.messageId} className="border-b border-stone-100">
                      <td className={`${tdClass} whitespace-nowrap`}>
                        {formatDateTimeJakarta(message.receivedAt)}
                      </td>
                      <td className={tdClass}>{message.customerWa}</td>
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
          )}
          <Pager
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

function AiLogsTab() {
  const [page, setPage] = useState(1);

  const aiLogs = useQuery({
    queryKey: ["bot", "ai-logs", page],
    queryFn: () =>
      api<AiLogsResponse>(`/api/ai-logs${buildQuery({ page, limit: LOG_PAGE_LIMIT })}`),
    placeholderData: keepPreviousData
  });

  if (aiLogs.isPending) {
    return <Spinner label="Memuat log AI..." />;
  }

  if (aiLogs.isError) {
    return <ErrorNote message={`Gagal memuat log AI: ${errorText(aiLogs.error)}`} />;
  }

  if (aiLogs.data.total === 0) {
    return (
      <EmptyNote message="Bot belum menulis log AI — tabel ini akan terisi setelah fitur bot diaktifkan." />
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200">
              <th className={thClass}>Waktu</th>
              <th className={thClass}>Model</th>
              <th className={thClass}>Intent</th>
              <th className={thClass}>Confidence</th>
              <th className={thClass}>Validasi</th>
              <th className={thClass}>Handoff</th>
              <th className={thClass}>Latency</th>
            </tr>
          </thead>
          <tbody>
            {aiLogs.data.items.map((log) => (
              <tr key={log.logId} className="border-b border-stone-100">
                <td className={`${tdClass} whitespace-nowrap`}>
                  {formatDateTimeJakarta(log.createdAt)}
                </td>
                <td className={tdClass}>{log.model}</td>
                <td className={tdClass}>{log.intent ?? "—"}</td>
                <td className={tdClass}>
                  {log.confidence !== null ? log.confidence.toFixed(2) : "—"}
                </td>
                <td className={tdClass}>{log.validationStatus}</td>
                <td className={tdClass}>{log.handoffTriggered ? "Ya" : "Tidak"}</td>
                <td className={tdClass}>{log.latencyMs !== null ? `${log.latencyMs} ms` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager
        page={aiLogs.data.page}
        limit={aiLogs.data.limit}
        total={aiLogs.data.total}
        onPageChange={setPage}
      />
    </Card>
  );
}

export function BotOpsPage() {
  const [tab, setTab] = useState<TabKey>("status");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-stone-200 pb-2">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`rounded px-3 py-1.5 text-sm ${
              tab === item.key
                ? "bg-emerald-800 font-medium text-white"
                : "text-stone-600 hover:bg-stone-100"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "status" ? <StatusTab /> : null}
      {tab === "handoff" ? <HandoffTab /> : null}
      {tab === "messages" ? <MessagesTab /> : null}
      {tab === "ai" ? <AiLogsTab /> : null}
    </div>
  );
}
