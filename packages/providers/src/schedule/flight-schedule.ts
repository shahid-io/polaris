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

/**
 * A departure in compact form: `[carrier, flightNumber, localTime, fareOverride?, days?]`.
 *
 * Tuples rather than objects because this file is mostly data. Roughly 150 departures in
 * object form would be four times longer and materially harder to scan for the patterns
 * that make a timetable look real — morning banks, evening peaks, sensible gaps.
 */
type Departure = readonly [
  carrier: IataAirlineCode,
  flightNumber: string,
  departure: string,
  baseFareInr?: number,
  durationMinutes?: number,
  daysOfWeek?: readonly number[],
];

interface RouteSchedule {
  origin: IataAirportCode;
  destination: IataAirportCode;
  durationMinutes: number;
  /** Route default, used by any departure that does not override it. */
  baseFareInr: number;
  departures: readonly Departure[];
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
 * Modelled on real Indian domestic patterns: IndiGo (6E) dominating frequency with Air
 * India Express (IX) on a thinner network, early-morning and evening peaks on trunk routes,
 * thinner regional schedules, a weekend-only leisure service, and a red-eye on Delhi–Mumbai
 * so the local-date canonical key has a real case to prove itself against.
 *
 * Fares scale roughly with sector length and carry route-level variation — trunk routes are
 * competitive, regional monopolistic sectors less so.
 */
const ROUTES: readonly RouteSchedule[] = [
  // ── Trunk: Delhi ↔ Mumbai ────────────────────────────────────────────────
  {
    origin: 'DEL',
    destination: 'BOM',
    durationMinutes: 130,
    baseFareInr: 5400,
    departures: [
      // A deliberate red-eye: 00:45 IST is 19:15Z the previous day. This is the flight
      // that breaks any implementation keying its canonical id on the UTC date.
      ['6E', '2134', '00:45', 4650],
      ['6E', '5017', '06:15'],
      ['IX', '1592', '07:40', 4890],
      ['6E', '6183', '09:20', 6100],
      ['6E', '2456', '13:05', 5150],
      ['IX', '1188', '17:30', 5720],
      ['6E', '778', '19:45', 6480],
      ['6E', '944', '21:55', 5980],

      // ── Real IndiGo services, matched to live data ──────────────────────
      //
      // Carrier, flight number, departure time and block time are taken from an actual
      // Google Flights response for this route, so a live IndiGo fare and these
      // representative OTA fares produce the same canonical key and land on one card.
      //
      // Without this the two data sets never intersect — the live adapter returns the
      // flights that genuinely operate, the OTAs price invented ones — so every
      // cross-provider comparison would come from simulated data alone. Real travel
      // agencies sell real IndiGo services, so an OTA offering flights that do not exist
      // was the less plausible arrangement, not the more.
      //
      // Fares are the live figures; each provider's own multiplier moves them from there.
      ['6E', '449', '05:00', 6245, 135],
      ['6E', '6814', '07:15', 6488, 135],
      ['6E', '6107', '09:30', 6087, 145],
      ['6E', '324', '13:00', 6087, 130],
      ['6E', '354', '19:00', 6488, 145],
      ['6E', '395', '21:45', 6488, 140],
    ],
  },
  {
    origin: 'BOM',
    destination: 'DEL',
    durationMinutes: 135,
    baseFareInr: 5550,
    departures: [
      ['6E', '2135', '05:50', 4980],
      ['6E', '5018', '08:25'],
      ['IX', '1593', '11:10', 5020],
      ['6E', '6184', '14:40', 6250],
      ['6E', '2457', '18:15', 6890],
      ['IX', '1189', '20:50', 5340],
    ],
  },

  // ── Trunk: Delhi ↔ Bengaluru ─────────────────────────────────────────────
  {
    origin: 'DEL',
    destination: 'BLR',
    durationMinutes: 165,
    baseFareInr: 6200,
    departures: [
      ['6E', '3021', '05:30', 5450],
      ['6E', '3155', '08:10'],
      ['IX', '2741', '12:35', 5890],
      ['6E', '3288', '16:20', 7100],
      ['6E', '3410', '20:05', 6740],
    ],
  },
  {
    origin: 'BLR',
    destination: 'DEL',
    durationMinutes: 170,
    baseFareInr: 6350,
    departures: [
      ['6E', '3022', '06:40', 5720],
      ['6E', '3156', '10:15'],
      ['IX', '2742', '15:45', 6010],
      ['6E', '3411', '21:30', 7290],
    ],
  },

  // ── Mumbai ↔ Bengaluru ───────────────────────────────────────────────────
  {
    origin: 'BOM',
    destination: 'BLR',
    durationMinutes: 105,
    baseFareInr: 4300,
    departures: [
      ['6E', '812', '07:05', 3890],
      ['IX', '674', '11:50'],
      ['6E', '857', '15:25', 4620],
      ['6E', '901', '19:10', 5080],
    ],
  },
  {
    origin: 'BLR',
    destination: 'BOM',
    durationMinutes: 100,
    baseFareInr: 4250,
    departures: [
      ['6E', '813', '06:20', 3790],
      ['6E', '858', '10:45'],
      ['IX', '675', '16:30', 4410],
      ['6E', '902', '20:40', 4980],
    ],
  },

  // ── Delhi ↔ Hyderabad ────────────────────────────────────────────────────
  {
    origin: 'DEL',
    destination: 'HYD',
    durationMinutes: 140,
    baseFareInr: 5100,
    departures: [
      ['6E', '445', '06:55', 4550],
      ['6E', '512', '10:40'],
      ['IX', '1024', '14:15', 4870],
      ['6E', '689', '18:50', 5960],
    ],
  },
  {
    origin: 'HYD',
    destination: 'DEL',
    durationMinutes: 145,
    baseFareInr: 5250,
    departures: [
      ['6E', '446', '07:35', 4690],
      ['6E', '513', '12:20'],
      ['IX', '1025', '17:05', 5110],
      ['6E', '690', '20:15', 6040],
    ],
  },

  // ── Delhi ↔ Chennai ──────────────────────────────────────────────────────
  {
    origin: 'DEL',
    destination: 'MAA',
    durationMinutes: 175,
    baseFareInr: 6050,
    departures: [
      ['6E', '2011', '05:45', 5380],
      ['6E', '2144', '11:25'],
      ['IX', '1310', '16:00', 5710],
      ['6E', '2277', '20:35', 6820],
    ],
  },
  {
    origin: 'MAA',
    destination: 'DEL',
    durationMinutes: 180,
    baseFareInr: 6180,
    departures: [
      ['6E', '2012', '06:30', 5540],
      ['6E', '2145', '13:50'],
      ['IX', '1311', '19:20', 6390],
    ],
  },

  // ── Delhi ↔ Kolkata ──────────────────────────────────────────────────────
  {
    origin: 'DEL',
    destination: 'CCU',
    durationMinutes: 135,
    baseFareInr: 5250,
    departures: [
      ['6E', '7011', '07:20', 4720],
      ['6E', '7148', '12:55'],
      ['IX', '1455', '18:30', 5490],
    ],
  },
  {
    origin: 'CCU',
    destination: 'DEL',
    durationMinutes: 140,
    baseFareInr: 5340,
    departures: [
      ['6E', '7012', '08:05', 4810],
      ['6E', '7149', '14:25'],
      ['IX', '1456', '20:10', 5620],
    ],
  },

  // ── Leisure: Goa ─────────────────────────────────────────────────────────
  {
    origin: 'BOM',
    destination: 'GOI',
    durationMinutes: 70,
    baseFareInr: 3100,
    departures: [
      ['6E', '5301', '06:30', 2790],
      ['IX', '881', '10:05'],
      ['6E', '5422', '14:40', 3380],
      ['6E', '5588', '18:55', 3640],
    ],
  },
  {
    origin: 'GOI',
    destination: 'BOM',
    durationMinutes: 70,
    baseFareInr: 3050,
    departures: [
      ['6E', '5302', '08:15', 2740],
      ['IX', '882', '12:30'],
      ['6E', '5589', '20:45', 3510],
    ],
  },
  {
    origin: 'DEL',
    destination: 'GOI',
    durationMinutes: 155,
    baseFareInr: 5800,
    departures: [
      ['6E', '4102', '08:45'],
      ['IX', '1720', '13:20', 5410],
      // Weekend-only, so the schedule exercises day-of-week handling.
      ['6E', '4315', '17:10', undefined, undefined, [5, 6, 0]],
    ],
  },
  {
    origin: 'GOI',
    destination: 'DEL',
    durationMinutes: 160,
    baseFareInr: 5900,
    departures: [
      ['6E', '4103', '11:35'],
      ['IX', '1721', '16:15', 5520],
    ],
  },

  // ── Western sectors ──────────────────────────────────────────────────────
  {
    origin: 'DEL',
    destination: 'PNQ',
    durationMinutes: 125,
    baseFareInr: 5350,
    departures: [
      ['6E', '6011', '07:50', 4820],
      ['6E', '6177', '15:35'],
      ['IX', '2380', '20:25', 5610],
    ],
  },
  {
    origin: 'PNQ',
    destination: 'DEL',
    durationMinutes: 130,
    baseFareInr: 5420,
    departures: [
      ['6E', '6012', '09:30', 4910],
      ['6E', '6178', '18:05'],
    ],
  },
  {
    origin: 'DEL',
    destination: 'AMD',
    durationMinutes: 95,
    baseFareInr: 4200,
    departures: [
      ['6E', '881', '06:10', 3740],
      ['IX', '2205', '12:20'],
      ['6E', '967', '19:25', 4680],
    ],
  },
  {
    origin: 'BOM',
    destination: 'AMD',
    durationMinutes: 75,
    baseFareInr: 3200,
    departures: [
      ['6E', '621', '07:15', 2880],
      ['6E', '744', '17:40', 3450],
    ],
  },
  {
    origin: 'BOM',
    destination: 'HYD',
    durationMinutes: 85,
    baseFareInr: 3700,
    departures: [
      ['6E', '1105', '06:45', 3320],
      ['IX', '512', '11:20'],
      ['6E', '1288', '19:35', 4010],
    ],
  },

  // ── Southern sectors ─────────────────────────────────────────────────────
  {
    origin: 'BLR',
    destination: 'COK',
    durationMinutes: 75,
    baseFareInr: 3050,
    departures: [
      ['6E', '7702', '09:15'],
      ['IX', '415', '16:45', 2880],
    ],
  },
  {
    origin: 'BLR',
    destination: 'MAA',
    durationMinutes: 60,
    baseFareInr: 2700,
    departures: [
      ['6E', '4801', '07:00', 2450],
      ['6E', '4877', '13:30'],
      ['IX', '338', '19:50', 2890],
    ],
  },
  {
    origin: 'BLR',
    destination: 'HYD',
    durationMinutes: 70,
    baseFareInr: 2950,
    departures: [
      ['6E', '5011', '06:35', 2680],
      ['6E', '5144', '15:10'],
    ],
  },
  {
    origin: 'BOM',
    destination: 'COK',
    durationMinutes: 115,
    baseFareInr: 4600,
    departures: [
      ['6E', '281', '08:40', 4180],
      ['IX', '928', '18:20'],
    ],
  },
  {
    origin: 'DEL',
    destination: 'TRV',
    durationMinutes: 200,
    baseFareInr: 7400,
    departures: [
      ['6E', '1531', '05:15', 6720],
      ['IX', '1442', '14:55'],
    ],
  },

  // ── Northern and eastern regional ────────────────────────────────────────
  {
    origin: 'DEL',
    destination: 'JAI',
    durationMinutes: 60,
    baseFareInr: 2600,
    departures: [
      ['6E', '2091', '07:25', 2340],
      ['6E', '2188', '16:50'],
    ],
  },
  {
    origin: 'DEL',
    destination: 'LKO',
    durationMinutes: 70,
    baseFareInr: 2900,
    departures: [
      ['6E', '3355', '08:00', 2620],
      ['6E', '3492', '18:40'],
      ['IX', '761', '13:15', 2780],
    ],
  },
  {
    origin: 'DEL',
    destination: 'IXC',
    durationMinutes: 55,
    baseFareInr: 2450,
    departures: [
      ['6E', '891', '09:05', 2210],
      ['6E', '976', '19:15'],
    ],
  },
  {
    origin: 'DEL',
    destination: 'SXR',
    durationMinutes: 85,
    baseFareInr: 3900,
    departures: [
      ['6E', '2027', '06:05', 3520],
      ['IX', '1817', '11:40'],
    ],
  },
  {
    origin: 'DEL',
    destination: 'PAT',
    durationMinutes: 110,
    baseFareInr: 4300,
    departures: [
      ['6E', '6511', '07:45', 3880],
      ['6E', '6644', '15:05'],
    ],
  },
  {
    origin: 'DEL',
    destination: 'VNS',
    durationMinutes: 95,
    baseFareInr: 3800,
    departures: [
      ['6E', '5031', '10:20', 3440],
      ['IX', '1093', '17:55'],
    ],
  },
  {
    origin: 'DEL',
    destination: 'GAU',
    durationMinutes: 155,
    baseFareInr: 5600,
    departures: [
      ['6E', '7255', '06:50', 5040],
      ['6E', '7388', '14:10'],
    ],
  },
  {
    origin: 'DEL',
    destination: 'BBI',
    durationMinutes: 130,
    baseFareInr: 5100,
    departures: [
      ['6E', '6021', '09:40', 4590],
      ['IX', '1266', '18:10'],
    ],
  },
  {
    origin: 'DEL',
    destination: 'NAG',
    durationMinutes: 110,
    baseFareInr: 4400,
    departures: [
      ['6E', '3811', '08:30', 3970],
      ['6E', '3944', '17:20'],
    ],
  },
  {
    origin: 'DEL',
    destination: 'IDR',
    durationMinutes: 95,
    baseFareInr: 4050,
    departures: [
      ['6E', '2711', '11:00', 3650],
      ['6E', '2866', '19:40'],
    ],
  },
  {
    origin: 'CCU',
    destination: 'IXB',
    durationMinutes: 65,
    baseFareInr: 2800,
    departures: [
      ['6E', '8021', '08:20', 2520],
      ['6E', '8155', '15:50'],
    ],
  },
  {
    origin: 'CCU',
    destination: 'GAU',
    durationMinutes: 70,
    baseFareInr: 2950,
    departures: [
      ['6E', '8311', '09:50', 2660],
      ['IX', '624', '17:25'],
    ],
  },
];

/** Flattened timetable, built once at module load. */
const ALL_FLIGHTS: readonly ScheduledFlight[] = ROUTES.flatMap((route) =>
  route.departures.map(
    ([carrier, flightNumber, departure, baseFareInr, durationMinutes, daysOfWeek]) => ({
      carrier,
      flightNumber,
      origin: route.origin,
      destination: route.destination,
      departure,
      durationMinutes: durationMinutes ?? route.durationMinutes,
      baseFareInr: baseFareInr ?? route.baseFareInr,
      ...(daysOfWeek ? { daysOfWeek } : {}),
    }),
  ),
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

/**
 * Destinations reachable from an origin.
 *
 * Lets the UI narrow the destination picker to routes that actually have flights, so a user
 * cannot construct a search that returns nothing.
 *
 * @param origin - Origin IATA code.
 * @returns Destination codes served from that origin, sorted.
 */
export function destinationsFrom(origin: string): IataAirportCode[] {
  return ROUTES.filter((route) => route.origin === origin)
    .map((route) => route.destination)
    .sort();
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
