// Canonical API contract shared by all pages. Server modules implement
// exactly these shapes; enum VALUES stay English (DB contract with the bot),
// Indonesian labels live in lib/labels.ts.

export type OrderStatus =
  | "Need Info"
  | "Pending Admin Confirmation"
  | "Confirmed"
  | "Processing"
  | "Ready"
  | "Completed"
  | "Cancelled"
  | "Need Admin Help";

export type PaymentStatus = "Pending Manual Confirmation" | "Unpaid" | "Paid" | "Cancelled";

export type StockStatus = "Available" | "Limited" | "Sold Out" | "Hidden";

export type ExpenseCategory = "bahan_baku" | "gas" | "kemasan" | "transport" | "lainnya";

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
  variant?: string | null;
  notes?: string | null;
}

export interface OrderListItem {
  orderId: string;
  createdAt: string;
  updatedAt: string;
  customerWa: string;
  customerName: string | null;
  productsText: string;
  totalQuantity: number;
  estimatedSubtotal: number | null;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
}

export interface OrderDetail extends OrderListItem {
  products: OrderItem[];
  address: string;
  paymentMethod: string;
  notes: string | null;
  requestedTime: string | null;
  rawMessage: string | null;
  aiModel: string | null;
  aiConfidence: number | null;
  missingFields: string[];
  source: string;
}

export interface OrdersListResponse {
  items: OrderListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface OrderDetailResponse {
  order: OrderDetail;
  allowedStatusTransitions: OrderStatus[];
  allowedPaymentTransitions: PaymentStatus[];
}

export interface OrderUpdateResponse {
  order: OrderDetail;
  allowedStatusTransitions: OrderStatus[];
  allowedPaymentTransitions: PaymentStatus[];
}

export interface TopProduct {
  productId: string;
  name: string;
  totalQty: number;
  estRevenue: number;
}

export interface SummaryResponse {
  date: string;
  revenue: number;
  ordersCount: number;
  unpricedOrders: number;
  needAction: {
    pendingConfirmation: number;
    needAdminHelp: number;
  };
  byStatus: Partial<Record<OrderStatus, number>>;
  expensesTotal: number;
  profit: number;
  topProducts: TopProduct[];
}

export type ReportGranularity = "daily" | "weekly" | "monthly";

export interface RevenueBucket {
  bucket: string;
  orders: number;
  revenue: number;
  unpricedOrders: number;
}

export interface RevenueResponse {
  buckets: RevenueBucket[];
}

export interface TopProductsResponse {
  items: TopProduct[];
}

export interface ProfitBucket {
  bucket: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface ProfitResponse {
  buckets: ProfitBucket[];
  expensesByCategory: { category: ExpenseCategory; total: number }[];
}

export interface Product {
  productId: string;
  productName: string;
  aliases: string[];
  category: string | null;
  price: number | null;
  stockStatus: StockStatus;
  isAvailable: boolean;
  variants: string[];
  notes: string | null;
  description: string | null;
  updatedAt: string;
}

export interface ProductsResponse {
  items: Product[];
  pendingMenuChanges: number;
}

// business_profile rows the bot answers customer questions from. An empty
// value means "not provided" — the bot deflects that topic to admin.
export interface BusinessProfileEntry {
  key: string;
  value: string;
  updatedAt: string;
}

export interface BusinessProfileResponse {
  items: BusinessProfileEntry[];
}

export interface BusinessProfileUpdateResponse {
  item: BusinessProfileEntry;
}

export interface Expense {
  expenseId: string;
  expenseDate: string;
  category: ExpenseCategory;
  description: string | null;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExpensesResponse {
  items: Expense[];
  total: number;
  page: number;
  limit: number;
  periodTotal: number;
}

export interface BotStatusResponse {
  gowaReachable: boolean;
  connected: boolean;
  devices: { name: string; device: string }[];
}

export interface BotLoginResponse {
  qrImageDataUrl: string;
  durationSeconds: number;
}

export interface BotHealthResponse {
  bot: "ok" | "down";
  gowa: "ok" | "down";
  db: "ok" | "down";
}

export interface MessageLogItem {
  messageId: string;
  customerWa: string;
  chatId: string;
  messageType: string;
  messageText: string | null;
  detectedIntent: string | null;
  processingStatus: string;
  errorMessage: string | null;
  receivedAt: string;
}

export interface MessagesResponse {
  items: MessageLogItem[];
  total: number;
  page: number;
  limit: number;
}

export interface HandoffItem {
  order: OrderListItem;
  recentMessages: MessageLogItem[];
}

export interface HandoffResponse {
  items: HandoffItem[];
}

export interface AiLogItem {
  logId: string;
  createdAt: string;
  messageId: string | null;
  customerWa: string | null;
  promptVersion: string;
  model: string;
  intent: string | null;
  confidence: number | null;
  validationStatus: string;
  errorType: string | null;
  handoffTriggered: boolean;
  latencyMs: number | null;
}

export interface AiLogsResponse {
  items: AiLogItem[];
  total: number;
  page: number;
  limit: number;
}
