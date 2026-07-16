import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type {
  BusinessProfileEntry,
  BusinessProfileResponse,
  BusinessProfileUpdateResponse
} from "../api/types";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  PageHeader,
  SkeletonCard,
  Tabs,
  Textarea,
  type TabItem
} from "../components/ui";
import { Rise, StaggerItem, StaggerList } from "../components/motion/primitives";
import { formatDateTimeJakarta } from "../lib/format";
import { GofoodSettings } from "./GofoodSettings";

const PROFILE_QUERY_KEY = ["business-profile"] as const;

// Friendly copy for the keys seeded by the bot's migration 004, plus
// business_name (added by the seeder — the contract allows new keys and the bot
// reads every non-empty row). Keys added later still render, with a humanized
// fallback label.
const PROFILE_FIELDS: { key: string; label: string; hint: string }[] = [
  {
    key: "business_name",
    label: "Nama Usaha",
    hint: "Nama yang dipakai bot saat memperkenalkan diri ke pelanggan."
  },
  {
    key: "opening_hours",
    label: "Jam Buka",
    hint: "Contoh: Senin–Sabtu 08.00–17.00, Minggu libur."
  },
  {
    key: "store_address",
    label: "Alamat Toko",
    hint: "Alamat lengkap yang dikirim ke pelanggan."
  },
  {
    key: "delivery_area",
    label: "Area Pengantaran",
    hint: "Contoh: Sekitar Cimahi & Bandung barat, maks. 10 km."
  },
  {
    key: "delivery_eta",
    label: "Estimasi Waktu Antar",
    hint: "Contoh: 45–60 menit setelah pesanan dikonfirmasi."
  },
  {
    key: "contact_info",
    label: "Kontak",
    hint: "Nomor WA/telepon admin yang boleh dihubungi pelanggan."
  },
  {
    key: "promos",
    label: "Promo",
    hint: "Promo yang sedang berjalan. Kosongkan jika tidak ada."
  },
  {
    key: "about",
    label: "Tentang Usaha",
    hint: "Cerita singkat tentang Dapoer Mami Fasola."
  }
];

function humanizeKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// Known keys first in curated order, then any extra rows the table gained.
function orderEntries(
  items: BusinessProfileEntry[]
): { entry: BusinessProfileEntry; label: string; hint?: string }[] {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const known = PROFILE_FIELDS.flatMap((field) => {
    const entry = byKey.get(field.key);
    return entry ? [{ entry, label: field.label, hint: field.hint }] : [];
  });
  const knownKeys = new Set(PROFILE_FIELDS.map((field) => field.key));
  const extras = items
    .filter((item) => !knownKeys.has(item.key))
    .map((entry) => ({ entry, label: humanizeKey(entry.key) }));

  return [...known, ...extras];
}

function ProfileFieldCard({
  entry,
  label,
  hint
}: {
  entry: BusinessProfileEntry;
  label: string;
  hint?: string;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(entry.value);

  const update = useMutation({
    mutationFn: (value: string) =>
      api<BusinessProfileUpdateResponse>(
        `/api/business-profile/${encodeURIComponent(entry.key)}`,
        { method: "PUT", body: { value } }
      ),
    onSuccess: ({ item }) => {
      // The server trims the value; adopt its version so dirty resets.
      setDraft(item.value);
      queryClient.setQueryData<BusinessProfileResponse>(PROFILE_QUERY_KEY, (old) =>
        old
          ? { items: old.items.map((existing) => (existing.key === item.key ? item : existing)) }
          : old
      );
    }
  });

  const dirty = draft !== entry.value;

  return (
    <Card>
      <Field label={label} {...(hint ? { hint } : {})}>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          placeholder="Belum diisi"
        />
      </Field>

      {entry.value.trim() === "" && !dirty ? (
        <p className="mt-2 text-xs text-kunyit-800">
          Belum diisi — bot akan mengalihkan pertanyaan soal ini ke admin.
        </p>
      ) : null}

      {update.isError ? (
        <div className="mt-2">
          <ErrorNote message="Gagal menyimpan. Coba lagi." />
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-ink-400">
          {dirty
            ? "Belum disimpan"
            : update.isSuccess
              ? "Tersimpan ✓"
              : `Diperbarui ${formatDateTimeJakarta(entry.updatedAt)}`}
        </span>
        <div className="flex gap-2">
          {dirty ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDraft(entry.value)}
            >
              Batalkan
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            loading={update.isPending}
            disabled={!dirty}
            onClick={() => update.mutate(draft)}
          >
            Simpan
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }, (_, index) => (
        <SkeletonCard key={index} lines={3} />
      ))}
    </div>
  );
}

function BusinessProfileSection() {
  const profile = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => api<BusinessProfileResponse>("/api/business-profile")
  });

  return (
    <>
      <p className="mb-3 text-sm text-ink-500">
        Bot WhatsApp menjawab pertanyaan pelanggan dari info di bawah ini.
      </p>
      {profile.isPending ? <SettingsSkeleton /> : null}
      {profile.isError ? (
        <ErrorNote message="Gagal memuat info usaha. Coba muat ulang halaman." />
      ) : null}
      {profile.data ? (
        <StaggerList className="space-y-3">
          {orderEntries(profile.data.items).map(({ entry, label, hint }) => (
            <StaggerItem key={entry.key}>
              <ProfileFieldCard entry={entry} label={label} {...(hint ? { hint } : {})} />
            </StaggerItem>
          ))}
        </StaggerList>
      ) : null}
    </>
  );
}

type SettingsTab = "profile" | "gofood";

const SETTINGS_TABS: readonly TabItem<SettingsTab>[] = [
  { id: "profile", label: "Info Usaha" },
  { id: "gofood", label: "GoFood" }
];

export function SettingsPage({ initialTab = "profile" }: { initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  return (
    <div className="mx-auto max-w-2xl">
      <Rise>
        <PageHeader
          title="Setelan"
          subtitle="Info usaha untuk bot WhatsApp dan integrasi GoFood."
        />
      </Rise>

      <div className="mb-4">
        <Tabs items={SETTINGS_TABS} activeId={tab} onChange={setTab} />
      </div>

      {tab === "profile" ? <BusinessProfileSection /> : <GofoodSettings />}
    </div>
  );
}
