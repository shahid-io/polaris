import {
  normalizedOfferSchema,
  type Benefit,
  type CabinClass,
  type FlightSegment,
  type NormalizedOffer,
  type SearchQuery,
} from '@polaris/contracts';
import type { ProviderContext } from '../../types';
import {
  baggageKg,
  durationBetween,
  flightNumberOf,
  scheduledFromLocal,
  toMinor,
} from '../site-helpers';
import type { SiteMappingResult, WebSearchParams, WebSearchSite } from '../web-session-site';

/**
 * @packageDocumentation
 * EaseMyTrip's public flight search, read from its own results page.
 *
 * Integrated because MakeMyTrip and Goibibo could not be: both refuse automated clients at
 * their CDN edge, so without another real agency the entire OTA side of the comparison
 * would have rested on generated data. EaseMyTrip serves its public search without
 * objection, so it supplies real agency fares in their place.
 *
 * The page posts to `AirAvail_Lights/AirBus_New` and renders the response. That payload is
 * aggressively abbreviated, `j`, `s`, `b`, `TF`, `AP`, `APT`, and carries packed
 * backtick-delimited provider tokens, but the parts this needs are clean: `dctFltDtl` is a
 * flat table of legs keyed by index, and each itinerary references it by position.
 *
 * It is the only source here that reports **seats remaining** alongside a fare.
 */

/** One leg, from the flat `dctFltDtl` table. */
interface EmtLeg {
  /** Origin IATA. */
  OG: string;
  /** Destination IATA. */
  DT: string;
  /** Departure date as `Fri-28Aug2026`. */
  DDT: string;
  /** Arrival date, same format. */
  ADT: string;
  /** Departure time, `HH:MM` local. */
  DTM: string;
  /** Arrival time, `HH:MM` local. */
  ATM: string;
  /** Flight number, digits only. */
  FN: string;
  /** Airline IATA designator. */
  AC: string;
  /** Cabin, e.g. `ECONOMY`. */
  CB?: string;
  /** Checked baggage weight. */
  BW?: string;
  /** Hand baggage weight. */
  HBW?: string;
  /** Equipment description, e.g. `Boeing 737 (Narrow-body)`. */
  ET?: string;
  /** Seats remaining at this fare. */
  SA?: string;
}

/** One purchasable itinerary and fare. */
interface EmtItinerary {
  /** Total fare for the party, in whole rupees. */
  TF?: number;
  /** Adult base fare. */
  AP?: number;
  /** Adult tax. */
  APT?: number;
  /** Total tax. */
  TT?: number;
  /** Fare product name, e.g. `Saver`. */
  FN?: string;
  /** Seats available. */
  SeatAv?: string;
  Refundable?: boolean | null;
  /** Fare perks as free text, e.g. `["7 Kgs"]`. */
  FarebenefitNew?: string[] | null;
  /** Leg groupings; `FL` holds indices into `dctFltDtl`. */
  b?: { FL?: number[] }[];
}

/** The subset of the response this mapper consumes. */
export interface EmtSearchResponse {
  /** Journeys; one entry for a one-way search. */
  j?: { s?: EmtItinerary[] }[];
  /** Flat leg table, keyed by stringified index. */
  dctFltDtl?: Record<string, EmtLeg>;
  /** Echoed departure date, `YYYY-MM-DD`. */
  d?: unknown;
  /** Echoed request, present on responses this adapter records. */
  SearchRequest?: { deptDT?: string };
  /** Departure date echoed at the top level on some responses. */
  deptDT?: string;
}

/** EaseMyTrip's cabin codes, as its own search form submits them. */
const CABIN_CODES: Record<CabinClass, string> = {
  economy: '0',
  premium_economy: '1',
  business: '2',
  first: '3',
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const easeMyTripSite: WebSearchSite<EmtSearchResponse> = {
  providerId: 'easemytrip',
  displayName: 'EaseMyTrip',
  integrationNote:
    'No self-service partner API. Its public results page is client-rendered and posts to ' +
    'its own availability service, so a browser session reads the same structured response ' +
    'its front end receives: real, current agency fares. Integrated in place of MakeMyTrip ' +
    'and Goibibo, both of which refuse automated clients at their CDN edge. The endpoint is ' +
    'undocumented and unversioned, so this is reported as browser-automation rather than as ' +
    'a contracted live API.',

  buildUrl(params: WebSearchParams): string {
    const [year, month, day] = params.departureDate.split('-');
    // EaseMyTrip encodes the whole search into one `srch` parameter, pipe-delimited, with
    // the date as DD/MM/YYYY. City and country names are cosmetic; only the codes matter.
    const srch = `${params.origin}-City-India|${params.destination}-City-India|${day}/${month}/${year}`;
    const query = new URLSearchParams({
      srch,
      px: `${params.adults}-0-0`,
      cbn: CABIN_CODES[params.cabinClass],
      ar: 'undefined',
      isow: 'true',
      isdm: 'true',
      lang: 'en-us',
      IsDoubleSeat: 'false',
      CCODE: 'IN',
      curr: 'INR',
      apptype: 'B2C',
    });
    return `https://flight.easemytrip.com/FlightList/Index?${query.toString()}`;
  },

  matchesSearchResponse(url: string, method: string): boolean {
    return method === 'POST' && url.includes('AirAvail_Lights/AirBus_New');
  },

  parse(body: string): EmtSearchResponse | undefined {
    try {
      return JSON.parse(body) as EmtSearchResponse;
    } catch {
      return undefined;
    }
  },

  recordedDateOf(response: EmtSearchResponse): string | undefined {
    // The response does not echo the request date in a dedicated field, so it is taken
    // from the legs themselves: every leg of a one-way search departs on the search date,
    // and the earliest departure is therefore that date. Deriving it from the data rather
    // than trusting a filename is the point of the check.
    const dates = Object.values(response.dctFltDtl ?? {})
      .map((leg) => parseEmtDate(leg.DDT))
      .filter((value): value is string => Boolean(value))
      .sort();

    return dates[0];
  },

  toOffers(
    response: EmtSearchResponse,
    query: SearchQuery,
    ctx: ProviderContext,
    live: boolean,
  ): SiteMappingResult {
    const legs = response.dctFltDtl ?? {};
    const offers: NormalizedOffer[] = [];
    let droppedOfferCount = 0;

    for (const journey of response.j ?? []) {
      for (const itinerary of journey.s ?? []) {
        const indices = (itinerary.b ?? []).flatMap((group) => group.FL ?? []);
        const segments = segmentsOf(indices, legs);
        if (!segments.length) continue;

        const first = segments[0]!;
        const last = segments[segments.length - 1]!;

        // Like Cleartrip, EaseMyTrip substitutes nearby airports (DXN for DEL). A flight
        // from a different airport is not the same flight at a better price.
        if (first.origin !== query.origin || last.destination !== query.destination) continue;

        const candidate = toOffer(itinerary, segments, legs[String(indices[0])], query, ctx, live);
        const parsed = normalizedOfferSchema.safeParse(candidate);

        if (parsed.success) offers.push(parsed.data);
        else droppedOfferCount += 1;
      }
    }

    return { offers, droppedOfferCount };
  },
};

/**
 * Builds one offer from an itinerary.
 *
 * @internal
 */
function toOffer(
  itinerary: EmtItinerary,
  segments: FlightSegment[],
  firstLeg: EmtLeg | undefined,
  query: SearchQuery,
  ctx: ProviderContext,
  live: boolean,
): NormalizedOffer {
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const fareFamily = itinerary.FN?.trim();
  const seats = Number(itinerary.SeatAv);

  return {
    id: `easemytrip-${segments.map((s) => `${s.marketingCarrier}${s.flightNumber}`).join('-')}-${first.departure.local.slice(11, 16)}-${fareFamily ?? 'FARE'}`,
    providerId: 'easemytrip',
    providerDisplayName: 'EaseMyTrip',
    integrationType: live ? 'browser-automation' : 'representative',
    itinerary: {
      segments,
      origin: first.origin,
      destination: last.destination,
      totalDurationMinutes: durationBetween(first.departure, last.arrival),
      stops: segments.length - 1,
    },
    price: {
      total: { amountMinor: toMinor(itinerary.TF), currency: 'INR' },
      // AP and APT are per-adult; they reconcile to TF only for a single passenger, so the
      // breakdown is published only when it actually adds up. A split that does not
      // reconcile is worse than none: it invites a reader to trust arithmetic that is wrong.
      ...(itinerary.AP !== undefined &&
      itinerary.APT !== undefined &&
      itinerary.AP + itinerary.APT === itinerary.TF
        ? {
            baseFare: { amountMinor: toMinor(itinerary.AP), currency: 'INR' },
            taxesAndFees: { amountMinor: toMinor(itinerary.APT), currency: 'INR' },
          }
        : {}),
    },
    cabinClass: query.cabinClass,
    ...(fareFamily ? { fareFamily } : {}),
    benefits: toBenefits(itinerary),
    ...baggageOf(firstLeg),
    ...(typeof itinerary.Refundable === 'boolean' ? { refundable: itinerary.Refundable } : {}),
    // Reported per fare, and the only source here that supplies it. Capped at a sane bound:
    // these sites report a bucket ceiling rather than true inventory.
    ...(Number.isFinite(seats) && seats > 0 ? { seatsAvailable: Math.min(seats, 9) } : {}),
    deepLink: easeMyTripSite.buildUrl({
      origin: first.origin,
      destination: last.destination,
      departureDate: query.departureDate,
      adults: query.passengers,
      cabinClass: query.cabinClass,
    }),
    retrievedAt: ctx.now.toISOString(),
  };
}

/**
 * Resolves an itinerary's segments from indices into the flat leg table.
 *
 * @returns Segments in order, or empty if any index is missing: a partial itinerary would
 *   quote a through-fare for a journey missing a leg.
 * @internal
 */
function segmentsOf(indices: number[], legs: Record<string, EmtLeg>): FlightSegment[] {
  const segments: FlightSegment[] = [];

  for (const index of indices) {
    const leg = legs[String(index)];
    if (!leg) return [];

    const departureDate = parseEmtDate(leg.DDT);
    const arrivalDate = parseEmtDate(leg.ADT);
    if (!departureDate || !arrivalDate) return [];

    // EaseMyTrip pads some flight numbers with a leading space, e.g. `" 815"`.
    const flightNumber = flightNumberOf(leg.FN);
    if (!flightNumber) return [];

    const departure = scheduledFromLocal(departureDate, leg.DTM);
    const arrival = scheduledFromLocal(arrivalDate, leg.ATM);

    segments.push({
      marketingCarrier: leg.AC.trim(),
      flightNumber,
      origin: leg.OG,
      destination: leg.DT,
      departure,
      arrival,
      durationMinutes: durationBetween(departure, arrival),
      ...(leg.ET?.trim() ? { aircraft: leg.ET.trim() } : {}),
    });
  }

  return segments;
}

/**
 * Converts EaseMyTrip's `Fri-28Aug2026` date into `YYYY-MM-DD`.
 *
 * @param raw - The site's date string.
 * @returns An ISO date, or `undefined` when unparseable.
 * @internal
 */
function parseEmtDate(raw: string | undefined): string | undefined {
  const match = /(\d{1,2})([A-Za-z]{3})(\d{4})/.exec(raw ?? '');
  if (!match) return undefined;

  const [, day, monthName, year] = match;
  const monthIndex = MONTHS.findIndex((m) => m.toLowerCase() === monthName!.toLowerCase());
  if (monthIndex < 0) return undefined;

  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day!.padStart(2, '0')}`;
}

/**
 * Maps the fare's free-text perks into benefits.
 *
 * EaseMyTrip states these as bare phrases rather than typed flags, so they are carried as
 * labels. Nothing is assigned a monetary value: inventing one would let this provider's
 * marketing copy move it up the ranking.
 *
 * @internal
 */
function toBenefits(itinerary: EmtItinerary): Benefit[] {
  const benefits: Benefit[] = [];

  for (const raw of itinerary.FarebenefitNew ?? []) {
    const label = raw?.trim();
    if (!label) continue;

    // A bare weight like "7 Kgs" describes the hand baggage allowance, which is carried
    // structurally on `baggage` rather than duplicated as a perk.
    if (/^\d+\s*kgs?$/i.test(label)) continue;

    benefits.push({
      type: /meal/i.test(label)
        ? 'free_meal'
        : /seat/i.test(label)
          ? 'free_seat'
          : /cancel/i.test(label)
            ? 'free_cancellation'
            : 'other',
      label,
      conditional: false,
    });
  }

  return benefits;
}

/**
 * Reads the baggage allowance off the first leg.
 *
 * The allowance is a property of the fare and EaseMyTrip repeats it per leg, so the first
 * leg is representative for the single-carrier itineraries this covers. Omitted entirely
 * when neither figure parses, rather than defaulted to zero: "no checked bag" and "we do
 * not know" are different claims, and only one of them is true here.
 *
 * @internal
 */
function baggageOf(leg: EmtLeg | undefined): {
  baggage?: { cabinKg?: number; checkedKg?: number };
} {
  const cabinKg = baggageKg(leg?.HBW);
  const checkedKg = baggageKg(leg?.BW);
  if (cabinKg === undefined && checkedKg === undefined) return {};

  return {
    baggage: {
      ...(cabinKg !== undefined ? { cabinKg } : {}),
      ...(checkedKg !== undefined ? { checkedKg } : {}),
    },
  };
}
