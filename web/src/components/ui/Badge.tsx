import type { ReactNode } from "react";

import type { OrderStatus, PaymentStatus, StockStatus } from "../../api/types";
import {
  orderStatusLabels,
  paymentStatusLabels,
  sourceLabel,
  stockStatusLabels
} from "../../lib/labels";

export function Badge({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`size-1.5 rounded-full ${className}`} />;
}

const ORDER_STATUS_CLASSES: Record<OrderStatus, { badge: string; dot: string }> = {
  "Need Info": { badge: "bg-kunyit-100 text-kunyit-800", dot: "bg-kunyit-500" },
  "Pending Admin Confirmation": { badge: "bg-kunyit-100 text-kunyit-800", dot: "bg-kunyit-500" },
  Confirmed: { badge: "bg-pandan-100 text-pandan-800", dot: "bg-pandan-500" },
  Processing: { badge: "bg-pandan-100 text-pandan-800", dot: "bg-pandan-400" },
  Ready: { badge: "bg-pandan-200 text-pandan-900", dot: "bg-pandan-600" },
  Completed: { badge: "bg-pandan-700 text-cream-50", dot: "bg-cream-50" },
  Cancelled: { badge: "bg-cream-200 text-ink-500", dot: "bg-ink-400" },
  "Need Admin Help": { badge: "bg-sambal-100 text-sambal-800", dot: "bg-sambal-500" }
};

const PAYMENT_STATUS_CLASSES: Record<PaymentStatus, { badge: string; dot: string }> = {
  "Pending Manual Confirmation": { badge: "bg-kunyit-100 text-kunyit-800", dot: "bg-kunyit-500" },
  Unpaid: { badge: "bg-sambal-100 text-sambal-800", dot: "bg-sambal-500" },
  Paid: { badge: "bg-pandan-100 text-pandan-800", dot: "bg-pandan-500" },
  Cancelled: { badge: "bg-cream-200 text-ink-500", dot: "bg-ink-400" }
};

const STOCK_STATUS_CLASSES: Record<StockStatus, { badge: string; dot: string }> = {
  Available: { badge: "bg-pandan-100 text-pandan-800", dot: "bg-pandan-500" },
  Limited: { badge: "bg-kunyit-100 text-kunyit-800", dot: "bg-kunyit-500" },
  "Sold Out": { badge: "bg-sambal-100 text-sambal-800", dot: "bg-sambal-500" },
  Hidden: { badge: "bg-cream-200 text-ink-500", dot: "bg-ink-400" }
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const classes = ORDER_STATUS_CLASSES[status];
  return (
    <Badge className={classes.badge}>
      <Dot className={classes.dot} />
      {orderStatusLabels[status]}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const classes = PAYMENT_STATUS_CLASSES[status];
  return (
    <Badge className={classes.badge}>
      <Dot className={classes.dot} />
      {paymentStatusLabels[status]}
    </Badge>
  );
}

export function StockStatusBadge({ status }: { status: StockStatus }) {
  const classes = STOCK_STATUS_CLASSES[status];
  return (
    <Badge className={classes.badge}>
      <Dot className={classes.dot} />
      {stockStatusLabels[status]}
    </Badge>
  );
}

const SOURCE_CLASSES: Record<string, { badge: string; dot: string }> = {
  whatsapp: { badge: "bg-pandan-100 text-pandan-800", dot: "bg-pandan-500" },
  gofood: { badge: "bg-sambal-100 text-sambal-800", dot: "bg-sambal-500" }
};

// Order channel (WhatsApp / GoFood). Unknown sources render neutrally.
export function ChannelBadge({ source }: { source: string }) {
  const classes = SOURCE_CLASSES[source] ?? { badge: "bg-cream-200 text-ink-500", dot: "bg-ink-400" };
  return (
    <Badge className={classes.badge}>
      <Dot className={classes.dot} />
      {sourceLabel(source)}
    </Badge>
  );
}
