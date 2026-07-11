import { BUSINESS_TIMEZONE } from "./constants.js";

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// "Business date" means a calendar day in Asia/Jakarta. The browser never
// does this math — every "today" and range boundary is computed here.
export function todayJakarta(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function isBusinessDate(value: string): boolean {
  if (!BUSINESS_DATE_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

// Jakarta is fixed UTC+7 with no DST, so boundary conversion is a plain offset.
// [from 00:00 Jakarta, to+1 00:00 Jakarta) expressed as UTC instants for
// comparing against the bot's ISO text timestamps cast to timestamptz.
export function jakartaDateRangeToUtc(from: string, to: string): { fromUtc: string; toUtc: string } {
  return {
    fromUtc: new Date(`${from}T00:00:00+07:00`).toISOString(),
    toUtc: new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000).toISOString()
  };
}
