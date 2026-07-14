import { formatInTimeZone } from "date-fns-tz";

/**
 * The student's local calendar date (date-only) for a given instant, as a Date
 * usable as a DailyProgress key. DailyProgress.date is @db.Date
 * (tz-naive date-only), so we store the student's LOCAL calendar date — not the
 * UTC date. This makes streak boundaries correct across timezones and DST: a
 * solve at 11pm EST on Jan 5 counts toward Jan 5, not Jan 6.
 *
 * Returns a Date at midnight UTC of the student's local Y-M-D, which is the
 * shape Postgres compares for @db.Date columns.
 */
export function localDateFor(at: Date, tz: string): Date {
  const ymd = formatInTimeZone(at, tz, "yyyy-MM-dd");
  return new Date(ymd + "T00:00:00Z");
}
