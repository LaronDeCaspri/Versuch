export type IsoDate = string & { readonly __brand: "IsoDate" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RIYADH_TZ = "Asia/Riyadh";

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  // Reject values the Date parser silently rolls over (e.g. 2024-02-30).
  return new Date(ms).toISOString().slice(0, 10) === value;
}

export function asIsoDate(value: string): IsoDate {
  if (!isIsoDate(value)) throw new RangeError(`Not an ISO date (YYYY-MM-DD): ${value}`);
  return value;
}

/**
 * Riyadh has no DST and a fixed UTC+3 offset, but we still resolve through the
 * IANA zone so a future rule change can never silently shift the compliance clock.
 */
export function todayInRiyadh(now: Date = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return asIsoDate(parts);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return asIsoDate(d.toISOString().slice(0, 10));
}

/** Signed day count: `a - b`. Positive when `a` is later than `b`. */
export function diffDays(a: IsoDate, b: IsoDate): number {
  const ma = Date.parse(`${a}T00:00:00Z`);
  const mb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((ma - mb) / 86_400_000);
}

export function maxDate(dates: readonly IsoDate[]): IsoDate | null {
  return dates.reduce<IsoDate | null>((acc, d) => (acc === null || d > acc ? d : acc), null);
}

/** Um al-Qura Hijri rendering for display only; Gregorian remains canonical. */
export function toHijri(date: IsoDate, locale = "ar-SA"): string {
  return new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura`, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}
