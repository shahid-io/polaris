import type { IataAirportCode } from '@polaris/contracts';

/** An airport, with the timezone needed to resolve local departure times. */
export interface Airport {
  code: IataAirportCode;
  city: string;
  name: string;
  /** IANA zone, carried on every {@link ScheduledTime} the adapters produce. */
  timeZone: string;
  /**
   * Fixed offset from UTC in minutes.
   *
   * A fixed offset is correct for every airport here because India observes UTC+05:30
   * year-round with no daylight saving. It is recorded per airport rather than as a
   * global constant so that adding an airport in a DST-observing country surfaces as an
   * obvious wrong value rather than a silent one-hour error — at which point this field
   * should become a real timezone lookup. Noted in docs/LIMITATIONS.md.
   */
  utcOffsetMinutes: number;
}

const IST = { timeZone: 'Asia/Kolkata', utcOffsetMinutes: 330 } as const;

/**
 * Airports served by the prototype.
 *
 * The busiest Indian domestic airports, which is where the five providers in the brief
 * overlap most and therefore where cross-provider comparison is most meaningful.
 */
export const AIRPORTS: readonly Airport[] = [
  { code: 'DEL', city: 'Delhi', name: 'Indira Gandhi International', ...IST },
  { code: 'BOM', city: 'Mumbai', name: 'Chhatrapati Shivaji Maharaj International', ...IST },
  { code: 'BLR', city: 'Bengaluru', name: 'Kempegowda International', ...IST },
  { code: 'MAA', city: 'Chennai', name: 'Chennai International', ...IST },
  { code: 'HYD', city: 'Hyderabad', name: 'Rajiv Gandhi International', ...IST },
  { code: 'CCU', city: 'Kolkata', name: 'Netaji Subhas Chandra Bose International', ...IST },
  { code: 'GOI', city: 'Goa', name: 'Dabolim', ...IST },
  { code: 'PNQ', city: 'Pune', name: 'Pune International', ...IST },
  { code: 'AMD', city: 'Ahmedabad', name: 'Sardar Vallabhbhai Patel International', ...IST },
  { code: 'COK', city: 'Kochi', name: 'Cochin International', ...IST },
];

const AIRPORTS_BY_CODE = new Map(AIRPORTS.map((airport) => [airport.code, airport]));

/**
 * Looks up an airport by IATA code.
 *
 * @param code - Three-letter IATA code, uppercase.
 * @returns The airport, or `undefined` when not served.
 */
export function findAirport(code: string): Airport | undefined {
  return AIRPORTS_BY_CODE.get(code);
}

/**
 * Looks up an airport, failing loudly when it is unknown.
 *
 * Used on paths where the code has already been validated against the schedule, so an
 * unknown code means a programming error rather than bad user input — and should not be
 * silently defaulted to some other city's timezone.
 *
 * @param code - Three-letter IATA code.
 * @returns The airport.
 * @throws {Error} When the airport is not in {@link AIRPORTS}.
 */
export function requireAirport(code: string): Airport {
  const airport = AIRPORTS_BY_CODE.get(code);
  if (!airport) {
    throw new Error(`Unknown airport: ${code}`);
  }
  return airport;
}
