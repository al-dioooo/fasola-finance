import type { Db } from "../../db/client.js";
import type { StockStatus } from "../../shared/enums.js";

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
  variants: string[];
  notes: string | null;
  // Customer-facing copy the bot quotes when answering "what's in this dish".
  description: string | null;
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
    updated_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
    updated_at = $11
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
  const stockStatus = input.stockStatus;

  return {
    productId,
    productName: input.productName.trim(),
    aliases: normalizeStringList(input.aliases ?? []),
    category: normalizeNullableString(input.category ?? null),
    price: input.price,
    stockStatus,
    isAvailable: isAvailableStockStatus(stockStatus),
    variants: normalizeStringList(input.variants ?? []),
    notes: normalizeNullableString(input.notes ?? null),
    description: normalizeNullableString(input.description ?? null),
    updatedAt: isoUtcNow()
  };
}

function normalizeUpdateInput(current: ProductRecord, input: UpdateProductInput): ProductRecord {
  const stockStatus = input.stockStatus ?? current.stockStatus;

  return {
    productId: current.productId,
    productName: input.productName?.trim() || current.productName,
    aliases: input.aliases ? normalizeStringList(input.aliases) : current.aliases,
    category:
      input.category !== undefined ? normalizeNullableString(input.category) : current.category,
    price: input.price ?? current.price,
    stockStatus,
    isAvailable: isAvailableStockStatus(stockStatus),
    variants: input.variants ? normalizeStringList(input.variants) : current.variants,
    notes: input.notes !== undefined ? normalizeNullableString(input.notes) : current.notes,
    description:
      input.description !== undefined
        ? normalizeNullableString(input.description)
        : current.description,
    updatedAt: isoUtcNow()
  };
}

function toProductParams(product: ProductRecord): unknown[] {
  return [
    product.productId,
    product.productName,
    JSON.stringify(product.aliases),
    product.category,
    product.price,
    product.stockStatus,
    product.isAvailable ? 1 : 0,
    JSON.stringify(product.variants),
    product.notes,
    product.description,
    product.updatedAt
  ];
}

function mapProductRow(row: ProductRow): ProductRecord {
  return {
    productId: row.product_id,
    productName: row.product_name,
    aliases: parseStringList(row.aliases_json),
    category: row.category,
    // DOUBLE PRECISION comes back as number, but guard anyway.
    price: row.price === null ? null : Number(row.price),
    stockStatus: row.stock_status,
    isAvailable: Boolean(row.is_available),
    variants: parseStringList(row.variants_json),
    notes: row.notes,
    description: row.description,
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
