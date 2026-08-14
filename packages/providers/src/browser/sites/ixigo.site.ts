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
  plainText,
  scheduledFromEpoch,
  toMinor,
} from '../site-helpers';
import type { SiteMappingResult, WebSearchParams, WebSearchSite } from '../web-session-site';

/**
 * @packageDocumentation
 * Ixigo's public flight search, read from its own results page.
 *
 * Integrated alongside EaseMyTrip because MakeMyTrip and Goibibo refuse automated clients,
 * and one real agency is not a comparison.
 *
 * Ixigo differs from the other two in a way worth noting: its results arrive as a
 * **server-sent event stream** rather than a single JSON body, because it queries several
 * suppliers and pushes results as they land. The stream is read to completion and the
 * events are merged, so a partially-delivered stream yields fewer flights rather than none.
 *
 * Its payload reports **epoch milliseconds** for every departure and arrival, which is the
 * least ambiguous form any source here offers: the instant is exact, and the local time is
 * derived from it rather than the other way round.
 */

/** One leg as Ixigo describes it. */
interface IxigoFlightDetail {
  origin: string;
  destination: string;
  duration?: { time?: number };
  airlineCode: string;
  /**
   * Carrier and number joined, e.g. `AI2429`.
   *
   * On a connection this holds *every* number, `"AI9584, AI2790"`, because the entry
   * describes the whole journey rather than one leg.
   */
  subHeaderTextWeb?: string;
  /** Number of stops on the journey this entry describes. */
  stop?: number;
  departureTimeEpoch: number;
  arrivalTimeEpoch: number;
}

/** One fare on one itinerary. */
interface IxigoFare {
  fareDetails?: { displayFare?: number };
  fareMetadata?: {
    seatRemaining?: number;
    baggageDetails?: { checkInBaggage?: string; handBaggage?: string };
    cabinClass?: string;
  }[];
  fareType?: string;
  fareDisplayText?: string;
  /** Promotional copy, delivered as inline HTML. */
  offerText?: string;
}

/** One itinerary with its fares. */
interface IxigoFlightFare {
  /** e.g. `DEL-BOM-AI2429-28082026`. */
  flightKeys?: string;
  refundableType?: string;
  fares?: IxigoFare[];
  flightDetails?: IxigoFlightDetail[];
  isFreeMealAvailable?: boolean;
}

/** One journey in a stream event. */
interface IxigoJourney {
  key?: { origin?: string; destination?: string; date?: string }[];
  flightFare?: IxigoFlightFare[];
}

/** The merged result of reading the whole stream. */
export interface IxigoSearchResponse {
  /** `DDMMYYYY` as Ixigo echoes it. */
  searchDate?: string;
  journeys: IxigoJourney[];
}

/** Ixigo's cabin codes, as its own search form submits them. */
const CABIN_CODES: Record<CabinClass, string> = {
  economy: 'e',
  premium_economy: 'p',
  business: 'b',
  first: 'f',
};

export const ixigoSite: WebSearchSite<IxigoSearchResponse> = {
  providerId: 'ixigo',
  displayName: 'Ixigo',
  integrationNote:
    'No self-service partner API. Its public results page streams structured search ' +
    'results from its own backend, so a browser session reads the same payload its front ' +
    'end renders: real, current agency fares. Integrated in place of MakeMyTrip and ' +
    'Goibibo, both of which refuse automated clients at their CDN edge. The endpoint is ' +
    'undocumented and unversioned, so this is reported as browser-automation rather than ' +
    'as a contracted live API.',

  buildUrl(params: WebSearchParams): string {
    const [year, month, day] = params.departureDate.split('-');
    const query = new URLSearchParams({
      from: params.origin,
      to: params.destination,
      // Ixigo's own form submits DDMMYYYY with no separators.
      date: `${day}${month}${year}`,
      adults: String(params.adults),
      children: '0',
      infants: '0',
      class: CABIN_CODES[params.cabinClass],
      // Measured: Ixigo is the only one of the three that honours an airline filter in the
      // URL, so a verification link here lands on a handful of rows rather than a hundred.
      ...(params.carrier ? { airlines: params.carrier } : {}),
    });
    return `https://www.ixigo.com/search/result/flight?${query.toString()}`;
  },

  matchesSearchResponse(url: string): boolean {
    return url.includes('/flights/v2/search/stream');
  },

  parse(body: string): IxigoSearchResponse | undefined {
    const journeys: IxigoJourney[] = [];
    let searchDate: string | undefined;

    // Server-sent events: each record is a `data:` line carrying one JSON payload. The
    // stream is merged rather than taking the first event, because Ixigo pushes supplier
    // results progressively and a single event is only part of the answer.
    for (const line of body.split('\n')) {
      if (!line.startsWith('data:')) continue;

      let event: { data?: { flightJourneys?: IxigoJourney[] } };
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        // One malformed event must not discard the ones that parsed.
        continue;
      }

      for (const journey of event.data?.flightJourneys ?? []) {
        journeys.push(journey);
        searchDate ??= journey.key?.[0]?.date;
      }
    }

    return journeys.length ? { searchDate, journeys } : undefined;
  },

  recordedDateOf(response: IxigoSearchResponse): string | undefined {
    // Ixigo echoes the request as DDMMYYYY.
    const raw = response.searchDate;
    if (!raw || raw.length !== 8) return undefined;

    return `${raw.slice(4, 8)}-${raw.slice(2, 4)}-${raw.slice(0, 2)}`;
  },

  toOffers(
    response: IxigoSearchResponse,
    query: SearchQuery,
    ctx: ProviderContext,
    live: boolean,
  ): SiteMappingResult {
    const offers: NormalizedOffer[] = [];
    const seen = new Set<string>();
    let droppedOfferCount = 0;
    let connectionsSkipped = 0;

    for (const journey of response.journeys) {
      for (const entry of journey.flightFare ?? []) {
        // Ixigo describes a whole journey in one entry: for a connection it reports only
        // the end-to-end route, every flight number joined into one string, and layovers
        // named by city rather than airport code. There is no honest way to recover the
        // individual legs from that, and the canonical key that drives deduplication is
        // built from them. Synthesising segments would put invented airport codes and
        // times behind a real price, so these are declined and declared instead.
        if ((entry.flightDetails ?? []).some((detail) => (detail.stop ?? 0) > 0)) {
          connectionsSkipped += 1;
          continue;
        }

        const segments = segmentsOf(entry.flightDetails ?? []);
        if (!segments.length) continue;

        const first = segments[0]!;
        const last = segments[segments.length - 1]!;

        // Ixigo also returns nearby airports for a metro search.
        if (first.origin !== query.origin || last.destination !== query.destination) continue;

        for (const [index, fare] of (entry.fares ?? []).entries()) {
          const candidate = toOffer(entry, segments, fare, index, query, ctx, live);
          const parsed = normalizedOfferSchema.safeParse(candidate);

          if (!parsed.success) {
            droppedOfferCount += 1;
            continue;
          }

          // Merging a multi-event stream can deliver the same fare twice; the id is
          // deterministic, so a repeat is recognisable rather than becoming a phantom
          // second seller at an identical price.
          if (seen.has(parsed.data.id)) continue;
          seen.add(parsed.data.id);
          offers.push(parsed.data);
        }
      }
    }

    return {
      offers,
      droppedOfferCount,
      // Declared rather than silent: a viewer comparing provider counts should be able to
      // see why this one lists fewer flights than the others on the same route.
      ...(connectionsSkipped
        ? {
            message: `${connectionsSkipped} connecting itineraries omitted, Ixigo does not report their individual legs`,
          }
        : {}),
    };
  },
};

/**
 * Builds one offer from an itinerary and a fare.
 *
 * @internal
 */
function toOffer(
  entry: IxigoFlightFare,
  segments: FlightSegment[],
  fare: IxigoFare,
  index: number,
  query: SearchQuery,
  ctx: ProviderContext,
  live: boolean,
): NormalizedOffer {
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const metadata = fare.fareMetadata?.[0];
  const fareFamily = fare.fareDisplayText?.trim() || fare.fareType?.trim();
  const seats = metadata?.seatRemaining;

  return {
    id: `ixigo-${entry.flightKeys ?? segments.map((s) => `${s.marketingCarrier}${s.flightNumber}`).join('-')}-${fareFamily ?? 'FARE'}-${index}`,
    providerId: 'ixigo',
    providerDisplayName: 'Ixigo',
    integrationType: live ? 'browser-automation' : 'representative',
    itinerary: {
      segments,
      origin: first.origin,
      destination: last.destination,
      totalDurationMinutes: durationBetween(first.departure, last.arrival),
      stops: segments.length - 1,
    },
    // Ixigo quotes a single all-in figure and discloses no fare/tax split, so none is
    // published. Deriving one would be inventing a breakdown the source did not give.
    price: { total: { amountMinor: toMinor(fare.fareDetails?.displayFare), currency: 'INR' } },
    cabinClass: query.cabinClass,
    ...(fareFamily ? { fareFamily } : {}),
    benefits: toBenefits(entry, fare),
    ...baggageOf(metadata?.baggageDetails),
    ...refundabilityOf(entry.refundableType),
    // Zero is a real answer here and means "sold out at this fare", not "unknown", so it
    // is only published when Ixigo actually reported a count.
    ...(typeof seats === 'number' && seats > 0 ? { seatsAvailable: Math.min(seats, 9) } : {}),
    deepLink: ixigoSite.buildUrl({
      origin: first.origin,
      destination: last.destination,
      departureDate: query.departureDate,
      adults: query.passengers,
      cabinClass: query.cabinClass,
      carrier: first.marketingCarrier,
    }),
    retrievedAt: ctx.now.toISOString(),
  };
}

/**
 * Maps Ixigo's legs into canonical segments.
 *
 * @returns Segments in order, or empty when a leg cannot be read: a partial itinerary
 *   would quote a through-fare for a journey missing a leg.
 * @internal
 */
function segmentsOf(details: IxigoFlightDetail[]): FlightSegment[] {
  const segments: FlightSegment[] = [];

  for (const detail of details) {
    // `subHeaderTextWeb` is the carrier and number joined, e.g. `AI2429`. The carrier code
    // is taken from its own field rather than by slicing, because designators are not a
    // fixed width: `6E` and `AI` are two characters, but the number is not fixed either.
    const number = flightNumberOf((detail.subHeaderTextWeb ?? '').replace(detail.airlineCode, ''));
    if (!number) return [];

    const departure = scheduledFromEpoch(detail.departureTimeEpoch);
    const arrival = scheduledFromEpoch(detail.arrivalTimeEpoch);

    segments.push({
      marketingCarrier: detail.airlineCode,
      flightNumber: number,
      origin: detail.origin,
      destination: detail.destination,
      departure,
      arrival,
      // Prefer the reported leg duration; fall back to the instants when it is absent.
      durationMinutes: detail.duration?.time || durationBetween(departure, arrival),
    });
  }

  return segments;
}

/**
 * Maps Ixigo's perks into benefits.
 *
 * `offerText` arrives as inline HTML with a mis-encoded rupee sign, so it is cleaned before
 * it can reach a user. No monetary value is attached: the copy states a discount that is
 * conditional on codes and cards, and pricing it would let marketing text move the ranking.
 *
 * @internal
 */
function toBenefits(entry: IxigoFlightFare, fare: IxigoFare): Benefit[] {
  const benefits: Benefit[] = [];

  if (entry.isFreeMealAvailable) {
    benefits.push({ type: 'free_meal', label: 'Free meal included', conditional: false });
  }

  const offer = plainText(fare.offerText);
  if (offer) {
    benefits.push({ type: 'discount', label: offer, conditional: true });
  }

  return benefits;
}

/**
 * Reads the baggage allowance.
 *
 * Ixigo states these as prose, `"15 kg per adult"`, so the number is extracted rather than
 * the phrasing being relied on.
 *
 * @internal
 */
function baggageOf(details: { checkInBaggage?: string; handBaggage?: string } | undefined): {
  baggage?: { cabinKg?: number; checkedKg?: number };
} {
  const cabinKg = baggageKg(details?.handBaggage);
  const checkedKg = baggageKg(details?.checkInBaggage);
  if (cabinKg === undefined && checkedKg === undefined) return {};

  return {
    baggage: {
      ...(cabinKg !== undefined ? { cabinKg } : {}),
      ...(checkedKg !== undefined ? { checkedKg } : {}),
    },
  };
}

/**
 * Maps Ixigo's refundability label onto the contract's boolean.
 *
 * `PARTIALLY_REFUNDABLE` deliberately yields nothing: it is neither, and rounding it in
 * either direction would state something untrue about a cancellation fee.
 *
 * @internal
 */
function refundabilityOf(type: string | undefined): { refundable?: boolean } {
  if (type === 'REFUNDABLE') return { refundable: true };
  if (type === 'NON_REFUNDABLE') return { refundable: false };
  return {};
}
