import {
  serializeVariantConfig,
  type VariantConfig
} from "../server/src/modules/products/variant.js";
import { todayJakarta } from "../server/src/shared/dates.js";
import type { ExpenseCategory, StockStatus } from "../server/src/shared/enums.js";

// Seed dataset for a local dev database.
//
// The two Jajanan items below (Mie Ayam, Baslok) mirror the live production
// menu as of 2026-07-16 — same ids, prices, aliases and descriptions, and like
// production they carry no variants and no tracked quantity. Bubur Ayam, Soto
// Ayam and Es Teh Manis are additions that do not exist in production; their
// copy is placeholder, and they deliberately exercise variant pricing
// (non-zero deltas, an out-of-stock option, an optional multi-select group)
// plus stock_quantity, none of which the production rows cover.

export interface SeedProduct {
  productId: string;
  productName: string;
  aliases: string[];
  category: string | null;
  price: number;
  stockStatus: StockStatus;
  notes: string | null;
  description: string;
  // null = not tracked, matching how production leaves it.
  stockQuantity: number | null;
  variantConfig: VariantConfig;
}

function noVariants(): VariantConfig {
  return { required: true, maxSelectable: 1, options: [] };
}

export const seedProducts: SeedProduct[] = [
  {
    // Production row (PRD-001), reproduced verbatim.
    productId: "PRD-001",
    productName: "Mie Ayam",
    aliases: ["mie", "ayam"],
    category: "Jajanan",
    price: 11000,
    stockStatus: "Limited",
    notes: null,
    description:
      "Mie ayam dengan isi komplit dengan caisin/sawi hijau, bawang goreng, dan pangsit " +
      "goreng dengan saus, sambel, dan sumpit yang dipisah pada kemasan.",
    stockQuantity: null,
    variantConfig: noVariants()
  },
  {
    // Production row (PRD-002), reproduced verbatim.
    productId: "PRD-002",
    productName: "Baslok",
    aliases: ["baso", "baslok", "baso colok"],
    category: "Jajanan",
    price: 1000,
    stockStatus: "Available",
    notes: null,
    description: "Bakso colok per butir dengan saus dan tusukan yang dipisah pada kemasan.",
    stockQuantity: null,
    variantConfig: noVariants()
  },
  {
    productId: "PRD-003",
    productName: "Bubur Ayam",
    aliases: ["bubur", "bubur ayam"],
    category: "Jajanan",
    price: 8000,
    stockStatus: "Available",
    notes: null,
    description:
      "Bubur ayam hangat dengan suwiran ayam, cakwe, seledri, dan bawang goreng; kerupuk, " +
      "sambal, dan kecap dipisah pada kemasan.",
    stockQuantity: 20,
    // Required single-select with real price deltas, and one option that is
    // currently out of stock — covers the inStock=false path.
    variantConfig: {
      required: true,
      maxSelectable: 1,
      options: [
        { name: "Original", priceDelta: 0, inStock: true },
        { name: "Telur Rebus", priceDelta: 3000, inStock: true },
        { name: "Sate Telur Puyuh", priceDelta: 5000, inStock: false }
      ]
    }
  },
  {
    productId: "PRD-004",
    productName: "Soto Ayam",
    aliases: ["soto", "soto ayam"],
    category: "Jajanan",
    price: 8000,
    stockStatus: "Available",
    notes: null,
    description:
      "Soto ayam kuah bening dengan suwiran ayam, soun, tauge, dan seledri; sambal, jeruk " +
      "nipis, dan koya dipisah pada kemasan.",
    stockQuantity: 15,
    // Optional group, up to two picks — covers selection.min=0 / max>1.
    variantConfig: {
      required: false,
      maxSelectable: 2,
      options: [
        { name: "Pakai Nasi", priceDelta: 3000, inStock: true },
        { name: "Extra Suwiran Ayam", priceDelta: 5000, inStock: true },
        { name: "Extra Koya", priceDelta: 2000, inStock: true }
      ]
    }
  },
  {
    productId: "PRD-005",
    productName: "Es Teh Manis",
    aliases: ["es teh", "teh manis", "teh"],
    category: "Minuman",
    price: 5000,
    stockStatus: "Available",
    notes: null,
    description: "Teh manis diseduh fresh setiap pagi, dikemas dalam cup 22 oz dengan tutup segel.",
    stockQuantity: 30,
    variantConfig: {
      required: true,
      maxSelectable: 1,
      options: [
        { name: "Dingin", priceDelta: 0, inStock: true },
        { name: "Panas", priceDelta: 0, inStock: true },
        { name: "Dingin Jumbo", priceDelta: 3000, inStock: true }
      ]
    }
  }
];

// business_profile is all-empty in production, so every value here is ours to
// choose. Keys mirror bot migration 004 plus `business_name`, which the
// contract allows us to add: the bot's getProfileFacts() returns every non-empty
// row generically, and the Settings page renders unknown keys with a humanized
// label. `promos` stays empty on purpose — empty means "not provided" and the
// bot deflects the topic rather than inventing a discount.
export const seedBusinessProfile: Record<string, string> = {
  business_name: "Dapoer Mami Fasola",
  store_address: "Jl. Gunung Jayawijaya III Blok C No. 4, Pagelaran, Ciomas, Jawa Barat 16610",
  opening_hours: "Setiap hari, 07.00 - 17.00 WIB",
  delivery_area: "Sekitar Ciomas, Pagelaran, dan Bogor Barat — maks. 5 km dari dapur",
  delivery_eta: "30-60 menit setelah pesanan dikonfirmasi, tergantung antrean dan cuaca",
  contact_info: "Chat WhatsApp ini saja ya, admin akan segera membalas",
  promos: "",
  about:
    "Dapoer Mami Fasola adalah dapur rumahan di Ciomas, Bogor yang menyajikan mie ayam, " +
    "bubur, soto, dan jajanan rumahan. Dimasak segar setiap hari dengan resep keluarga."
};

// Mirrors production: GoFood wired up but switched off, no credentials stored.
export const seedGofoodSettings: Record<string, string> = {
  client_id: "",
  client_secret: "",
  partner_id: "",
  outlet_id: "",
  enabled: "false",
  environment: "sandbox"
};

export interface SeedExpense {
  // Days back from today (Asia/Jakarta), so a seeded DB always has recent data
  // in the reports.
  daysAgo: number;
  category: ExpenseCategory;
  description: string;
  amount: number;
}

export const seedExpenses: SeedExpense[] = [
  { daysAgo: 0, category: "bahan_baku", description: "Ayam 3 kg + tulang kaldu", amount: 96000 },
  {
    daysAgo: 0,
    category: "kemasan",
    description: "Cup 22 oz + tutup segel (50 pcs)",
    amount: 42000
  },
  { daysAgo: 1, category: "bahan_baku", description: "Mie basah 5 kg", amount: 75000 },
  { daysAgo: 1, category: "transport", description: "Bensin belanja ke pasar", amount: 20000 },
  { daysAgo: 2, category: "gas", description: "Isi ulang LPG 3 kg", amount: 22000 },
  {
    daysAgo: 3,
    category: "bahan_baku",
    description: "Sayur, caisin, tauge, dan bumbu",
    amount: 58000
  },
  { daysAgo: 4, category: "kemasan", description: "Box mie + kantong plastik", amount: 65000 },
  { daysAgo: 5, category: "bahan_baku", description: "Beras 5 kg untuk bubur", amount: 70000 },
  { daysAgo: 6, category: "lainnya", description: "Token listrik dapur", amount: 50000 },
  {
    daysAgo: 7,
    category: "transport",
    description: "Ongkos antar pesanan luar area",
    amount: 25000
  },
  { daysAgo: 8, category: "gas", description: "Isi ulang LPG 3 kg", amount: 22000 },
  { daysAgo: 9, category: "lainnya", description: "Galon air isi ulang", amount: 19000 }
];

// Deterministic ids in the app's own EXP-<YYYYMMDD>-<6 chars> shape, so
// re-running the seeder upserts the same rows instead of piling up duplicates.
export function buildExpenseId(expenseDate: string, index: number): string {
  return `EXP-${expenseDate.replaceAll("-", "")}-SEED${String(index).padStart(2, "0")}`;
}

// Jakarta is a fixed UTC+7 offset with no DST, so plain day arithmetic on the
// business date is safe.
export function businessDateDaysAgo(daysAgo: number, now: Date = new Date()): string {
  const today = todayJakarta(now);
  const shifted = new Date(`${today}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() - daysAgo);
  return shifted.toISOString().slice(0, 10);
}

// Bot-owned tables store timestamps as ISO-8601 text with an explicit zone,
// exactly like the product store's isoUtcNow().
export function isoUtcNow(now: Date = new Date()): string {
  return now.toISOString();
}

export interface ProductRowValues {
  productId: string;
  productName: string;
  aliasesJson: string;
  category: string | null;
  price: number;
  stockStatus: StockStatus;
  isAvailable: number;
  variantsJson: string;
  notes: string | null;
  description: string;
  stockQuantity: number | null;
  variantPricingJson: string | null;
}

// Derives the stored columns the same way product.store.ts does: variant names
// and pricing both come out of serializeVariantConfig (so they cannot drift),
// and is_available follows reconcileStock's rule — Available/Limited, and not
// tracked-down-to-zero.
export function toProductRowValues(product: SeedProduct): ProductRowValues {
  const { names, pricingJson } = serializeVariantConfig(product.variantConfig);
  const inStockStatus = product.stockStatus === "Available" || product.stockStatus === "Limited";
  const hasPortions = product.stockQuantity === null || product.stockQuantity > 0;

  return {
    productId: product.productId,
    productName: product.productName,
    aliasesJson: JSON.stringify(product.aliases),
    category: product.category,
    price: product.price,
    stockStatus: product.stockStatus,
    isAvailable: inStockStatus && hasPortions ? 1 : 0,
    variantsJson: JSON.stringify(names),
    notes: product.notes,
    description: product.description,
    stockQuantity: product.stockQuantity,
    variantPricingJson: pricingJson
  };
}
