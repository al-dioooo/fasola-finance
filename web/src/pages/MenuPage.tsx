import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";

import { api, ApiError } from "../api/client";
import type { Product, ProductsResponse, StockStatus } from "../api/types";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  SkeletonCard,
  StockStatusBadge,
  Textarea
} from "../components/ui";
import { Rise, StaggerItem, StaggerList } from "../components/motion/primitives";
import { formatIDR } from "../lib/format";
import { stockStatusLabels } from "../lib/labels";

const PRODUCTS_QUERY_KEY = ["products"] as const;

const STOCK_STATUSES: StockStatus[] = ["Available", "Limited", "Sold Out", "Hidden"];

type ProductPatch =
  | { stockStatus: StockStatus }
  | { price: number }
  | { description: string | null };

interface NewProductBody {
  productName: string;
  price: number;
  category: string | null;
  stockStatus: StockStatus;
  aliases: string[];
  variants: string[];
  notes: string | null;
  description: string | null;
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

function ProductCard({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const [editingPrice, setEditingPrice] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);

  const update = useMutation({
    mutationFn: (patch: ProductPatch) =>
      api<unknown>(`/api/products/${encodeURIComponent(product.productId)}`, {
        method: "PATCH",
        body: patch
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
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

      {product.variants.length > 0 ? (
        <p className="text-xs text-ink-500">Varian: {product.variants.join(", ")}</p>
      ) : null}

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

      <div className="mt-auto">
        <Field
          label="Status Stok"
          hint='Pilih "Disembunyikan" untuk menyembunyikan menu dari pelanggan.'
        >
          <Select
            value={product.stockStatus}
            onChange={(event) => update.mutate({ stockStatus: event.target.value as StockStatus })}
            disabled={update.isPending}
          >
            {STOCK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {stockStatusLabels[status]}
              </option>
            ))}
          </Select>
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
  const [aliases, setAliases] = useState("");
  const [variants, setVariants] = useState("");
  const [notes, setNotes] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: (body: NewProductBody) => api<unknown>("/api/products", { method: "POST", body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
      onClose();
    }
  });

  const canSubmit = productName.trim().length > 0 && isValidPriceInput(price);

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
      description: description.trim() === "" ? null : description.trim()
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
        <Select
          value={stockStatus}
          onChange={(event) => setStockStatus(event.target.value as StockStatus)}
        >
          {STOCK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {stockStatusLabels[status]}
            </option>
          ))}
        </Select>
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
