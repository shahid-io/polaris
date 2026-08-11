import { z } from 'zod';

/** IATA airport code — three uppercase letters, e.g. DEL, BOM. */
export const iataAirportCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter IATA airport code, e.g. DEL')
  .describe('IATA airport code');

/** IATA airline designator — two alphanumerics, e.g. 6E (IndiGo), IX (Air India Express). */
export const iataAirlineCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{2}$/, 'Must be a 2-character IATA airline code, e.g. 6E')
  .describe('IATA airline designator');

/**
 * Calendar date with no timezone, YYYY-MM-DD.
 *
 * The shape check alone is not enough: `2026-02-31` and `2026-13-01` both match the
 * pattern and are not dates. Round-tripping through UTC catches them — a value that does
 * not survive being parsed and reformatted was never a real calendar date.
 *
 * Date.UTC is used rather than `new Date(string)` so the check cannot shift by a day
 * depending on the server's timezone.
 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be an ISO date, YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return false;

    const asUtc = new Date(Date.UTC(year, month - 1, day));
    return (
      asUtc.getUTCFullYear() === year &&
      asUtc.getUTCMonth() === month - 1 &&
      asUtc.getUTCDate() === day
    );
  }, 'Must be a real calendar date');

/** Instant in UTC, e.g. 2026-08-20T00:45:00Z. */
export const isoDateTimeUtcSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'Must be an ISO UTC datetime');

/** Wall-clock time at a location, with no offset, e.g. 2026-08-20T06:15:00. */
export const isoDateTimeLocalSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, 'Must be a local datetime with no offset');

/** Time of day, HH:MM in 24-hour form. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a time of day, HH:MM');

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Must be an ISO 4217 currency code')
  .describe('ISO 4217 currency code');

/**
 * Money is stored in minor units (paise for INR) as an integer.
 *
 * Floats are unusable here: we sum, average and compare prices across providers,
 * and 0.1 + 0.2 !== 0.3 would surface as off-by-one-paisa price spreads in the UI.
 */
export const moneySchema = z.object({
  /** Integer amount in the currency's minor unit — e.g. 549900 = ₹5,499.00 */
  amountMinor: z.number().int().nonnegative(),
  currency: currencyCodeSchema,
});

/**
 * A scheduled time carried in three forms simultaneously.
 *
 * This shape exists to prevent a specific, subtle bug. The canonical key used to
 * recognise "the same flight across providers" includes the departure date — and that
 * date MUST be the local date at the origin airport. A 00:45 IST departure is
 * 19:15Z the previous day; keying on the UTC date would split one flight into two
 * groups whenever providers disagree on which representation they return.
 *
 * Carrying local, utc and the zone together makes each consumer's choice explicit
 * rather than accidental.
 */
export const scheduledTimeSchema = z.object({
  /** Wall-clock time at the airport, no offset. */
  local: isoDateTimeLocalSchema,
  /** The same instant in UTC. */
  utc: isoDateTimeUtcSchema,
  /** IANA timezone of the airport, e.g. Asia/Kolkata. */
  timeZone: z.string().min(1),
});

export type IataAirportCode = z.infer<typeof iataAirportCodeSchema>;
export type IataAirlineCode = z.infer<typeof iataAirlineCodeSchema>;
export type IsoDate = z.infer<typeof isoDateSchema>;
export type IsoDateTimeUtc = z.infer<typeof isoDateTimeUtcSchema>;
export type IsoDateTimeLocal = z.infer<typeof isoDateTimeLocalSchema>;
export type TimeOfDay = z.infer<typeof timeOfDaySchema>;
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;
export type Money = z.infer<typeof moneySchema>;
export type ScheduledTime = z.infer<typeof scheduledTimeSchema>;
