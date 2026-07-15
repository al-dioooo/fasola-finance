import type { Db } from "../../db/client.js";
import type { StockStatus } from "../../shared/enums.js";
import {
  buildVariantConfig,
  serializeVariantConfig,
  type VariantConfig
} from "./variant.js";

// DTO shape matches web/src/api/types.ts Product. Semantics mirror the bot's
// product store (fasola-order-bot/src/modules/products/product.store.ts):
// aliases/variants stored as JSON text, is_available derived from stock
// status, updated_at as ISO-8601 UTC text.
export interface ProductRecord {
  productId: string;
  productName: string;
  aliases: string[];
  category: string | null;
  price: number | null;
  stockStatus: StockStatus;
  isAvailable: boolean;
  // Flat variant name list (mirrors the bot's variants_json); kept for display
  // and as the identity the bot reads. variantConfig augments these with pricing.
  variants: string[];
  notes: string | null;
  // Customer-facing copy the bot quotes when answering "what's in this dish".
  description: string | null;
  // Exact portion count; null = not tracked. Both writers may set it (bot via
  // /menu qty=, dashboard via UI). Kept coherent with stockStatus (see
  // reconcileStock, mirroring the bot's product store).
  stockQuantity: number | null;
  // Public image URL for the GoFood catalog; set via the image upload flow.
  imageUrl: string | null;
  // Per-variant price delta / stock + selection rules for GoFood. Merged view of
  // variants_json (names) + variant_pricing_json (dashboard-owned). options is
  // always one-per-name in `variants`.
  variantConfig: VariantConfig;
  updatedAt: string;
}

export interface CreateProductInput {
  productName: string;
  price: number;
  stockStatus: StockStatus;
  category?: string | null | undefined;
  aliases?: string[] | undefined;
  variants?: string[] | undefined;
  notes?: string | null | undefined;
  description?: string | null | undefined;
  stockQuantity?: number | null | undefined;
}

export interface UpdateProductInput {
  productName?: string | undefined;
  price?: number | undefined;
  stockStatus?: StockStatus | undefined;
  category?: string | null | undefined;
  aliases?: string[] | undefined;
  variants?: string[] | undefined;
  notes?: string | null | undefined;
  description?: string | null | undefined;
  stockQuantity?: number | null | undefined;
  // Full replacement of variants + their pricing/rules (from the menu variant
  // editor). When present it drives both variants_json and variant_pricing_json;
  // when absent, both are left unchanged. Takes precedence over `variants`.
  variantConfig?: VariantConfig | undefined;
}

export type CreateProductResult =
  { status: "created"; product: ProductRecord } | { status: "duplicate_name" };

export type UpdateProductResult =
  | { status: "updated"; product: ProductRecord }
  | { status: "not_found" }
  | { status: "duplicate_name" };

interface ProductRow {
  product_id: string;
  product_name: string;
  aliases_json: string;
  category: string | null;
  price: number | null;
  stock_status: StockStatus;
  is_available: number;
  variants_json: string;
  notes: string | null;
  description: string | null;
  stock_quantity: number | null;
  image_url: string | null;
  variant_pricing_json: string | null;
  updated_at: string;
}

const SELECT_COLUMNS = `
  product_id,
  product_name,
  aliases_json,
  category,
  price,
  stock_status,
  is_available,
  variants_json,
  notes,
  description,
  stock_quantity,
  image_url,
  variant_pricing_json,
  updated_at
`;

const INSERT_SQL = `
  INSERT INTO products (
    product_id,
    product_name,
    aliases_json,
    category,
    price,
    stock_status,
    is_available,
    variants_json,
    notes,
    description,
    stock_quantity,
    variant_pricing_json,
    updated_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
`;

const UPDATE_SQL = `
  UPDATE products
  SET product_name = $2,
    aliases_json = $3,
    category = $4,
    price = $5,
    stock_status = $6,
    is_available = $7,
    variants_json = $8,
    notes = $9,
    description = $10,
    stock_quantity = $11,
    variant_pricing_json = $12,
    updated_at = $13
  WHERE product_id = $1
`;

export function createProductStore(db: Db) {
  return {
    async listProducts(): Promise<ProductRecord[]> {
      const result = await db.query<ProductRow>(
        `SELECT ${SELECT_COLUMNS} FROM products ORDER BY product_id ASC`
      );
      return result.rows.map(mapProductRow);
    },

    async getProduct(productId: string): Promise<ProductRecord | null> {
      return getProductById(db, productId);
    },

    // The WhatsApp /menu flow parks changes here until the admin confirms;
    // the dashboard shows a banner while any are still pending.
    async countPendingMenuChanges(): Promise<number> {
      const result = await db.query<{ count: string }>(
        "SELECT count(*) AS count FROM pending_menu_changes WHERE status = 'pending'"
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async createProduct(input: CreateProductInput): Promise<CreateProductResult> {
      // Same advisory lock key as the bot so a dashboard create and a
      // WhatsApp /menu add can't both compute the same next PRD-### id.
      const client = await db.connect();

      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('products_next_id'))");

        const duplicate = await client.query<{ product_id: string }>(
          "SELECT product_id FROM products WHERE lower(product_name) = lower($1)",
          [normalizeProductName(input.productName)]
        );

        if (duplicate.rows.length > 0) {
          await client.query("ROLLBACK");
          return { status: "duplicate_name" };
        }

        const maxResult = await client.query<{ max_id: string | null }>(
          "SELECT MAX(product_id) AS max_id FROM products WHERE product_id LIKE 'PRD-%'"
        );
        const productId = nextProductId(maxResult.rows[0]?.max_id ?? null);
        const product = normalizeCreateInput(productId, input);

        await client.query(INSERT_SQL, toProductParams(product));
        await client.query("COMMIT");

        return { status: "created", product };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async updateProduct(
      productId: string,
      input: UpdateProductInput
    ): Promise<UpdateProductResult> {
      const current = await getProductById(db, productId);

      if (!current) {
        return { status: "not_found" };
      }

      if (input.productName !== undefined) {
        const duplicate = await db.query<{ product_id: string }>(
          `SELECT product_id FROM products
           WHERE lower(product_name) = lower($1) AND product_id <> $2`,
          [normalizeProductName(input.productName), productId]
        );

        if (duplicate.rows.length > 0) {
          return { status: "duplicate_name" };
        }
      }

      const product = normalizeUpdateInput(current, input);
      await db.query(UPDATE_SQL, toProductParams(product));
      return { status: "updated", product };
    },

    // Dedicated image writer (the general update never touches image_url so
    // editing name/price can't wipe the photo). Returns null if the product is
    // gone.
    async setImageUrl(productId: string, imageUrl: string): Promise<ProductRecord | null> {
      const result = await db.query<ProductRow>(
        `UPDATE products
         SET image_url = $2, updated_at = $3
         WHERE product_id = $1
         RETURNING ${SELECT_COLUMNS}`,
        [productId, imageUrl, isoUtcNow()]
      );
      const row = result.rows[0];
      return row ? mapProductRow(row) : null;
    }
  };
}

export type ProductStore = ReturnType<typeof createProductStore>;

async function getProductById(db: Db, productId: string): Promise<ProductRecord | null> {
  const result = await db.query<ProductRow>(
    `SELECT ${SELECT_COLUMNS} FROM products WHERE product_id = $1`,
    [productId]
  );
  const row = result.rows[0];
  return row ? mapProductRow(row) : null;
}

function normalizeCreateInput(productId: string, input: CreateProductInput): ProductRecord {
  const stock = reconcileStock(input.stockStatus, input.stockQuantity ?? null);
  // The add form sets variant names only (no pricing) — variant_pricing_json
  // stays null; the card's variant editor sets pricing later.
  const variants = normalizeStringList(input.variants ?? []);

  return {
    productId,
    productName: input.productName.trim(),
    aliases: normalizeStringList(input.aliases ?? []),
    category: normalizeNullableString(input.category ?? null),
    price: input.price,
    stockStatus: stock.stockStatus,
    isAvailable: stock.isAvailable,
    variants,
    notes: normalizeNullableString(input.notes ?? null),
    description: normalizeNullableString(input.description ?? null),
    stockQuantity: stock.stockQuantity,
    imageUrl: null,
    variantConfig: buildVariantConfig(variants, null),
    updatedAt: isoUtcNow()
  };
}

function normalizeUpdateInput(current: ProductRecord, input: UpdateProductInput): ProductRecord {
  const stock = reconcileStock(
    input.stockStatus ?? current.stockStatus,
    input.stockQuantity !== undefined ? input.stockQuantity : current.stockQuantity,
    // An explicit stockStatus in the same change wins over quantity-derived flips.
    input.stockStatus !== undefined
  );

  // variantConfig (full editor payload) wins and rewrites both name list +
  // pricing; else a names-only `variants` patch keeps existing pricing; else
  // both are unchanged.
  const variantState = resolveVariantState(current, input);

  return {
    productId: current.productId,
    productName: input.productName?.trim() || current.productName,
    aliases: input.aliases ? normalizeStringList(input.aliases) : current.aliases,
    category:
      input.category !== undefined ? normalizeNullableString(input.category) : current.category,
    price: input.price ?? current.price,
    stockStatus: stock.stockStatus,
    isAvailable: stock.isAvailable,
    variants: variantState.variants,
    notes: input.notes !== undefined ? normalizeNullableString(input.notes) : current.notes,
    description:
      input.description !== undefined
        ? normalizeNullableString(input.description)
        : current.description,
    stockQuantity: stock.stockQuantity,
    imageUrl: current.imageUrl,
    variantConfig: variantState.variantConfig,
    updatedAt: isoUtcNow()
  };
}

function resolveVariantState(
  current: ProductRecord,
  input: UpdateProductInput
): { variants: string[]; variantConfig: VariantConfig } {
  if (input.variantConfig !== undefined) {
    const { names, pricingJson } = serializeVariantConfig(input.variantConfig);
    return { variants: names, variantConfig: buildVariantConfig(names, pricingJson) };
  }
  if (input.variants !== undefined) {
    // Names-only edit: keep any pricing that still matches a surviving name.
    const names = normalizeStringList(input.variants);
    const { pricingJson } = serializeVariantConfig({
      ...current.variantConfig,
      options: names.map((name) => {
        const existing = current.variantConfig.options.find((option) => option.name === name);
        return existing ?? { name, priceDelta: 0, inStock: true };
      })
    });
    return { variants: names, variantConfig: buildVariantConfig(names, pricingJson) };
  }
  return { variants: current.variants, variantConfig: current.variantConfig };
}

// Keeps quantity and status coherent, mirroring the bot's product store
// (fasola-order-bot/src/modules/products/product.store.ts reconcileStock):
// 0 portions means Sold Out (unless Hidden); restocking a Sold Out item makes
// it Available again unless the caller explicitly set a status in the same
// change. Untracked (null) quantity is never auto-managed.
function reconcileStock(
  stockStatus: StockStatus,
  stockQuantity: number | null,
  statusExplicit = true
): { stockStatus: StockStatus; stockQuantity: number | null; isAvailable: boolean } {
  let resolvedStatus = stockStatus;

  if (stockQuantity !== null && stockQuantity <= 0 && resolvedStatus !== "Hidden") {
    resolvedStatus = "Sold Out";
  } else if (
    stockQuantity !== null &&
    stockQuantity > 0 &&
    resolvedStatus === "Sold Out" &&
    !statusExplicit
  ) {
    resolvedStatus = "Available";
  }

  return {
    stockStatus: resolvedStatus,
    stockQuantity: stockQuantity === null ? null : Math.max(0, stockQuantity),
    isAvailable:
      isAvailableStockStatus(resolvedStatus) && (stockQuantity === null || stockQuantity > 0)
  };
}

function toProductParams(product: ProductRecord): unknown[] {
  // Derive the two stored variant columns from variantConfig so names_json and
  // variant_pricing_json can never drift.
  const { names, pricingJson } = serializeVariantConfig(product.variantConfig);
  return [
    product.productId,
    product.productName,
    JSON.stringify(product.aliases),
    product.category,
    product.price,
    product.stockStatus,
    product.isAvailable ? 1 : 0,
    JSON.stringify(names),
    product.notes,
    product.description,
    product.stockQuantity,
    pricingJson,
    product.updatedAt
  ];
}

function mapProductRow(row: ProductRow): ProductRecord {
  const variants = parseStringList(row.variants_json);
  return {
    productId: row.product_id,
    productName: row.product_name,
    aliases: parseStringList(row.aliases_json),
    category: row.category,
    // DOUBLE PRECISION comes back as number, but guard anyway.
    price: row.price === null ? null : Number(row.price),
    stockStatus: row.stock_status,
    isAvailable: Boolean(row.is_available),
    variants,
    notes: row.notes,
    description: row.description,
    stockQuantity: row.stock_quantity === null ? null : Number(row.stock_quantity),
    imageUrl: row.image_url,
    variantConfig: buildVariantConfig(variants, row.variant_pricing_json),
    updatedAt: row.updated_at
  };
}

// Same format as the bot's PRD-### ids: string MAX over the PRD- prefix,
// next number zero-padded to three digits.
function nextProductId(currentMaxId: string | null): string {
  const currentNumber = currentMaxId?.match(/^PRD-(\d+)$/u)?.[1];
  const nextNumber = currentNumber ? Number(currentNumber) + 1 : 1;
  return `PRD-${String(nextNumber).padStart(3, "0")}`;
}

// Bot-owned tables store timestamps as ISO-8601 text with explicit zone.
function isoUtcNow(): string {
  return new Date().toISOString();
}

function normalizeProductName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeStringList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeNullableString(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function isAvailableStockStatus(stockStatus: StockStatus): boolean {
  return stockStatus === "Available" || stockStatus === "Limited";
}

function parseStringList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
