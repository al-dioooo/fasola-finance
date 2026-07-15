import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { api } from "../api/client";
import type {
  GofoodSettings as GofoodSettingsData,
  GofoodSettingsResponse,
  GofoodSettingsUpdate,
  GofoodStatusResponse,
  GofoodSubscribeResponse,
  GofoodSyncLogResponse,
  GofoodTestConnectionResponse
} from "../api/types";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  DropUpSelect,
  ErrorNote,
  Field,
  Input,
  SkeletonCard
} from "../components/ui";
import { formatDateTimeJakarta } from "../lib/format";

const SETTINGS_KEY = ["gofood", "settings"] as const;
const STATUS_KEY = ["gofood", "status"] as const;
const SYNC_LOG_KEY = ["gofood", "sync-log"] as const;

const TONE_OK = { badge: "bg-pandan-100 text-pandan-800", dot: "bg-pandan-500" };
const TONE_DOWN = { badge: "bg-sambal-100 text-sambal-800", dot: "bg-sambal-500" };
const TONE_NEUTRAL = { badge: "bg-cream-200 text-ink-500", dot: "bg-ink-400" };

function Pill({ tone, children }: { tone: typeof TONE_OK; children: ReactNode }) {
  return (
    <Badge className={tone.badge}>
      <span aria-hidden className={`size-1.5 rounded-full ${tone.dot}`} />
      {children}
    </Badge>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Terjadi kesalahan.";
}

export function GofoodSettings() {
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api<GofoodSettingsResponse>("/api/gofood/settings")
  });

  return (
    <div className="space-y-4">
      <GofoodStatusCard />

      {settings.isPending ? <SkeletonCard lines={5} /> : null}
      {settings.isError ? (
        <ErrorNote message="Gagal memuat pengaturan GoFood. Coba muat ulang halaman." />
      ) : null}
      {settings.data ? <GofoodSettingsForm settings={settings.data.settings} /> : null}

      <GofoodSubscribeCard />
      <GofoodSyncLogCard />
      <GofoodHelpCard />
    </div>
  );
}

function GofoodStatusCard() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => api<GofoodStatusResponse>("/api/gofood/status"),
    refetchInterval: 30_000
  });

  const test = useMutation({
    mutationFn: () => api<GofoodTestConnectionResponse>("/api/gofood/test-connection", { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    }
  });

  const data = status.data;

  return (
    <Card>
      <CardTitle>Status Koneksi</CardTitle>
      <div className="mt-3 flex flex-wrap gap-2">
        {status.isPending ? (
          <Pill tone={TONE_NEUTRAL}>Memeriksa...</Pill>
        ) : (
          <>
            <Pill tone={data?.botReachable ? TONE_OK : TONE_DOWN}>
              Bot: {data?.botReachable ? "Terhubung" : "Tidak terhubung"}
            </Pill>
            <Pill tone={data?.enabled ? TONE_OK : TONE_NEUTRAL}>
              {data?.enabled ? "Aktif" : "Nonaktif"}
            </Pill>
            <Pill tone={data?.configured ? TONE_OK : TONE_DOWN}>
              {data?.configured ? "Kredensial lengkap" : "Kredensial belum lengkap"}
            </Pill>
            <Pill tone={TONE_NEUTRAL}>
              {data?.environment === "production" ? "Produksi" : "Sandbox"}
            </Pill>
            <Pill tone={data?.signatureVerification ? TONE_OK : TONE_NEUTRAL}>
              Verifikasi tanda tangan: {data?.signatureVerification ? "Aktif" : "Mati"}
            </Pill>
          </>
        )}
      </div>

      {status.data && !status.data.botReachable ? (
        <div className="mt-3">
          <ErrorNote message="Order-bot tidak dapat dihubungi. Pastikan layanan bot berjalan dan BOT_INTERNAL_TOKEN cocok." />
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-3">
        <Button type="button" variant="secondary" size="sm" loading={test.isPending} onClick={() => test.mutate()}>
          Tes Koneksi
        </Button>
        {test.data ? (
          <span className={`text-xs font-semibold ${test.data.ok ? "text-pandan-800" : "text-sambal-700"}`}>
            {test.data.message || (test.data.ok ? "Berhasil." : "Gagal.")}
          </span>
        ) : null}
        {test.isError ? <span className="text-xs text-sambal-700">{errorText(test.error)}</span> : null}
      </div>
    </Card>
  );
}

function GofoodSettingsForm({ settings }: { settings: GofoodSettingsData }) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState(settings.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [partnerId, setPartnerId] = useState(settings.partnerId);
  const [outletId, setOutletId] = useState(settings.outletId);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [environment, setEnvironment] = useState(settings.environment);

  const save = useMutation({
    mutationFn: (patch: GofoodSettingsUpdate) =>
      api<GofoodSettingsResponse>("/api/gofood/settings", { method: "PUT", body: patch }),
    onSuccess: () => {
      setClientSecret("");
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    }
  });

  function handleSave() {
    const patch: GofoodSettingsUpdate = {
      clientId: clientId.trim(),
      partnerId: partnerId.trim(),
      outletId: outletId.trim(),
      enabled,
      environment
    };
    if (clientSecret.trim().length > 0) {
      patch.clientSecret = clientSecret.trim();
    }
    save.mutate(patch);
  }

  return (
    <Card>
      <CardTitle>Kredensial GoFood</CardTitle>
      <p className="mt-1 text-xs text-ink-400">
        Ambil dari GoBiz Developer Portal (login sebagai pemilik outlet GoFood).
      </p>

      <div className="mt-3 space-y-3">
        <Field label="App ID (Client ID)">
          <Input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="App ID" />
        </Field>

        <Field
          label="Secret (Client Secret)"
          hint={
            settings.secretSet
              ? `Tersimpan (••••${settings.secretLast4 ?? ""}). Biarkan kosong agar tidak diubah.`
              : "Belum diisi."
          }
        >
          <Input
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder={settings.secretSet ? "••••••••" : "Secret"}
            autoComplete="off"
          />
        </Field>

        <Field label="Partner ID">
          <Input value={partnerId} onChange={(event) => setPartnerId(event.target.value)} placeholder="Partner ID" />
        </Field>

        <Field label="Outlet ID">
          <Input value={outletId} onChange={(event) => setOutletId(event.target.value)} placeholder="Outlet ID" />
        </Field>

        <Field label="Lingkungan">
          <DropUpSelect
            ariaLabel="Lingkungan"
            value={environment}
            onChange={(value) => setEnvironment(value === "production" ? "production" : "sandbox")}
            options={[
              { value: "sandbox", label: "Sandbox (uji coba)" },
              { value: "production", label: "Produksi" }
            ]}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm font-semibold text-ink-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="size-4 rounded border-cream-300"
          />
          Aktifkan integrasi GoFood
        </label>
      </div>

      {save.isError ? (
        <div className="mt-3">
          <ErrorNote message="Gagal menyimpan pengaturan. Coba lagi." />
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-xs text-ink-400">
          {save.isSuccess
            ? "Tersimpan ✓"
            : settings.updatedAt
              ? `Diperbarui ${formatDateTimeJakarta(settings.updatedAt)}`
              : "Belum pernah disimpan"}
        </span>
        <Button type="button" size="sm" loading={save.isPending} onClick={handleSave}>
          Simpan
        </Button>
      </div>
    </Card>
  );
}

function GofoodSubscribeCard() {
  const [webhookUrl, setWebhookUrl] = useState("");

  const subscribe = useMutation({
    mutationFn: (url: string) =>
      api<GofoodSubscribeResponse>("/api/gofood/subscribe", { method: "POST", body: { webhookUrl: url } })
  });

  const failed = subscribe.data?.results.filter((result) => !result.ok) ?? [];

  return (
    <Card>
      <CardTitle>Daftarkan Webhook</CardTitle>
      <p className="mt-1 text-xs text-ink-400">
        URL publik yang menerima pesanan GoFood, mis. https://…/webhooks/gofood. Lakukan sekali setelah
        kredensial tersimpan.
      </p>

      <div className="mt-3 space-y-3">
        <Field label="URL Webhook">
          <Input
            value={webhookUrl}
            onChange={(event) => setWebhookUrl(event.target.value)}
            placeholder="https://namamu.evergarden.dedyn.io/webhooks/gofood"
          />
        </Field>

        {subscribe.data ? (
          subscribe.data.results.every((result) => result.ok) ? (
            <p className="text-xs font-semibold text-pandan-800">
              Semua event berhasil didaftarkan ✓
            </p>
          ) : (
            <div className="text-xs text-sambal-700">
              <p className="font-semibold">Sebagian event gagal:</p>
              <ul className="mt-1 list-disc pl-4">
                {failed.map((result) => (
                  <li key={result.event}>
                    {result.event}: {result.error ?? "gagal"}
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : null}

        {subscribe.isError ? <ErrorNote message={errorText(subscribe.error)} /> : null}

        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            loading={subscribe.isPending}
            disabled={webhookUrl.trim().length === 0}
            onClick={() => subscribe.mutate(webhookUrl.trim())}
          >
            Daftarkan
          </Button>
        </div>
      </div>
    </Card>
  );
}

function GofoodSyncLogCard() {
  const syncLog = useQuery({
    queryKey: SYNC_LOG_KEY,
    queryFn: () => api<GofoodSyncLogResponse>("/api/gofood/sync-log")
  });

  const items = syncLog.data?.items ?? [];

  return (
    <Card>
      <CardTitle>Riwayat Sinkronisasi Menu</CardTitle>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-ink-400">
          Belum ada. Buka halaman Menu, lalu tekan &ldquo;Sync ke GoFood&rdquo; untuk mengirim menu.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((run) => (
            <li key={run.runId} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-ink-500">{formatDateTimeJakarta(run.startedAt)}</span>
              <span className="font-semibold text-ink-700">
                {run.status} · {run.itemsPushed ?? 0}/{run.itemsTotal ?? 0}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function GofoodHelpCard() {
  return (
    <Card>
      <CardTitle>Petunjuk</CardTitle>
      <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-ink-500">
        <li>Login ke GoBiz Developer Portal sebagai pemilik outlet GoFood yang aktif.</li>
        <li>Buat integrasi baru, salin App ID, Secret, Partner ID, dan Outlet ID ke atas.</li>
        <li>Pilih lingkungan Sandbox untuk uji coba lebih dulu, lalu Produksi saat siap.</li>
        <li>Simpan, tes koneksi, lalu daftarkan URL webhook.</li>
        <li>Pesanan GoFood akan muncul di halaman Pesanan dengan label GoFood.</li>
      </ol>
    </Card>
  );
}
