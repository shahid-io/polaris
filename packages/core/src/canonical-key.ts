import type { FlightSegment, Itinerary, NormalizedOffer } from '@polaris/contracts';

/**
 * Builds the canonical identity of a single flown leg.
 *
 * The unit of identity here is the **marketed flight**, what a ticket is sold as, not the
 * physical aircraft. Those usually coincide and sometimes do not; see the codeshare note
 * below for why this distinction is deliberate rather than a shortcut.
 *
 * This is the function the whole product rests on. The brief requires handling
 * "the same flight available through multiple providers"; two offers belong to the same
 * {@link ComparisonGroup} exactly when this returns the same string for both.
 *
 * ### Why the departure date is local, not UTC
 * The key includes the departure date so 6E-2134 on the 20th is distinct from 6E-2134 on
 * the 21st. That date **must** be the local date at the origin airport. A 00:45 IST
 * departure on 20 Aug is 19:15Z on 19 Aug; providers vary in which representation they
 * return. Keying on UTC would split one flight into two groups whenever providers
 * disagree: silently, and only on red-eye flights, which is exactly when it is hardest
 * to notice.
 *
 * ### Why marketing carrier, not operating carrier
 * Marketing carrier and flight number are what a ticket is *sold* as, and what every
 * provider agrees on for a given fare. On a codeshare the operating carrier differs, so
 * one aircraft may be sold under two flight numbers and will appear here as two flights.
 * That is a documented limitation rather than an oversight: collapsing codeshares needs an
 * operating-carrier + equipment + slot match that providers do not reliably expose, and a
 * wrong merge: showing a fare the user cannot actually buy under that number, is worse
 * than a missed one. See `docs/LIMITATIONS.md`.
 *
 * @param segment - The leg to identify.
 * @returns A key of the form `{carrier}-{flightNumber}-{localDate}-{origin}-{destination}`.
 *
 * @example
 * ```ts
 * canonicalKeyForSegment(segment); // "6E-2134-2026-08-20-DEL-BOM"
 * ```
 */
export function canonicalKeyForSegment(segment: FlightSegment): string {
  const departureLocalDate = localDateOf(segment.departure.local);

  return [
    segment.marketingCarrier,
    segment.flightNumber,
    departureLocalDate,
    segment.origin,
    segment.destination,
  ].join('-');
}

/**
 * Builds the canonical identity of a full journey.
 *
 * A non-stop yields the bare segment key, which keeps logs and test failures legible.
 * A connecting journey joins every leg's key with `|`, so two itineraries match only when
 * every leg matches in the same order: DEL→BOM→GOI is not DEL→HYD→GOI, and a different
 * connection is a different journey.
 *
 * @param itinerary - The journey to identify. Must contain at least one segment.
 * @returns The joined per-segment keys.
 *
 * @example
 * ```ts
 * // non-stop
 * canonicalKeyForItinerary(nonStop);
 * // "6E-2134-2026-08-20-DEL-BOM"
 *
 * // one connection
 * canonicalKeyForItinerary(connecting);
 * // "6E-2134-2026-08-20-DEL-BOM|6E-778-2026-08-20-BOM-GOI"
 * ```
 */
export function canonicalKeyForItinerary(itinerary: Itinerary): string {
  return itinerary.segments.map(canonicalKeyForSegment).join('|');
}

/**
 * Convenience wrapper: the canonical key of the itinerary an offer sells.
 *
 * Offers differing only by provider, fare family or price share a key, which is precisely
 * what makes cross-provider grouping possible.
 *
 * @param offer - The provider offer.
 * @returns The canonical key of the underlying flight.
 *
 * @see {@link canonicalKeyForItinerary}
 */
export function canonicalKeyForOffer(offer: NormalizedOffer): string {
  return canonicalKeyForItinerary(offer.itinerary);
}

/**
 * Extracts `YYYY-MM-DD` from an offset-less local datetime.
 *
 * Deliberately string slicing rather than `new Date(...)`: constructing a Date would
 * interpret the offset-less string in the *server's* timezone and could shift the date by
 * a day depending on where the API runs, reintroducing the very bug the local-date rule
 * exists to prevent.
 *
 * @param localDateTime - Local datetime, e.g. `2026-08-20T06:15:00`.
 * @returns The date portion, e.g. `2026-08-20`.
 * @internal
 */
function localDateOf(localDateTime: string): string {
  return localDateTime.slice(0, 10);
}
