import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { api, ApiError } from "../api/client";
import type { Product, ProductsResponse, StockStatus } from "../api/types";
import { Badge, Card, EmptyNote, ErrorNote, Spinner } from "../components/ui";
import { formatIDR } from "../lib/format";
import { stockStatusBadgeClasses, stockStatusLabels } from "../lib/labels";

const PRODUCTS_QUERY_KEY = ["products"] as const;

const STOCK_STATUSES: StockStatus[] = ["Available", "Limited", "Sold Out", "Hidden"];

type ProductPatch = { stockStatus: StockStatus } | { price: number };

interface NewProductBody {
  productName: string;
  price: number;
  category: string | null;
  stockStatus: StockStatus;
  aliases: string[];
  variants: string[];
  notes: string | null;
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

const inputClass =
  "w-full rounded border border-stone-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none";

function ProductCard({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceDraft, setPriceDraft] = useState("");

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

  const startPriceEdit = () => {
    setPriceDraft(product.price === null ? "" : String(product.price));
    setEditingPrice(true);
  };

  const handlePriceSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!isValidPriceInput(priceDraft)) {
      return;
    }

    update.mutate({ price: Number(priceDraft) }, { onSuccess: () => setEditingPrice(false) });
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-stone-900">{product.productName}</p>
          <p className="text-xs text-stone-500">
            {product.category ?? "Tanpa kategori"}
            <span className="ml-2 font-mono text-stone-400">{product.productId}</span>
          </p>
        </div>
        <Badge className={stockStatusBadgeClasses[product.stockStatus]}>
          {stockStatusLabels[product.stockStatus]}
        </Badge>
      </div>

      {editingPrice ? (
        <form onSubmit={handlePriceSubmit} className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={priceDraft}
            onChange={(event) => setPriceDraft(event.target.value)}
            autoFocus
            aria-label="Harga baru"
            className="w-32 rounded border border-stone-300 px-2 py-1 text-sm focus:border-emerald-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={update.isPending || !isValidPriceInput(priceDraft)}
            className="rounded bg-emerald-800 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {update.isPending ? "Menyimpan..." : "Simpan"}
          </button>
          <button
            type="button"
            onClick={() => setEditingPrice(false)}
            className="rounded border border-stone-300 px-3 py-1 text-sm text-stone-600 hover:bg-stone-50"
          >
            Batal
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={startPriceEdit}
          title="Ketuk untuk ubah harga"
          className="text-base font-semibold text-emerald-900 underline decoration-dotted underline-offset-4 hover:text-emerald-700"
        >
          {formatIDR(product.price)}
        </button>
      )}

      {product.variants.length > 0 ? (
        <p className="text-xs text-stone-500">Varian: {product.variants.join(", ")}</p>
      ) : null}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-stone-600">Status Stok</span>
        <select
          value={product.stockStatus}
          onChange={(event) => update.mutate({ stockStatus: event.target.value as StockStatus })}
          disabled={update.isPending}
          className="w-full rounded border border-stone-300 px-2 py-1.5 text-sm focus:border-emerald-600 focus:outline-none disabled:opacity-50"
        >
          {STOCK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {stockStatusLabels[status]}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-stone-400">
          Pilih &quot;Disembunyikan&quot; untuk menyembunyikan menu dari pelanggan.
        </span>
      </label>

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
      notes: notes.trim() === "" ? null : notes.trim()
    });
  };

  const errorMessage = create.isError
    ? create.error instanceof ApiError && create.error.status === 409
      ? "Nama menu sudah dipakai"
      : "Gagal menambah menu. Coba lagi."
    : null;

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <form
        onSubmit={handleSubmit}
        className="my-8 w-full max-w-md space-y-3 rounded-lg border border-stone-200 bg-white p-4 shadow-lg sm:my-0"
      >
        <h2 className="text-lg font-semibold text-emerald-900">Tambah Menu</h2>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Nama Menu *</span>
          <input
            type="text"
            value={productName}
            onChange={(event) => setProductName(event.target.value)}
            autoFocus
            required
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Harga (Rp) *</span>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            required
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Kategori</span>
          <input
            type="text"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Status Stok</span>
          <select
            value={stockStatus}
            onChange={(event) => setStockStatus(event.target.value as StockStatus)}
            className={inputClass}
          >
            {STOCK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {stockStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Alias</span>
          <input
            type="text"
            value={aliases}
            onChange={(event) => setAliases(event.target.value)}
            placeholder="Pisahkan dengan koma, mis. risol, risoles"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Varian</span>
          <input
            type="text"
            value={variants}
            onChange={(event) => setVariants(event.target.value)}
            placeholder="Pisahkan dengan koma, mis. ayam, sapi"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Catatan</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            className={inputClass}
          />
        </label>

        {errorMessage ? <ErrorNote message={errorMessage} /> : null}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={create.isPending || !canSubmit}
            className="rounded bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {create.isPending ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function MenuPage() {
  const [showAddForm, setShowAddForm] = useState(false);

  const products = useQuery({
    queryKey: PRODUCTS_QUERY_KEY,
    queryFn: () => api<ProductsResponse>("/api/products")
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-emerald-900">Menu</h2>
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="rounded bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Tambah Menu
        </button>
      </div>

      {products.data && products.data.pendingMenuChanges > 0 ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Ada perubahan menu menunggu konfirmasi di WhatsApp.
        </div>
      ) : null}

      {products.isPending ? <Spinner label="Memuat menu..." /> : null}
      {products.isError ? (
        <ErrorNote message="Gagal memuat menu. Coba muat ulang halaman." />
      ) : null}

      {products.data ? (
        products.data.items.length === 0 ? (
          <EmptyNote message="Belum ada menu." />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {products.data.items.map((product) => (
              <ProductCard key={product.productId} product={product} />
            ))}
          </div>
        )
      ) : null}

      {showAddForm ? <AddProductForm onClose={() => setShowAddForm(false)} /> : null}
    </div>
  );
}
