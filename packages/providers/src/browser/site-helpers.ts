import type { ScheduledTime } from '@polaris/contracts';

/**
 * @packageDocumentation
 * Conversions shared by the web-session site mappers.
 *
 * Small, but worth centralising: each of these encodes a decision that would otherwise be
 * made three times and eventually differently.
 */

/** Every airport these agencies serve on a domestic search is Indian. */
const IST_OFFSET_MINUTES = 330;
const IST_ZONE = 'Asia/Kolkata';

/**
 * Converts whole rupees to paise.
 *
 * @param rupees - Amount in whole currency units, as these sites quote it.
 * @returns Integer minor units. Zero when absent, which fails validation downstream rather
 *   than being silently priced at nothing.
 */
export function toMinor(rupees: number | string | undefined | null): number {
  const value = typeof rupees === 'string' ? Number(rupees.replace(/[^\d.]/g, '')) : rupees;
  return Number.isFinite(value) ? Math.round((value as number) * 100) : 0;
}

/**
 * Builds a {@link ScheduledTime} from an offset-bearing ISO timestamp.
 *
 * The leading portion of such a string is already wall-clock time at the airport, so the
 * local form is a truncation rather than a conversion.
 *
 * @param iso - Full ISO 8601 with offset, e.g. `2026-08-28T16:30:00.000+05:30`.
 * @param zoneId - IANA zone reported alongside it, when the site supplies one.
 * @returns Local, UTC and zone together.
 */
export function scheduledFromIso(iso: string, zoneId?: string): ScheduledTime {
  return {
    local: iso.slice(0, 19),
    utc: `${new Date(iso).toISOString().slice(0, 19)}Z`,
    timeZone: zoneId || IST_ZONE,
  };
}

/**
 * Builds a {@link ScheduledTime} from a true instant.
 *
 * Used where a site reports epoch milliseconds, which is the least ambiguous form any of
 * them offer: the instant is exact, and the local rendering is derived from it rather than
 * the other way round.
 *
 * @param epochMs - Milliseconds since the epoch.
 * @returns Local, UTC and zone together.
 */
export function scheduledFromEpoch(epochMs: number): ScheduledTime {
  return {
    local: new Date(epochMs + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 19),
    utc: `${new Date(epochMs).toISOString().slice(0, 19)}Z`,
    timeZone: IST_ZONE,
  };
}

/**
 * Builds a {@link ScheduledTime} from a local date and wall-clock time.
 *
 * The fallback for sites that report the two separately with no offset. The instant is
 * derived from India's fixed +05:30, which is correct for every airport currently served
 * and recorded in `docs/LIMITATIONS.md` as an assumption that expansion would break.
 *
 * @param isoDate - `YYYY-MM-DD` local at the airport.
 * @param hhmm - `HH:MM` local at the airport.
 * @returns Local, UTC and zone together.
 */
export function scheduledFromLocal(isoDate: string, hhmm: string): ScheduledTime {
  const [hours = 0, minutes = 0] = hhmm.split(':').map(Number);
  const [year = 1970, month = 1, day = 1] = isoDate.split('-').map(Number);

  const asIfUtcMs = Date.UTC(year, month - 1, day, hours, minutes);
  const instantMs = asIfUtcMs - IST_OFFSET_MINUTES * 60_000;

  return {
    local: `${isoDate}T${hhmm.padStart(5, '0')}:00`,
    utc: `${new Date(instantMs).toISOString().slice(0, 19)}Z`,
    timeZone: IST_ZONE,
  };
}

/**
 * Gate-to-gate minutes between two scheduled times.
 *
 * Computed from the real instants rather than trusting a separately-reported total, so
 * layovers are included and a site's own arithmetic is not a dependency.
 *
 * @param departure - First segment's departure.
 * @param arrival - Last segment's arrival.
 * @returns Whole minutes.
 */
export function durationBetween(departure: ScheduledTime, arrival: ScheduledTime): number {
  return Math.round((Date.parse(arrival.utc) - Date.parse(departure.utc)) / 60_000);
}

/**
 * Strips markup and normalises whitespace in a site's display string.
 *
 * These payloads carry promotional text with inline HTML and, in one case, mis-encoded
 * currency symbols. A benefit label goes in front of a user, so it is cleaned rather than
 * passed through.
 *
 * @param raw - The site's text, possibly containing markup.
 * @returns Plain text, or an empty string.
 */
export function plainText(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    // UTF-8 rupee sign decoded as latin-1, which one of these sites emits verbatim.
    .replace(/â‚¹/g, '₹')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts a weight in kilograms from a baggage description.
 *
 * The three sites phrase the same allowance as `"15 kg per adult"`, `"Kgs|15"` and
 * `"15"`, so the number is pulled out rather than the format being relied on.
 *
 * @param raw - The site's baggage text.
 * @returns Kilograms, or `undefined` when no number is present.
 */
export function baggageKg(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const match = /(\d+(?:\.\d+)?)/.exec(raw);
  return match ? Number(match[1]) : undefined;
}

/**
 * Normalises a flight number to the contract's shape: digits, optional trailing letter.
 *
 * These sites are inconsistent about it. EaseMyTrip pads with a leading space, and Ixigo
 * packs every number of a connection into one field. Returning `undefined` rather than a
 * best guess is deliberate: a wrong flight number is worse than a missing offer, because
 * the canonical key is built from it and a wrong key silently merges two different flights.
 *
 * @param raw - The site's value.
 * @returns A valid flight number, or `undefined` when it cannot be read unambiguously.
 */
export function flightNumberOf(raw: string | undefined | null): string | undefined {
  const trimmed = (raw ?? '').trim();
  return /^\d{1,4}[A-Z]?$/.test(trimmed) ? trimmed : undefined;
}
