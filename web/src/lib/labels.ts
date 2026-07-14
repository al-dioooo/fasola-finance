import type { ExpenseCategory, OrderStatus, PaymentStatus, StockStatus } from "../api/types";

// The single EN-enum → Indonesian-label translation layer. DB and API keep
// the English values (contract with fasola-order-bot).

export const orderStatusLabels: Record<OrderStatus, string> = {
  "Need Info": "Perlu Info",
  "Pending Admin Confirmation": "Menunggu Konfirmasi",
  Confirmed: "Dikonfirmasi",
  Processing: "Diproses",
  Ready: "Siap Diantar",
  Completed: "Selesai",
  Cancelled: "Dibatalkan",
  "Need Admin Help": "Perlu Bantuan Admin"
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  "Pending Manual Confirmation": "Menunggu Konfirmasi Manual",
  Unpaid: "Belum Bayar",
  Paid: "Lunas",
  Cancelled: "Dibatalkan"
};

export const stockStatusLabels: Record<StockStatus, string> = {
  Available: "Tersedia",
  Limited: "Terbatas",
  "Sold Out": "Habis",
  Hidden: "Disembunyikan"
};

export const expenseCategoryLabels: Record<ExpenseCategory, string> = {
  bahan_baku: "Bahan Baku",
  gas: "Gas",
  kemasan: "Kemasan",
  transport: "Transport",
  lainnya: "Lainnya"
};

// Order channel labels. Unknown/future sources fall back to the raw value.
export const sourceLabels: Record<string, string> = {
  whatsapp: "WhatsApp",
  gofood: "GoFood"
};

export function sourceLabel(source: string): string {
  return sourceLabels[source] ?? source;
}

// Status badge colors live with the Badge components in
// components/ui/Badge.tsx — this module only owns the wording.
