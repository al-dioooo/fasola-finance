import { z } from "zod";

// These string values are shared with fasola-order-bot's orders/products
// tables — see that repo's docs/db-contract.md. Do not translate them;
// Indonesian labels live in the web client only.
export const orderStatuses = [
  "Need Info",
  "Pending Admin Confirmation",
  "Confirmed",
  "Processing",
  "Ready",
  "Completed",
  "Cancelled",
  "Need Admin Help"
] as const;
export type OrderStatus = (typeof orderStatuses)[number];
export const orderStatusSchema = z.enum(orderStatuses);

export const paymentStatuses = [
  "Pending Manual Confirmation",
  "Unpaid",
  "Paid",
  "Cancelled"
] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];
export const paymentStatusSchema = z.enum(paymentStatuses);

export const stockStatuses = ["Available", "Limited", "Sold Out", "Hidden"] as const;
export type StockStatus = (typeof stockStatuses)[number];
export const stockStatusSchema = z.enum(stockStatuses);

export const expenseCategories = ["bahan_baku", "gas", "kemasan", "transport", "lainnya"] as const;
export type ExpenseCategory = (typeof expenseCategories)[number];
export const expenseCategorySchema = z.enum(expenseCategories);
