import type { FlightSegment, Itinerary } from '@polaris/contracts';

/** A wait between two flown legs. */
export interface Layover {
  /** IATA code of the airport the wait happens at. */
  airport: string;
  minutes: number;
  /**
   * True when the connection is tight enough to be a real risk.
   *
   * Under an hour on a domestic sector leaves no room for a late inbound, and a traveller
   * choosing between itineraries deserves to see that before booking rather than after.
   */
  isTight: boolean;
  /** True when the wait is long enough to dominate the journey. */
  isLong: boolean;
}

/** Minimum domestic connection widely treated as workable. */
const TIGHT_CONNECTION_MINUTES = 60;

/** Beyond this, the wait rather than the flying defines the journey. */
const LONG_CONNECTION_MINUTES = 240;

/**
 * Computes the wait at each connection point.
 *
 * A connecting itinerary's total duration already includes its layovers, but the split
 * between flying and waiting is invisible in that single number — two four-hour journeys
 * are very different if one is a single flight and the other is ninety minutes of flying
 * either side of a two-hour wait.
 *
 * Durations come from the UTC instants rather than the local wall clocks. A connection
 * that crosses a timezone would otherwise compute as longer or shorter than it is, and
 * arithmetic on local times silently assumes both airports share an offset.
 *
 * @param itinerary - The journey to inspect.
 * @returns One entry per connection, in order. Empty for a non-stop.
 *
 * @example
 * ```ts
 * layoversFor(itinerary);
 * // [{ airport: 'AMD', minutes: 165, isTight: false, isLong: false }]
 * ```
 */
export function layoversFor(itinerary: Itinerary): Layover[] {
  const layovers: Layover[] = [];

  for (let index = 0; index < itinerary.segments.length - 1; index += 1) {
    const arriving = itinerary.segments[index]!;
    const departing = itinerary.segments[index + 1]!;

    const minutes = Math.round(
      (Date.parse(departing.departure.utc) - Date.parse(arriving.arrival.utc)) / 60_000,
    );

    layovers.push({
      airport: arriving.destination,
      minutes,
      isTight: minutes < TIGHT_CONNECTION_MINUTES,
      isLong: minutes > LONG_CONNECTION_MINUTES,
    });
  }

  return layovers;
}

/**
 * Total time actually spent flying, excluding waits.
 *
 * @param itinerary - The journey to measure.
 * @returns Sum of every segment's duration.
 */
export function flyingMinutes(itinerary: Itinerary): number {
  return itinerary.segments.reduce((total, segment) => total + segment.durationMinutes, 0);
}

/**
 * Total time spent waiting between legs.
 *
 * Derived from the itinerary's own total rather than by summing layovers, so it stays
 * consistent with the duration shown everywhere else — a provider's reported total is
 * authoritative even when it disagrees slightly with the segment arithmetic.
 *
 * @param itinerary - The journey to measure.
 * @returns Minutes of connection time, never negative.
 */
export function waitingMinutes(itinerary: Itinerary): number {
  return Math.max(0, itinerary.totalDurationMinutes - flyingMinutes(itinerary));
}

/**
 * Describes the airline mix on a journey.
 *
 * A journey flown end to end by one carrier is a different proposition from one stitched
 * across two: baggage may not transfer, and a delay on the first leg is not the second
 * carrier's problem.
 *
 * @param itinerary - The journey to inspect.
 * @returns Distinct marketing carriers, in order of first appearance.
 */
export function carriersOn(itinerary: Itinerary): string[] {
  return [...new Set(itinerary.segments.map((segment: FlightSegment) => segment.marketingCarrier))];
}
