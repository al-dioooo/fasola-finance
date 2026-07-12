export { Button } from "./Button";
export { Card, CardTitle, PageHeader } from "./Card";
export { Badge, OrderStatusBadge, PaymentStatusBadge, StockStatusBadge } from "./Badge";
export { Field, Input, Select, Textarea } from "./Field";
export { Tabs, FilterChips, type TabItem } from "./Tabs";
export { Modal } from "./Modal";
export { Skeleton, SkeletonCard, SkeletonRows, ErrorNote, EmptyState } from "./Feedback";
export { StatCard } from "./StatCard";
export { Pagination } from "./Pagination";

// Chart palette for Recharts — matches the design tokens in styles.css.
export const CHART_COLORS = {
  pandan: "#448553",
  pandanDeep: "#2a5437",
  kunyit: "#e4a92e",
  sambal: "#dd5a39",
  ink: "#453a30",
  grid: "#e7dcc0"
} as const;
