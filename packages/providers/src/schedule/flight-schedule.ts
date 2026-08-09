import type { IataAirlineCode, IataAirportCode } from '@polaris/contracts';

/** One scheduled departure, before any provider prices it. */
export interface ScheduledFlight {
  carrier: IataAirlineCode;
  /** Digits only, without the carrier prefix. */
  flightNumber: string;
  origin: IataAirportCode;
  destination: IataAirportCode;
  /** Local departure time at the origin, `HH:MM`. */
  departure: string;
  durationMinutes: number;
  /** Baseline one-way economy fare per adult, in whole rupees, before provider markup. */
  baseFareInr: number;
  /** Days operated, 0 = Sunday. Absent means daily. */
  daysOfWeek?: readonly number[];
}

interface RouteSchedule {
  origin: IataAirportCode;
  destination: IataAirportCode;
  durationMinutes: number;
  baseFareInr: number;
  departures: readonly {
    carrier: IataAirlineCode;
    flightNumber: string;
    departure: string;
    /** Overrides the route default, for a flight that is unusually cheap or dear. */
    baseFareInr?: number;
    durationMinutes?: number;
    daysOfWeek?: readonly number[];
  }[];
}

/**
 * The shared timetable every representative provider draws from.
 *
 * This being *shared* is the entire point. If each provider invented its own flights,
 * nothing would ever deduplicate and the comparison the product exists to make would have
 * nothing to compare. Because MakeMyTrip, Goibibo and Cleartrip all price the same
 * underlying departures, the same flight genuinely appears across providers at different
 * prices — which is the behaviour the brief asks us to handle.
 *
 * Carriers, flight numbers and departure banks are modelled on real Indian domestic
 * patterns: IndiGo (6E) dominating frequency, Air India Express (IX) on a thinner network,
 * early-morning and evening peaks, and a red-eye on the trunk route so the local-date
 * canonical key has something real to prove itself against.
 */
const ROUTES: readonly RouteSchedule[] = [
  {
    origin: 'DEL',
    destination: 'BOM',
    durationMinutes: 130,
    baseFareInr: 5400,
    departures: [
      // A deliberate red-eye: 00:45 IST is 19:15Z the previous day. This is the flight
      // that breaks any implementation keying its canonical id on the UTC date.
      { carrier: '6E', flightNumber: '2134', departure: '00:45', baseFareInr: 4650 },
      { carrier: '6E', flightNumber: '5017', departure: '06:15' },
      { carrier: 'IX', flightNumber: '1592', departure: '07:40', baseFareInr: 4890 },
      { carrier: '6E', flightNumber: '6183', departure: '09:20', baseFareInr: 6100 },
      { carrier: '6E', flightNumber: '2456', departure: '13:05', baseFareInr: 5150 },
      { carrier: 'IX', flightNumber: '1188', departure: '17:30', baseFareInr: 5720 },
      { carrier: '6E', flightNumber: '778', departure: '19:45', baseFareInr: 6480 },
      { carrier: '6E', flightNumber: '944', departure: '21:55', baseFareInr: 5980 },
    ],
  },
  {
    origin: 'BOM',
    destination: 'DEL',
    durationMinutes: 135,
    baseFareInr: 5550,
    departures: [
      { carrier: '6E', flightNumber: '2135', departure: '05:50', baseFareInr: 4980 },
      { carrier: '6E', flightNumber: '5018', departure: '08:25' },
      { carrier: 'IX', flightNumber: '1593', departure: '11:10', baseFareInr: 5020 },
      { carrier: '6E', flightNumber: '6184', departure: '14:40', baseFareInr: 6250 },
      { carrier: '6E', flightNumber: '2457', departure: '18:15', baseFareInr: 6890 },
      { carrier: 'IX', flightNumber: '1189', departure: '20:50', baseFareInr: 5340 },
    ],
  },
  {
    origin: 'DEL',
    destination: 'BLR',
    durationMinutes: 165,
    baseFareInr: 6200,
    departures: [
      { carrier: '6E', flightNumber: '3021', departure: '05:30', baseFareInr: 5450 },
      { carrier: '6E', flightNumber: '3155', departure: '08:10' },
      { carrier: 'IX', flightNumber: '2741', departure: '12:35', baseFareInr: 5890 },
      { carrier: '6E', flightNumber: '3288', departure: '16:20', baseFareInr: 7100 },
      { carrier: '6E', flightNumber: '3410', departure: '20:05', baseFareInr: 6740 },
    ],
  },
  {
    origin: 'BLR',
    destination: 'DEL',
    durationMinutes: 170,
    baseFareInr: 6350,
    departures: [
      { carrier: '6E', flightNumber: '3022', departure: '06:40', baseFareInr: 5720 },
      { carrier: '6E', flightNumber: '3156', departure: '10:15' },
      { carrier: 'IX', flightNumber: '2742', departure: '15:45', baseFareInr: 6010 },
      { carrier: '6E', flightNumber: '3411', departure: '21:30', baseFareInr: 7290 },
    ],
  },
  {
    origin: 'BOM',
    destination: 'BLR',
    durationMinutes: 105,
    baseFareInr: 4300,
    departures: [
      { carrier: '6E', flightNumber: '812', departure: '07:05', baseFareInr: 3890 },
      { carrier: 'IX', flightNumber: '674', departure: '11:50' },
      { carrier: '6E', flightNumber: '857', departure: '15:25', baseFareInr: 4620 },
      { carrier: '6E', flightNumber: '901', departure: '19:10', baseFareInr: 5080 },
    ],
  },
  {
    origin: 'DEL',
    destination: 'HYD',
    durationMinutes: 140,
    baseFareInr: 5100,
    departures: [
      { carrier: '6E', flightNumber: '445', departure: '06:55', baseFareInr: 4550 },
      { carrier: '6E', flightNumber: '512', departure: '10:40' },
      { carrier: 'IX', flightNumber: '1024', departure: '14:15', baseFareInr: 4870 },
      { carrier: '6E', flightNumber: '689', departure: '18:50', baseFareInr: 5960 },
    ],
  },
  {
    origin: 'DEL',
    destination: 'MAA',
    durationMinutes: 175,
    baseFareInr: 6050,
    departures: [
      { carrier: '6E', flightNumber: '2011', departure: '05:45', baseFareInr: 5380 },
      { carrier: '6E', flightNumber: '2144', departure: '11:25' },
      { carrier: 'IX', flightNumber: '1310', departure: '16:00', baseFareInr: 5710 },
      { carrier: '6E', flightNumber: '2277', departure: '20:35', baseFareInr: 6820 },
    ],
  },
  {
    origin: 'DEL',
    destination: 'CCU',
    durationMinutes: 135,
    baseFareInr: 5250,
    departures: [
      { carrier: '6E', flightNumber: '7011', departure: '07:20', baseFareInr: 4720 },
      { carrier: '6E', flightNumber: '7148', departure: '12:55' },
      { carrier: 'IX', flightNumber: '1455', departure: '18:30', baseFareInr: 5490 },
    ],
  },
  {
    origin: 'BOM',
    destination: 'GOI',
    durationMinutes: 70,
    baseFareInr: 3100,
    departures: [
      { carrier: '6E', flightNumber: '5301', departure: '06:30', baseFareInr: 2790 },
      { carrier: 'IX', flightNumber: '881', departure: '10:05' },
      { carrier: '6E', flightNumber: '5422', departure: '14:40', baseFareInr: 3380 },
      { carrier: '6E', flightNumber: '5588', departure: '18:55', baseFareInr: 3640 },
    ],
  },
  {
    origin: 'DEL',
    destination: 'GOI',
    durationMinutes: 155,
    baseFareInr: 5800,
    departures: [
      { carrier: '6E', flightNumber: '4102', departure: '08:45' },
      { carrier: 'IX', flightNumber: '1720', departure: '13:20', baseFareInr: 5410 },
      // Weekend-only, so the schedule exercises day-of-week handling.
      { carrier: '6E', flightNumber: '4315', departure: '17:10', daysOfWeek: [5, 6, 0] },
    ],
  },
  {
    origin: 'DEL',
    destination: 'PNQ',
    durationMinutes: 125,
    baseFareInr: 5350,
    departures: [
      { carrier: '6E', flightNumber: '6011', departure: '07:50', baseFareInr: 4820 },
      { carrier: '6E', flightNumber: '6177', departure: '15:35' },
    ],
  },
  {
    origin: 'DEL',
    destination: 'AMD',
    durationMinutes: 95,
    baseFareInr: 4200,
    departures: [
      { carrier: '6E', flightNumber: '881', departure: '06:10', baseFareInr: 3740 },
      { carrier: 'IX', flightNumber: '2205', departure: '12:20' },
      { carrier: '6E', flightNumber: '967', departure: '19:25', baseFareInr: 4680 },
    ],
  },
  {
    origin: 'BLR',
    destination: 'COK',
    durationMinutes: 75,
    baseFareInr: 3050,
    departures: [
      { carrier: '6E', flightNumber: '7702', departure: '09:15' },
      { carrier: 'IX', flightNumber: '415', departure: '16:45', baseFareInr: 2880 },
    ],
  },
];

/** Flattened timetable, built once at module load. */
const ALL_FLIGHTS: readonly ScheduledFlight[] = ROUTES.flatMap((route) =>
  route.departures.map((departure) => ({
    carrier: departure.carrier,
    flightNumber: departure.flightNumber,
    origin: route.origin,
    destination: route.destination,
    departure: departure.departure,
    durationMinutes: departure.durationMinutes ?? route.durationMinutes,
    baseFareInr: departure.baseFareInr ?? route.baseFareInr,
    ...(departure.daysOfWeek ? { daysOfWeek: departure.daysOfWeek } : {}),
  })),
);

/**
 * Finds every scheduled flight on a route for a given date.
 *
 * @param origin - Origin IATA code.
 * @param destination - Destination IATA code.
 * @param isoDate - Travel date, `YYYY-MM-DD`, local to the origin.
 * @returns Flights operating that day, ordered by departure time. Empty when the route
 *   is not served — a legitimate answer, not an error.
 *
 * @example
 * ```ts
 * findFlights('DEL', 'BOM', '2026-08-20'); // 8 departures
 * findFlights('DEL', 'XYZ', '2026-08-20'); // []
 * ```
 */
export function findFlights(
  origin: string,
  destination: string,
  isoDate: string,
): ScheduledFlight[] {
  const dayOfWeek = dayOfWeekFor(isoDate);

  return ALL_FLIGHTS.filter(
    (flight) =>
      flight.origin === origin &&
      flight.destination === destination &&
      (flight.daysOfWeek === undefined || flight.daysOfWeek.includes(dayOfWeek)),
  ).sort((a, b) => a.departure.localeCompare(b.departure));
}

/** @returns Every route pair the schedule serves, for diagnostics and UI hints. */
export function servedRoutes(): { origin: IataAirportCode; destination: IataAirportCode }[] {
  return ROUTES.map((route) => ({ origin: route.origin, destination: route.destination }));
}

/** @returns The complete flattened timetable. Intended for tests and tooling. */
export function allScheduledFlights(): readonly ScheduledFlight[] {
  return ALL_FLIGHTS;
}

/**
 * Day of week for a calendar date, without timezone interference.
 *
 * Parses the parts and uses `Date.UTC` rather than `new Date('2026-08-20')`, which some
 * runtimes interpret in local time — shifting the day and, for a weekend-only flight,
 * making it appear or vanish depending on where the server runs.
 *
 * @param isoDate - `YYYY-MM-DD`.
 * @returns 0 for Sunday through 6 for Saturday.
 * @internal
 */
function dayOfWeekFor(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay();
}
