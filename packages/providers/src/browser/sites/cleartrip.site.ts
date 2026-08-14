import {
  normalizedOfferSchema,
  type Benefit,
  type CabinClass,
  type FlightSegment,
  type NormalizedOffer,
  type SearchQuery,
} from '@polaris/contracts';
import type { ProviderContext } from '../../types';
import { durationBetween, scheduledFromIso, toMinor } from '../site-helpers';
import type { SiteMappingResult, WebSearchParams, WebSearchSite } from '../web-session-site';

/**
 * @packageDocumentation
 * Cleartrip's public flight search, read from its own results page.
 *
 * Its results page is a client-rendered app that asks its own backend for
 * `/flight/search/v2` and renders the JSON it receives. Capturing that response gives the
 * same structured data its front end works from: no selectors to break, named fields, and
 * numbers that are typed rather than parsed back out of "₹5,942".
 *
 * The payload is the richest of the three agencies read this way. It carries the operating
 * carrier separately from the marketing carrier, a real IANA zone per airport, and the
 * base-fare/tax split, three things `docs/LIMITATIONS.md` records as missing because no
 * other source supplies them.
 */

/** One airport touch point. */
interface CleartripAirportRef {
  airport: {
    code: string;
    /** A real IANA zone, e.g. `Asia/Kolkata`, not a fixed offset. */
    zoneId?: string;
    /** Full ISO 8601 with offset. */
    time: string;
  };
}

/** One flown leg. */
interface CleartripFlight {
  /** Digits only, without the carrier prefix. */
  fltNo: string;
  airlineCode: string;
  marketingAirlineCode?: string;
  /** Present separately, which is what makes codeshares visible. */
  operatingAirlineCode?: string;
  aircraftType?: string;
  departure: CleartripAirportRef;
  arrival: CleartripAirportRef;
  duration: { hh: number; mm: number };
}

/** A perk attached to a fare product. */
interface CleartripBenefitTag {
  benefitType?: string;
  displayText?: string;
}

/** One purchasable fare product. */
interface CleartripFare {
  fareId: string;
  displayText?: { displayTitle?: string };
  fareFamilySubType?: string;
  brand?: string;
  pricing?: {
    totalPricing?: {
      totalPrice: number;
      totalTax?: number;
      totalBaseFare?: number;
      couponDetails?: {
        discountAmount?: number | null;
        couponCode?: string | null;
        message?: string | null;
      } | null;
    };
  };
}

/** One itinerary, with the fares available on it. */
interface CleartripSubTravelOption {
  subTravelOptionId: string;
  /** Segment order as `"1" | "2" | ...` keys onto flight ids. */
  sequenceToFlightIdMap: Record<string, string>;
  fareIds?: string[];
  fareList?: { fareId: string; benefitTags?: CleartripBenefitTag[] }[];
}

/** One row of the results list. */
interface CleartripCard {
  subTravelOptionIds: string[];
}

/** The subset of the response this mapper consumes. */
export interface CleartripSearchResponse {
  searchIntent?: Record<string, { departDate?: string }>;
  cards?: Record<string, CleartripCard[]>;
  subTravelOptions?: Record<string, CleartripSubTravelOption>;
  flights?: Record<string, CleartripFlight>;
  fares?: Record<string, CleartripFare>;
}

/** Cleartrip's cabin labels, as its own search form submits them. */
const TRAVEL_CLASS_LABELS: Record<CabinClass, string> = {
  economy: 'Economy',
  premium_economy: 'Premium Economy',
  business: 'Business',
  first: 'First',
};

export const cleartripSite: WebSearchSite<CleartripSearchResponse> = {
  providerId: 'cleartrip',
  displayName: 'Cleartrip',
  integrationNote:
    'Cleartrip publishes a REST partner API but gates it behind a commercial agreement ' +
    'with no self-service tier. Its public results page is client-rendered, so a browser ' +
    'session can read the same structured search response its own front end receives: ' +
    'real, current fares, obtained without scraping rendered markup. The endpoint is ' +
    'undocumented and unversioned, so this is reported as browser-automation rather than ' +
    'as a contracted live API.',

  buildUrl(params: WebSearchParams): string {
    const [year, month, day] = params.departureDate.split('-');
    const query = new URLSearchParams({
      adults: String(params.adults),
      childs: '0',
      infants: '0',
      class: TRAVEL_CLASS_LABELS[params.cabinClass],
      // Cleartrip's own form submits DD/MM/YYYY; ISO returns an empty result page.
      depart_date: `${day}/${month}/${year}`,
      from: params.origin,
      to: params.destination,
      intl: 'n',
    });
    return `https://www.cleartrip.com/flights/results?${query.toString()}`;
  },

  matchesSearchResponse(url: string): boolean {
    return url.includes('/flight/search/v2');
  },

  parse(body: string): CleartripSearchResponse | undefined {
    try {
      return JSON.parse(body) as CleartripSearchResponse;
    } catch {
      return undefined;
    }
  },

  recordedDateOf(response: CleartripSearchResponse): string | undefined {
    // Cleartrip echoes the request as DD/MM/YYYY.
    const raw = Object.values(response.searchIntent ?? {})[0]?.departDate;
    const [day, month, year] = raw?.split('/') ?? [];
    return day && month && year ? `${year}-${month}-${day}` : undefined;
  },

  toOffers(
    response: CleartripSearchResponse,
    query: SearchQuery,
    ctx: ProviderContext,
    live: boolean,
  ): SiteMappingResult {
    const flights = response.flights ?? {};
    const fares = response.fares ?? {};
    const options = response.subTravelOptions ?? {};

    const offers: NormalizedOffer[] = [];
    let droppedOfferCount = 0;

    for (const card of Object.values(response.cards ?? {}).flat()) {
      for (const stoId of card.subTravelOptionIds ?? []) {
        const option = options[stoId];
        if (!option) continue;

        const segments = segmentsOf(option, flights);
        if (!segments.length) continue;

        const first = segments[0]!;
        const last = segments[segments.length - 1]!;

        // Cleartrip helpfully offers nearby airports: a Delhi search returns departures
        // from DXN too. Helpful on its own site, wrong here, where these offers sit beside
        // providers answering the route exactly as asked. A flight from a different
        // airport is not the same flight at a better price.
        if (first.origin !== query.origin || last.destination !== query.destination) continue;

        for (const fareId of new Set(option.fareIds ?? option.fareList?.map((f) => f.fareId) ?? [])) {
          const fare = fares[fareId];
          if (!fare) continue;

          const candidate = toOffer(option, segments, fare, query, ctx, live);
          const parsed = normalizedOfferSchema.safeParse(candidate);

          if (parsed.success) offers.push(parsed.data);
          // An undocumented endpoint can change shape without warning. Counting rejects
          // makes that visible as a provider warning rather than quietly fewer results.
          else droppedOfferCount += 1;
        }
      }
    }

    return { offers, droppedOfferCount };
  },
};

/**
 * Builds one offer from an itinerary and a fare.
 *
 * @internal
 */
function toOffer(
  option: CleartripSubTravelOption,
  segments: FlightSegment[],
  fare: CleartripFare,
  query: SearchQuery,
  ctx: ProviderContext,
  live: boolean,
): NormalizedOffer {
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const pricing = fare.pricing?.totalPricing;
  const fareFamily = fare.fareFamilySubType ?? fare.displayText?.displayTitle ?? fare.brand;
  const tags = option.fareList?.find((entry) => entry.fareId === fare.fareId)?.benefitTags ?? [];

  return {
    // fareId is a several-hundred-character signed token, unusable as an identifier. The
    // itinerary plus the fare family is stable, readable and unique within a search.
    id: `cleartrip-${option.subTravelOptionId}-${fareFamily ?? 'FARE'}`,
    providerId: 'cleartrip',
    providerDisplayName: 'Cleartrip',
    // A replayed recording is real data that is no longer current, which is closer to
    // representative than to anything live.
    integrationType: live ? 'browser-automation' : 'representative',
    itinerary: {
      segments,
      origin: first.origin,
      destination: last.destination,
      totalDurationMinutes: durationBetween(first.departure, last.arrival),
      stops: segments.length - 1,
    },
    price: {
      // Deliberately the undiscounted total. Every fare here carries a coupon, and a coupon
      // needs a code the user may not be eligible for; comparing on a price most users
      // cannot obtain would rank this provider above sellers quoting honestly. The coupon
      // is carried as a conditional benefit instead, which scoring excludes.
      total: { amountMinor: toMinor(pricing?.totalPrice), currency: 'INR' },
      ...(pricing?.totalBaseFare !== undefined
        ? { baseFare: { amountMinor: toMinor(pricing.totalBaseFare), currency: 'INR' } }
        : {}),
      ...(pricing?.totalTax !== undefined
        ? { taxesAndFees: { amountMinor: toMinor(pricing.totalTax), currency: 'INR' } }
        : {}),
    },
    cabinClass: query.cabinClass,
    ...(fareFamily ? { fareFamily } : {}),
    benefits: toBenefits(tags, fare),
    ...refundabilityOf(tags),
    // The results URL a person would land on. Not a per-fare booking link: that needs the
    // signed fare token, which is session-bound and expires.
    deepLink: cleartripSite.buildUrl({
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
 * Resolves an itinerary's segments in flown order.
 *
 * `sequenceToFlightIdMap` is keyed by position as a string, and object key order is not
 * something to rely on for correctness, so the keys are sorted numerically.
 *
 * @returns Segments in order, or empty if any referenced flight is missing: a partial
 *   itinerary would quote a through-fare for a journey missing a leg.
 * @internal
 */
function segmentsOf(
  option: CleartripSubTravelOption,
  flights: Record<string, CleartripFlight>,
): FlightSegment[] {
  const ordered = Object.entries(option.sequenceToFlightIdMap ?? {}).sort(
    ([a], [b]) => Number(a) - Number(b),
  );

  const segments: FlightSegment[] = [];
  for (const [, flightId] of ordered) {
    const flight = flights[flightId];
    if (!flight) return [];

    const marketing = flight.marketingAirlineCode ?? flight.airlineCode;
    const operating = flight.operatingAirlineCode;

    segments.push({
      marketingCarrier: marketing,
      // Recorded only when it differs, so the field means "this is a codeshare" rather
      // than repeating the marketing carrier on every segment.
      ...(operating && operating !== marketing ? { operatingCarrier: operating } : {}),
      flightNumber: flight.fltNo,
      origin: flight.departure.airport.code,
      destination: flight.arrival.airport.code,
      departure: scheduledFromIso(flight.departure.airport.time, flight.departure.airport.zoneId),
      arrival: scheduledFromIso(flight.arrival.airport.time, flight.arrival.airport.zoneId),
      durationMinutes: flight.duration.hh * 60 + flight.duration.mm,
      ...aircraftOf(flight),
    });
  }

  return segments;
}

/**
 * Extracts a usable aircraft description.
 *
 * Cleartrip joins an equipment code to a type name without checking either is present, so
 * it arrives as `"7WL null"` when the type is missing. Passing that through would put the
 * literal string "null" in front of a user.
 *
 * @internal
 */
function aircraftOf(flight: CleartripFlight): { aircraft?: string } {
  const cleaned = (flight.aircraftType ?? '')
    .split(/\s+/)
    .filter((part) => part && part !== 'null' && part !== 'undefined')
    .join(' ')
    .trim();

  return cleaned ? { aircraft: cleaned } : {};
}

/**
 * Maps fare perks and the attached coupon into scoreable benefits.
 *
 * @internal
 */
function toBenefits(tags: CleartripBenefitTag[], fare: CleartripFare): Benefit[] {
  const benefits: Benefit[] = [];

  for (const tag of tags) {
    const label = tag.displayText?.trim();
    if (!label) continue;

    switch (tag.benefitType) {
      case 'CT_UPGRADE':
        // "Seats @ Re.1". Real, but the saving depends on which seat, so it carries no
        // value rather than an invented one, matching how lounge access is handled.
        benefits.push({ type: 'free_seat', label, conditional: false });
        break;
      case 'PARTIAL_REFUNDABLE':
        // Deliberately not free_cancellation: a cancellation fee still applies.
        benefits.push({ type: 'other', label, conditional: false });
        break;
      case 'NON_REFUNDABLE':
        // The absence of a benefit, carried on `refundable` instead.
        break;
      default:
        benefits.push({ type: 'other', label, conditional: false });
    }
  }

  const coupon = fare.pricing?.totalPricing?.couponDetails;
  if (coupon?.couponCode && coupon.discountAmount) {
    benefits.push({
      type: 'discount',
      label: coupon.message?.trim() || `₹${coupon.discountAmount} off with ${coupon.couponCode}`,
      value: { amountMinor: toMinor(coupon.discountAmount), currency: 'INR' },
      // Needs a code, and often a specific bank card. Conditional benefits are excluded
      // from scoring for exactly this reason.
      conditional: true,
    });
  }

  return benefits;
}

/**
 * Reads refundability from the fare's perk tags.
 *
 * `PARTIAL_REFUNDABLE` deliberately yields nothing: it is neither refundable nor
 * non-refundable, and forcing it into a boolean would state something untrue in whichever
 * direction it was rounded. It survives as a labelled benefit instead.
 *
 * @internal
 */
function refundabilityOf(tags: CleartripBenefitTag[]): { refundable?: boolean } {
  for (const tag of tags) {
    if (tag.benefitType === 'NON_REFUNDABLE') return { refundable: false };
    if (tag.benefitType === 'REFUNDABLE') return { refundable: true };
  }
  return {};
}
