/**
 * Airports offered in the search form.
 *
 * Held as static config rather than fetched: the list changes rarely, and a network round
 * trip before the user can type an origin is latency spent for nothing. It also means the
 * form works before the API is reachable, so a user gets a real error on submit rather
 * than an inexplicably empty dropdown.
 *
 * Mirrors the airports the representative timetable serves — offering a route with no
 * flights would be a worse experience than not offering it.
 */
export interface AirportOption {
  code: string;
  city: string;
  name: string;
}

export const AIRPORTS: readonly AirportOption[] = [
  { code: 'DEL', city: 'Delhi', name: 'Indira Gandhi International' },
  { code: 'BOM', city: 'Mumbai', name: 'Chhatrapati Shivaji Maharaj International' },
  { code: 'BLR', city: 'Bengaluru', name: 'Kempegowda International' },
  { code: 'MAA', city: 'Chennai', name: 'Chennai International' },
  { code: 'HYD', city: 'Hyderabad', name: 'Rajiv Gandhi International' },
  { code: 'CCU', city: 'Kolkata', name: 'Netaji Subhas Chandra Bose International' },
  { code: 'GOI', city: 'Goa', name: 'Dabolim' },
  { code: 'PNQ', city: 'Pune', name: 'Pune International' },
  { code: 'AMD', city: 'Ahmedabad', name: 'Sardar Vallabhbhai Patel International' },
  { code: 'COK', city: 'Kochi', name: 'Cochin International' },
] as const;

/** Routes the representative providers actually serve, for the "try these" hints. */
export const POPULAR_ROUTES = [
  { origin: 'DEL', destination: 'BOM' },
  { origin: 'DEL', destination: 'BLR' },
  { origin: 'BOM', destination: 'GOI' },
  { origin: 'DEL', destination: 'HYD' },
] as const;

/**
 * Looks up an airport by code.
 *
 * @param code - IATA code.
 * @returns The airport, or `undefined` when not offered.
 */
export function findAirportOption(code: string): AirportOption | undefined {
  return AIRPORTS.find((airport) => airport.code === code);
}
