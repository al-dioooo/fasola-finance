import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";

import { useRef } from "react";

import { api, ApiError } from "../api/client";
import type {
  GofoodStatusResponse,
  GofoodSyncResult,
  GofoodSyncStateResponse,
  Product,
  ProductsResponse,
  StockStatus,
  VariantConfig,
  VariantOption
} from "../api/types";
import {
  Badge,
  Button,
  Card,
  DropUpSelect,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  SkeletonCard,
  StockStatusBadge,
  Textarea
} from "../components/ui";
import { Rise, StaggerItem, StaggerList } from "../components/motion/primitives";
import { formatDateTimeJakarta, formatIDR } from "../lib/format";
import { stockStatusLabels } from "../lib/labels";

const PRODUCTS_QUERY_KEY = ["products"] as const;
const GOFOOD_SYNC_STATE_KEY = ["gofood", "sync-state"] as const;

// Any menu write may make GoFood stale, so refresh the products list and the
// "needs sync" badge together.
async function invalidateMenuQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: GOFOOD_SYNC_STATE_KEY })
  ]);
}

const STOCK_STATUSES: StockStatus[] = ["Available", "Limited", "Sold Out", "Hidden"];

const STOCK_STATUS_OPTIONS = STOCK_STATUSES.map((status) => ({
  value: status,
  label: stockStatusLabels[status]
}));

type ProductPatch =
  | { stockStatus: StockStatus }
  | { price: number }
  | { description: string | null }
  | { stockQuantity: number | null }
  | { variantConfig: VariantConfig };

// "+Rp5.000" / "−Rp2.000" / "" (no delta). Uses a minus sign for reductions.
function formatPriceDelta(delta: number): string {
  if (delta === 0) {
    return "";
  }
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${formatIDR(Math.abs(delta))}`;
}

function variantSummary(options: VariantOption[]): string {
  return options
    .map((option) => {
      const delta = formatPriceDelta(option.priceDelta);
      const parts = [option.name];
      if (delta) {
        parts.push(`(${delta})`);
      }
      if (!option.inStock) {
        parts.push("· habis");
      }
      return parts.join(" ");
    })
    .join(", ");
}

interface NewProductBody {
  productName: string;
  price: number;
  category: string | null;
  stockStatus: StockStatus;
  aliases: string[];
  variants: string[];
  notes: string | null;
  description: string | null;
  stockQuantity: number | null;
}

// "" = untracked (unlimited); otherwise a non-negative integer portion count.
function isValidStockInput(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") {
    return true;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0;
}

function parseStockInput(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed);
}

function stockQuantityLabel(quantity: number | null): string {
  return quantity === null ? "Tak terbatas" : `${quantity} porsi`;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function isValidPriceInput(value: string): boolean {
  if (value.trim() === "") {
    return false;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0;
}

function PendingChangesBanner({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          initial={{ opacity: 0, y: -10, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -10, height: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="overflow-hidden"
        >
          <div className="mb-4 flex items-center gap-3 rounded-card border border-kunyit-200 bg-kunyit-50 px-4 py-3 shadow-card">
            <span aria-hidden className="text-lg">
              ⏳
            </span>
            <p className="text-sm font-medium text-kunyit-800">
              Ada perubahan menu menunggu konfirmasi di WhatsApp.
            </p>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function PriceEditor({
  product,
  onSave,
  onCancel,
  saving
}: {
  product: Product;
  onSave: (price: number) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [priceDraft, setPriceDraft] = useState(
    product.price === null ? "" : String(product.price)
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!isValidPriceInput(priceDraft)) {
      return;
    }

    onSave(Number(priceDraft));
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <Field label="Harga Baru" className="flex-1">
        <Input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={priceDraft}
          onChange={(event) => setPriceDraft(event.target.value)}
          autoFocus
        />
      </Field>
      <Button
        type="submit"
        size="sm"
        loading={saving}
        disabled={!isValidPriceInput(priceDraft)}
        className="min-h-10"
      >
        Simpan
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onCancel} className="min-h-10">
        Batal
      </Button>
    </form>
  );
}

function DescriptionEditor({
  product,
  onSave,
  onCancel,
  saving
}: {
  product: Product;
  onSave: (description: string | null) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(product.description ?? "");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = draft.trim();
    onSave(trimmed === "" ? null : trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Field
        label="Deskripsi"
        hint="Dipakai bot untuk menjawab pertanyaan pelanggan tentang menu ini."
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          autoFocus
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" size="sm" loading={saving}>
          Simpan
        </Button>
      </div>
    </form>
  );
}

function StockQuantityEditor({
  product,
  onSave,
  onCancel,
  saving
}: {
  product: Product;
  onSave: (quantity: number | null) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(
    product.stockQuantity === null ? "" : String(product.stockQuantity)
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!isValidStockInput(draft)) {
      return;
    }
    onSave(parseStockInput(draft));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Field
        label="Stok (porsi)"
        hint="Kosongkan untuk stok tak terbatas. 0 porsi otomatis jadi Habis."
      >
        <div className="flex items-end gap-2">
          <Input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            placeholder="Tak terbatas"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
            className="flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setDraft("")}
            className="min-h-10 whitespace-nowrap"
          >
            Tak terbatas
          </Button>
        </div>
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" size="sm" loading={saving} disabled={!isValidStockInput(draft)}>
          Simpan
        </Button>
      </div>
    </form>
  );
}

interface VariantOptionDraft {
  name: string;
  // Kept as a string so the number field can hold "", "-" mid-typing.
  priceDelta: string;
  inStock: boolean;
}

function parsePriceDelta(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "-") {
    return 0;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : 0;
}

function VariantEditor({
  product,
  onSave,
  onCancel,
  saving
}: {
  product: Product;
  onSave: (config: VariantConfig) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [options, setOptions] = useState<VariantOptionDraft[]>(
    product.variantConfig.options.map((option) => ({
      name: option.name,
      priceDelta: option.priceDelta === 0 ? "" : String(option.priceDelta),
      inStock: option.inStock
    }))
  );
  const [required, setRequired] = useState(product.variantConfig.required);
  const [maxSelectable, setMaxSelectable] = useState(product.variantConfig.maxSelectable);

  const updateOption = (index: number, patch: Partial<VariantOptionDraft>) =>
    setOptions((prev) => prev.map((option, i) => (i === index ? { ...option, ...patch } : option)));
  const addOption = () =>
    setOptions((prev) => [...prev, { name: "", priceDelta: "", inStock: true }]);
  const removeOption = (index: number) =>
    setOptions((prev) => prev.filter((_, i) => i !== index));

  const namedCount = options.filter((option) => option.name.trim().length > 0).length;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const cleaned: VariantOption[] = options
      .filter((option) => option.name.trim().length > 0)
      .map((option) => ({
        name: option.name.trim(),
        priceDelta: parsePriceDelta(option.priceDelta),
        inStock: option.inStock
      }));
    onSave({
      required,
      maxSelectable: Math.min(Math.max(1, maxSelectable), Math.max(1, cleaned.length)),
      options: cleaned
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-ink-700 uppercase">
          Varian &amp; Harga
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={addOption}>
          + Tambah
        </Button>
      </div>

      {options.length === 0 ? (
        <p className="text-xs text-ink-400 italic">
          Belum ada varian. Tambah pilihan (mis. rasa/ukuran) dengan selisih harga untuk GoFood.
        </p>
      ) : (
        <ul className="space-y-2">
          {options.map((option, index) => (
            <li
              key={index}
              className="space-y-2 rounded-xl border border-cream-200 bg-cream-50 p-2.5"
            >
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={option.name}
                  placeholder="Nama varian, mis. Ayam"
                  onChange={(event) => updateOption(index, { name: event.target.value })}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => removeOption(index)}
                  aria-label={`Hapus varian ${option.name || index + 1}`}
                  className="shrink-0 rounded-full px-2 py-1 text-sm text-ink-400 hover:bg-sambal-50 hover:text-sambal-700"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-end gap-3">
                <label className="flex-1">
                  <span className="mb-1 block text-[11px] text-ink-400">Selisih harga (Rp)</span>
                  <Input
                    type="number"
                    step="1"
                    inputMode="numeric"
                    placeholder="0"
                    value={option.priceDelta}
                    onChange={(event) => updateOption(index, { priceDelta: event.target.value })}
                  />
                </label>
                <label className="flex items-center gap-1.5 pb-2.5 text-xs font-semibold text-ink-700">
                  <input
                    type="checkbox"
                    checked={option.inStock}
                    onChange={(event) => updateOption(index, { inStock: event.target.checked })}
                    className="size-4 rounded border-cream-300"
                  />
                  Tersedia
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}

      {namedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
              className="size-4 rounded border-cream-300"
            />
            Wajib dipilih
          </label>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
            Maks. pilihan
            <input
              type="number"
              min="1"
              max={namedCount}
              value={maxSelectable}
              onChange={(event) => setMaxSelectable(Math.max(1, Number(event.target.value) || 1))}
              className="w-16 rounded-lg border border-cream-300 bg-cream-50 px-2 py-1 text-sm"
            />
          </label>
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" size="sm" loading={saving}>
          Simpan
        </Button>
      </div>
    </form>
  );
}

// GoFood requires square PNGs ≤1MB. Center-crop + downscale to a square PNG in
// the browser so the owner can upload any phone photo and the server-side
// validation (PNG + 1:1 + size) always passes.
async function fileToSquarePngBase64(file: File, size = 640): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas tidak didukung di peramban ini.");
    }
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight);
    const dataUrl = canvas.toDataURL("image/png");
    return dataUrl.split(",")[1] ?? "";
  } finally {
    bitmap.close();
  }
}

function ProductImageEditor({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const imageBase64 = await fileToSquarePngBase64(file);
      return api<{ product: Product }>(
        `/api/products/${encodeURIComponent(product.productId)}/image`,
        { method: "POST", body: { imageBase64, contentType: "image/png" } }
      );
    },
    onSuccess: async () => {
      await invalidateMenuQueries(queryClient);
    }
  });

  return (
    <div className="flex items-center gap-3">
      <div className="size-16 shrink-0 overflow-hidden rounded-xl border border-cream-200 bg-cream-100">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.productName}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-xl text-ink-300">🍽️</div>
        )}
      </div>
      <div className="min-w-0">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              upload.mutate(file);
            }
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {product.imageUrl ? "Ganti Foto" : "Tambah Foto"}
        </Button>
        <p className="mt-1 text-[11px] text-ink-400">Untuk GoFood — dipotong jadi persegi otomatis.</p>
        {upload.isError ? (
          <p className="mt-1 text-[11px] text-sambal-700">
            {upload.error instanceof ApiError ? upload.error.message : "Gagal mengunggah foto."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const [editingPrice, setEditingPrice] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingStock, setEditingStock] = useState(false);
  const [editingVariants, setEditingVariants] = useState(false);

  const update = useMutation({
    mutationFn: (patch: ProductPatch) =>
      api<unknown>(`/api/products/${encodeURIComponent(product.productId)}`, {
        method: "PATCH",
        body: patch
      }),
    onSuccess: async () => {
      await invalidateMenuQueries(queryClient);
    }
  });

  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold text-ink-900">
            {product.productName}
          </h3>
          <p className="mt-0.5 text-xs text-ink-400">
            {product.category ?? "Tanpa kategori"}
            <span className="ml-2 font-mono text-[11px] text-ink-300">{product.productId}</span>
          </p>
        </div>
        <StockStatusBadge status={product.stockStatus} />
      </div>

      <ProductImageEditor product={product} />

      <AnimatePresence mode="wait" initial={false}>
        {editingPrice ? (
          <motion.div
            key="price-edit"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <PriceEditor
              product={product}
              saving={update.isPending}
              onCancel={() => setEditingPrice(false)}
              onSave={(price) =>
                update.mutate({ price }, { onSuccess: () => setEditingPrice(false) })
              }
            />
          </motion.div>
        ) : (
          <motion.button
            key="price-view"
            type="button"
            onClick={() => setEditingPrice(true)}
            title="Ketuk untuk ubah harga"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="min-h-10 self-start rounded-lg font-display text-2xl font-semibold text-pandan-800 tabular-nums underline decoration-pandan-300 decoration-dotted underline-offset-4 hover:text-pandan-600"
          >
            {formatIDR(product.price)}
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {editingVariants ? (
          <motion.div
            key="variants-edit"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <VariantEditor
              product={product}
              saving={update.isPending}
              onCancel={() => setEditingVariants(false)}
              onSave={(variantConfig) =>
                update.mutate({ variantConfig }, { onSuccess: () => setEditingVariants(false) })
              }
            />
          </motion.div>
        ) : (
          <motion.button
            key="variants-view"
            type="button"
            onClick={() => setEditingVariants(true)}
            title="Ketuk untuk ubah varian & harga"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="rounded-lg text-left hover:bg-cream-100"
          >
            <span className="block text-xs font-semibold tracking-wide text-ink-700 uppercase">
              Varian
            </span>
            {product.variantConfig.options.length > 0 ? (
              <span className="mt-0.5 block text-xs text-ink-500">
                {variantSummary(product.variantConfig.options)}
              </span>
            ) : (
              <span className="mt-0.5 block text-xs text-ink-300 italic">
                Belum ada varian — ketuk untuk menambah.
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {editingDescription ? (
          <motion.div
            key="description-edit"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <DescriptionEditor
              product={product}
              saving={update.isPending}
              onCancel={() => setEditingDescription(false)}
              onSave={(description) =>
                update.mutate({ description }, { onSuccess: () => setEditingDescription(false) })
              }
            />
          </motion.div>
        ) : (
          <motion.button
            key="description-view"
            type="button"
            onClick={() => setEditingDescription(true)}
            title="Ketuk untuk ubah deskripsi"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="rounded-lg text-left hover:bg-cream-100"
          >
            <span className="block text-xs font-semibold tracking-wide text-ink-700 uppercase">
              Deskripsi
            </span>
            {product.description ? (
              <span className="mt-0.5 block text-xs text-ink-500">{product.description}</span>
            ) : (
              <span className="mt-0.5 block text-xs text-ink-300 italic">
                Belum ada deskripsi — ketuk untuk menambah.
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {editingStock ? (
          <motion.div
            key="stock-edit"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <StockQuantityEditor
              product={product}
              saving={update.isPending}
              onCancel={() => setEditingStock(false)}
              onSave={(stockQuantity) =>
                update.mutate({ stockQuantity }, { onSuccess: () => setEditingStock(false) })
              }
            />
          </motion.div>
        ) : (
          <motion.button
            key="stock-view"
            type="button"
            onClick={() => setEditingStock(true)}
            title="Ketuk untuk ubah jumlah stok"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="rounded-lg text-left hover:bg-cream-100"
          >
            <span className="block text-xs font-semibold tracking-wide text-ink-700 uppercase">
              Stok
            </span>
            <span className="mt-0.5 block text-xs text-ink-500">
              {stockQuantityLabel(product.stockQuantity)} — ketuk untuk ubah.
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      <div className="mt-auto">
        <Field
          label="Status Stok"
          hint='Pilih "Disembunyikan" untuk menyembunyikan menu dari pelanggan.'
        >
          <DropUpSelect
            ariaLabel="Status Stok"
            value={product.stockStatus}
            onChange={(value) => update.mutate({ stockStatus: value as StockStatus })}
            disabled={update.isPending}
            options={STOCK_STATUS_OPTIONS}
          />
        </Field>
      </div>

      {update.isError ? <ErrorNote message="Gagal menyimpan perubahan. Coba lagi." /> : null}
    </Card>
  );
}

function AddProductForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [stockStatus, setStockStatus] = useState<StockStatus>("Available");
  const [stock, setStock] = useState("");
  const [aliases, setAliases] = useState("");
  const [variants, setVariants] = useState("");
  const [notes, setNotes] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: (body: NewProductBody) => api<unknown>("/api/products", { method: "POST", body }),
    onSuccess: async () => {
      await invalidateMenuQueries(queryClient);
      onClose();
    }
  });

  const canSubmit =
    productName.trim().length > 0 && isValidPriceInput(price) && isValidStockInput(stock);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    create.mutate({
      productName: productName.trim(),
      price: Number(price),
      category: category.trim() === "" ? null : category.trim(),
      stockStatus,
      aliases: splitList(aliases),
      variants: splitList(variants),
      notes: notes.trim() === "" ? null : notes.trim(),
      description: description.trim() === "" ? null : description.trim(),
      stockQuantity: parseStockInput(stock)
    });
  };

  const errorMessage = create.isError
    ? create.error instanceof ApiError && create.error.status === 409
      ? "Nama menu sudah dipakai"
      : "Gagal menambah menu. Coba lagi."
    : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5">
      <Field label="Nama Menu *">
        <Input
          type="text"
          value={productName}
          onChange={(event) => setProductName(event.target.value)}
          autoFocus
          required
        />
      </Field>

      <Field label="Harga (Rp) *">
        <Input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          required
        />
      </Field>

      <Field label="Kategori">
        <Input
          type="text"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        />
      </Field>

      <Field label="Status Stok">
        <DropUpSelect
          ariaLabel="Status Stok"
          value={stockStatus}
          onChange={(value) => setStockStatus(value as StockStatus)}
          options={STOCK_STATUS_OPTIONS}
        />
      </Field>

      <Field label="Stok (porsi)" hint="Kosongkan untuk stok tak terbatas.">
        <Input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          placeholder="Tak terbatas"
          value={stock}
          onChange={(event) => setStock(event.target.value)}
        />
      </Field>

      <Field label="Alias">
        <Input
          type="text"
          value={aliases}
          onChange={(event) => setAliases(event.target.value)}
          placeholder="Pisahkan dengan koma, mis. risol, risoles"
        />
      </Field>

      <Field label="Varian">
        <Input
          type="text"
          value={variants}
          onChange={(event) => setVariants(event.target.value)}
          placeholder="Pisahkan dengan koma, mis. ayam, sapi"
        />
      </Field>

      <Field
        label="Deskripsi"
        hint="Dipakai bot untuk menjawab pertanyaan pelanggan tentang menu ini."
      >
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
        />
      </Field>

      <Field label="Catatan">
        <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
      </Field>

      {errorMessage ? <ErrorNote message={errorMessage} /> : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" loading={create.isPending} disabled={!canSubmit}>
          Simpan
        </Button>
      </div>
    </form>
  );
}

function GofoodSyncBar() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["gofood", "status"],
    queryFn: () => api<GofoodStatusResponse>("/api/gofood/status"),
    staleTime: 30_000
  });

  const syncState = useQuery({
    queryKey: GOFOOD_SYNC_STATE_KEY,
    queryFn: () => api<GofoodSyncStateResponse>("/api/gofood/sync-state"),
    staleTime: 15_000
  });

  const sync = useMutation({
    mutationFn: () => api<GofoodSyncResult>("/api/gofood/sync-menu", { method: "POST" }),
    onSuccess: async () => {
      // A push updates "last synced", so the needs-sync badge should re-evaluate.
      await queryClient.invalidateQueries({ queryKey: GOFOOD_SYNC_STATE_KEY });
    }
  });

  // Only surface the control once GoFood is set up.
  if (!status.data?.enabled || !status.data.configured) {
    return null;
  }

  const result = sync.data;
  const issues = result ? [...result.excluded, ...result.warnings] : [];
  const needsSync = syncState.data?.syncNeeded ?? false;

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-ink-900">Sinkronkan menu ke GoFood</p>
            {syncState.data ? (
              needsSync ? (
                <Badge className="bg-kunyit-100 text-kunyit-800">
                  <span aria-hidden className="size-1.5 rounded-full bg-kunyit-500" />
                  Perlu sinkron
                </Badge>
              ) : (
                <Badge className="bg-pandan-100 text-pandan-800">
                  <span aria-hidden className="size-1.5 rounded-full bg-pandan-500" />
                  Tersinkron
                </Badge>
              )
            ) : null}
          </div>
          <p className="text-xs text-ink-400">
            {needsSync
              ? "Menu berubah sejak sinkron terakhir — kirim ulang agar GoFood ikut terbarui."
              : syncState.data?.lastSyncAt
                ? `Terakhir sinkron ${formatDateTimeJakarta(syncState.data.lastSyncAt)}.`
                : "Kirim menu, harga, stok, dan foto saat ini ke outlet GoFood Anda."}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={needsSync ? "primary" : "secondary"}
          loading={sync.isPending}
          onClick={() => sync.mutate()}
        >
          Sync ke GoFood
        </Button>
      </div>

      {sync.isError ? (
        <div className="mt-3">
          <ErrorNote message="Gagal menyinkronkan. Pastikan order-bot berjalan." />
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 text-xs">
          <p className="font-semibold text-ink-700">
            {result.status === "success" || result.status === "partial"
              ? `${result.itemsPushed}/${result.itemsTotal} menu terkirim.`
              : result.status === "no_items"
                ? "Tidak ada menu yang bisa dikirim."
                : result.status === "not_configured"
                  ? "Kredensial GoFood belum lengkap (atur di Setelan)."
                  : `Gagal: ${result.error ?? "kesalahan tidak diketahui"}.`}
          </p>
          {issues.length > 0 ? (
            <ul className="mt-1 list-disc pl-4 text-ink-500">
              {issues.map((issue) => (
                <li key={`${issue.productId}-${issue.reason}`}>
                  {issue.name || issue.productId}: {syncIssueLabel(issue.reason)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function syncIssueLabel(reason: string): string {
  switch (reason) {
    case "hidden":
      return "disembunyikan, tidak dikirim";
    case "missing_price":
      return "belum ada harga, tidak dikirim";
    case "missing_image":
      return "belum ada foto";
    default:
      return reason;
  }
}

function MenuGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => (
        <SkeletonCard key={index} lines={4} />
      ))}
    </div>
  );
}

function ProductGrid({ products }: { products: Product[] }) {
  return (
    <StaggerList className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => (
        <StaggerItem key={product.productId}>
          <ProductCard product={product} />
        </StaggerItem>
      ))}
    </StaggerList>
  );
}

export function MenuPage() {
  const [showAddForm, setShowAddForm] = useState(false);

  const products = useQuery({
    queryKey: PRODUCTS_QUERY_KEY,
    queryFn: () => api<ProductsResponse>("/api/products")
  });

  return (
    <div>
      <Rise>
        <PageHeader
          title="Menu"
          actions={<Button onClick={() => setShowAddForm(true)}>Tambah Menu</Button>}
        />
      </Rise>

      <PendingChangesBanner
        visible={Boolean(products.data && products.data.pendingMenuChanges > 0)}
      />

      <GofoodSyncBar />

      <Rise>
        {products.isPending ? <MenuGridSkeleton /> : null}
        {products.isError ? (
          <ErrorNote message="Gagal memuat menu. Coba muat ulang halaman." />
        ) : null}
        {products.data ? (
          products.data.items.length === 0 ? (
            <EmptyState emoji="🍳" message="Belum ada menu.">
              <Button className="mt-1" onClick={() => setShowAddForm(true)}>
                Tambah Menu
              </Button>
            </EmptyState>
          ) : (
            <ProductGrid products={products.data.items} />
          )
        ) : null}
      </Rise>

      <Modal open={showAddForm} onClose={() => setShowAddForm(false)} title="Tambah Menu">
        <AddProductForm onClose={() => setShowAddForm(false)} />
      </Modal>
    </div>
  );
}
