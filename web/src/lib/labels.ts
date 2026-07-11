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

export const orderStatusBadgeClasses: Record<OrderStatus, string> = {
  "Need Info": "bg-amber-100 text-amber-800",
  "Pending Admin Confirmation": "bg-amber-100 text-amber-800",
  Confirmed: "bg-sky-100 text-sky-800",
  Processing: "bg-indigo-100 text-indigo-800",
  Ready: "bg-teal-100 text-teal-800",
  Completed: "bg-emerald-100 text-emerald-800",
  Cancelled: "bg-stone-200 text-stone-600",
  "Need Admin Help": "bg-rose-100 text-rose-800"
};

export const paymentStatusBadgeClasses: Record<PaymentStatus, string> = {
  "Pending Manual Confirmation": "bg-amber-100 text-amber-800",
  Unpaid: "bg-rose-100 text-rose-800",
  Paid: "bg-emerald-100 text-emerald-800",
  Cancelled: "bg-stone-200 text-stone-600"
};

export const stockStatusBadgeClasses: Record<StockStatus, string> = {
  Available: "bg-emerald-100 text-emerald-800",
  Limited: "bg-amber-100 text-amber-800",
  "Sold Out": "bg-rose-100 text-rose-800",
  Hidden: "bg-stone-200 text-stone-600"
};
