export const SERVICE_NAME = "fasola-finance";
export const BUSINESS_TIMEZONE = "Asia/Jakarta";

// Order statuses that count as revenue. Unconfirmed demand
// (Need Info / Pending Admin Confirmation / Need Admin Help) and
// Cancelled orders are excluded from every money figure.
export const REVENUE_ORDER_STATUSES = ["Confirmed", "Processing", "Ready", "Completed"] as const;

export const SESSION_COOKIE_NAME = "fasola_session";
