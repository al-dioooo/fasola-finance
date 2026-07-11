import type { OrderStatus, PaymentStatus } from "../../shared/enums.js";
import { orderStatuses, paymentStatuses } from "../../shared/enums.js";

// Legal manual transitions from the dashboard. Enum values stay English —
// they are the DB contract with fasola-order-bot; Indonesian labels live in
// the web client only.
export const orderStatusTransitions: Record<OrderStatus, OrderStatus[]> = {
  "Need Info": ["Pending Admin Confirmation", "Cancelled", "Need Admin Help"],
  "Pending Admin Confirmation": ["Confirmed", "Cancelled", "Need Admin Help"],
  Confirmed: ["Processing", "Cancelled", "Need Admin Help"],
  Processing: ["Ready", "Completed", "Cancelled", "Need Admin Help"],
  Ready: ["Completed", "Cancelled"],
  "Need Admin Help": ["Pending Admin Confirmation", "Confirmed", "Cancelled"],
  Completed: [],
  Cancelled: []
};

export const paymentStatusTransitions: Record<PaymentStatus, PaymentStatus[]> = {
  "Pending Manual Confirmation": ["Unpaid", "Paid", "Cancelled"],
  Unpaid: ["Paid", "Cancelled"],
  Paid: ["Unpaid"],
  Cancelled: []
};

// Source statuses that may legally move to the given target. Used as the
// `order_status = ANY($n)` guard in the single-statement compare-and-swap.
export function orderStatusSourcesFor(target: OrderStatus): OrderStatus[] {
  return orderStatuses.filter((status) => orderStatusTransitions[status].includes(target));
}

export function paymentStatusSourcesFor(target: PaymentStatus): PaymentStatus[] {
  return paymentStatuses.filter((status) => paymentStatusTransitions[status].includes(target));
}
