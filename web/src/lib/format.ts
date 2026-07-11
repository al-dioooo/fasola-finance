const idrFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0
});

export function formatIDR(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  return idrFormatter.format(value);
}

const jakartaDateTime = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

const jakartaDate = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  year: "numeric"
});

export function formatDateTimeJakarta(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }

  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : jakartaDateTime.format(parsed);
}

export function formatDateJakarta(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) {
    return "—";
  }

  // Plain business dates (YYYY-MM-DD) must not shift across timezones.
  const asDate = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)
    ? new Date(`${isoOrDate}T00:00:00+07:00`)
    : new Date(isoOrDate);

  return Number.isNaN(asDate.getTime()) ? isoOrDate : jakartaDate.format(asDate);
}

// Default value for date inputs: today's business date in Jakarta.
export function todayJakarta(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
