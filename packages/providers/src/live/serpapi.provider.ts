import {
  normalizedOfferSchema,
  type CabinClass,
  type FlightSegment,
  type NormalizedOffer,
  type ProviderDescriptor,
  type ProviderId,
  type ScheduledTime,
  type SearchQuery,
} from '@polaris/contracts';
import type { FlightProvider, ProviderContext, ProviderResult } from '../types';
import { ProviderCredentialsMissingError, ProviderUnavailableError } from '../types';
import { findAirport, type Airport } from '../schedule/airports';
import {
  collectItineraries,
  fetchGoogleFlights,
  loadFixture,
  type SerpApiItinerary,
  type SerpApiResponse,
  type SerpApiSegment,
} from './serpapi-client';

/**
 * Where a response actually came from.
 *
 * Carried through mapping so an offer's declared provenance reflects reality rather than
 * the adapter's configuration. A hybrid provider that fell back to a recording is not
 * serving live data, and must not say it is.
 */
type ResponseSource = 'live' | 'fixture';

interface SourcedResponse {
  response: SerpApiResponse;
  source: ResponseSource;
}

/** Where a SerpApi-backed provider takes its data from. */
export type ProviderMode = 'live' | 'fixture' | 'hybrid';

/** Configuration for one carrier served through SerpApi. */
export interface SerpApiProviderConfig {
  providerId: ProviderId;
  displayName: string;
  /** IATA designator this provider sells, e.g. `6E`. */
  carrierCode: string;
  integrationNote: string;
}

/** Google Flights cabin codes. */
const TRAVEL_CLASS_CODES: Record<CabinClass, 1 | 2 | 3 | 4> = {
  economy: 1,
  premium_economy: 2,
  business: 3,
  first: 4,
};

/**
 * Every airport in scope is Indian, so an unknown code is assumed to be IST.
 *
 * Applied only to connection points SerpApi returns that are outside our own airport
 * table. Assuming IST is correct for the Indian domestic market this prototype covers, and
 * wrong the moment it is not — recorded in docs/LIMITATIONS.md alongside the same
 * assumption in the airport table itself.
 */
const ASSUMED_TIMEZONE = { timeZone: 'Asia/Kolkata', utcOffsetMinutes: 330 };

/**
 * A real airline's fares, sourced live through SerpApi's Google Flights engine.
 *
 * Neither IndiGo nor Air India Express publishes a developer API — both run partner-only
 * distribution. They do sell through Google Flights, so their live schedules and prices are
 * obtainable through SerpApi, a commercial API operating under its own terms. This is a
 * legitimate route to current data rather than scraping performed by this application.
 *
 * One SerpApi response contains every carrier on the route. Each provider instance filters
 * to its own designator, so `indigo` returns 6E flights and `airindiaexpress` returns IX —
 * which is what makes them genuinely separate providers in the comparison rather than one
 * source wearing two labels.
 */
export class SerpApiProvider implements FlightProvider {
  readonly descriptor: ProviderDescriptor;

  /**
   * @param config - Carrier identity and integration note.
   * @param apiKey - SerpApi key. Absent means the provider reports `skipped`.
   * @param mode - `live` calls the API, `fixture` replays a recorded response, `hybrid`
   *   tries live and falls back to a fixture. Hybrid is the default because it keeps a
   *   demonstration working when the network fails or the monthly quota is exhausted.
   */
  constructor(
    private readonly config: SerpApiProviderConfig,
    private readonly apiKey: string | undefined,
    private readonly mode: ProviderMode = 'hybrid',
  ) {
    this.descriptor = {
      providerId: config.providerId,
      displayName: config.displayName,
      integrationType: 'live-api',
      dataSource: 'serpapi-google-flights',
      isRealData: true,
      integrationNote: config.integrationNote,
      enabled: true,
    };
  }

  /**
   * Searches for this carrier's flights on the requested route.
   *
   * @param query - The validated search query.
   * @param ctx - Cancellation signal and search-start clock.
   * @returns Normalised offers for this carrier only.
   * @throws {ProviderCredentialsMissingError} In live mode with no API key.
   * @throws {ProviderUnavailableError} When SerpApi fails and no fixture can cover it.
   */
  async search(query: SearchQuery, ctx: ProviderContext): Promise<ProviderResult> {
    const sourced = await this.loadResponse(query, ctx);

    if (!sourced) {
      return {
        offers: [],
        droppedOfferCount: 0,
        message: `No data available for ${query.origin}–${query.destination} on ${query.departureDate}`,
      };
    }

    const { response, source } = sourced;

    const offers: NormalizedOffer[] = [];
    let droppedOfferCount = 0;

    for (const itinerary of collectItineraries(response)) {
      // One response covers every airline on the route; keep only this carrier's.
      if (carrierOf(itinerary.flights[0]) !== this.config.carrierCode) continue;

      const candidate = this.toOffer(itinerary, query, ctx, source);
      const parsed = normalizedOfferSchema.safeParse(candidate);

      if (parsed.success) {
        offers.push(parsed.data);
      } else {
        // A third-party payload can change shape without warning. Counting rejects makes
        // that visible as a provider warning rather than as quietly fewer results.
        droppedOfferCount += 1;
      }
    }

    return {
      offers,
      droppedOfferCount,
      // Surfaced in the provider status so a viewer can tell a degraded search from a
      // healthy one, not only from the per-offer badge.
      ...(source === 'fixture'
        ? { message: 'Live request failed — replayed a recorded response' }
        : {}),
    };
  }

  /**
   * Obtains a response according to the configured mode.
   *
   * @param query - The search query.
   * @param ctx - Supplies the cancellation signal.
   * @returns A response, or `undefined` when fixture mode has nothing for the route.
   * @internal
   */
  private async loadResponse(
    query: SearchQuery,
    ctx: ProviderContext,
  ): Promise<SourcedResponse | undefined> {
    const replay = async (): Promise<SourcedResponse | undefined> => {
      const fixture = await loadFixture(query.origin, query.destination, query.departureDate);
      return fixture ? { response: fixture.response, source: 'fixture' } : undefined;
    };

    if (this.mode === 'fixture') {
      return replay();
    }

    if (!this.apiKey) {
      if (this.mode === 'hybrid') {
        const fixture = await replay();
        if (fixture) return fixture;
      }
      throw new ProviderCredentialsMissingError(this.config.providerId, 'SERPAPI_KEY');
    }

    try {
      const response = await fetchGoogleFlights(
        {
          origin: query.origin,
          destination: query.destination,
          departureDate: query.departureDate,
          adults: query.passengers,
          travelClass: TRAVEL_CLASS_CODES[query.cabinClass],
        },
        this.apiKey,
        ctx.signal,
      );
      return { response, source: 'live' };
    } catch (error) {
      // Falling back is what keeps a live walkthrough working when the network drops or
      // the free tier's monthly ceiling is reached mid-demonstration — but the result is
      // labelled as a replay, not passed off as live.
      if (this.mode === 'hybrid') {
        const fixture = await replay();
        if (fixture) return fixture;
      }

      throw new ProviderUnavailableError(
        this.config.providerId,
        error instanceof Error ? error.message : 'SerpApi request failed',
        true,
        error,
      );
    }
  }

  /**
   * Maps a SerpApi itinerary into the canonical offer shape.
   *
   * @param itinerary - One itinerary from the response.
   * @param query - The search query, supplying cabin and passenger count.
   * @param ctx - Supplies the search-start clock.
   * @returns A candidate offer, still to be validated.
   * @internal
   */
  private toOffer(
    itinerary: SerpApiItinerary,
    query: SearchQuery,
    ctx: ProviderContext,
    source: ResponseSource,
  ): NormalizedOffer {
    const segments = itinerary.flights.map(toSegment);
    const first = segments[0]!;
    const last = segments[segments.length - 1]!;

    return {
      id: `${this.config.providerId}-${itinerary.flights.map((s) => s.flight_number.replace(/\s+/g, '')).join('-')}-${query.departureDate}`,
      providerId: this.config.providerId,
      providerDisplayName: this.config.displayName,
      // Reflects where this offer actually came from. A replayed recording is real data
      // that is no longer current, which is closer to representative than to live — and
      // claiming otherwise would put a "Live" badge on a stale price.
      integrationType: source === 'live' ? 'live-api' : 'representative',
      itinerary: {
        segments,
        origin: first.origin,
        destination: last.destination,
        // total_duration includes layovers; summing segment durations would not.
        totalDurationMinutes: itinerary.total_duration,
        stops: segments.length - 1,
      },
      // SerpApi quotes whole rupees for the whole party, matching how price.total is
      // defined. Converting to paise keeps every amount an exact integer.
      price: { total: { amountMinor: Math.round(itinerary.price) * 100, currency: 'INR' } },
      cabinClass: query.cabinClass,
      benefits: [],
      retrievedAt: ctx.now.toISOString(),
    };
  }
}

/**
 * Extracts the carrier designator from a SerpApi flight number.
 *
 * @param segment - A segment, or `undefined` for a malformed itinerary.
 * @returns The designator, e.g. `6E`, or an empty string when unavailable.
 * @internal
 */
function carrierOf(segment: SerpApiSegment | undefined): string {
  return segment?.flight_number?.split(' ')[0] ?? '';
}

/**
 * Maps one SerpApi leg into a canonical segment.
 *
 * @param segment - The leg to map.
 * @returns The canonical segment.
 * @internal
 */
function toSegment(segment: SerpApiSegment): FlightSegment {
  const [carrier = '', number = ''] = segment.flight_number.split(' ');
  const origin = segment.departure_airport.id;
  const destination = segment.arrival_airport.id;

  return {
    marketingCarrier: carrier,
    flightNumber: number,
    origin,
    destination,
    departure: toScheduledTime(segment.departure_airport.time, origin),
    arrival: toScheduledTime(segment.arrival_airport.time, destination),
    durationMinutes: segment.duration,
    ...(segment.airplane ? { aircraft: segment.airplane } : {}),
  };
}

/**
 * Converts SerpApi's `YYYY-MM-DD HH:MM` local time into a full {@link ScheduledTime}.
 *
 * SerpApi reports wall-clock time at the airport with no offset. The UTC instant is
 * derived from the airport's offset so the canonical key can use the local date while
 * durations and ordering have a real instant to work from — the distinction the whole
 * grouping design rests on.
 *
 * @param serpTime - Local time, `YYYY-MM-DD HH:MM`.
 * @param airportCode - IATA code the time is local to.
 * @returns Local, UTC and zone together.
 * @internal
 */
function toScheduledTime(serpTime: string, airportCode: string): ScheduledTime {
  const [datePart = '', timePart = ''] = serpTime.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);

  const airport: Pick<Airport, 'timeZone' | 'utcOffsetMinutes'> =
    findAirport(airportCode) ?? ASSUMED_TIMEZONE;

  const asIfUtcMs = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0);
  const trueInstantMs = asIfUtcMs - airport.utcOffsetMinutes * 60_000;

  return {
    local: `${datePart}T${timePart.padStart(5, '0')}:00`,
    utc: `${new Date(trueInstantMs).toISOString().slice(0, 19)}Z`,
    timeZone: airport.timeZone,
  };
}

/** IndiGo — India's largest carrier by a wide margin. */
export const INDIGO_CONFIG: SerpApiProviderConfig = {
  providerId: 'indigo',
  displayName: 'IndiGo',
  carrierCode: '6E',
  integrationNote:
    'No public developer API — IndiGo runs a Navitaire passenger service system with ' +
    "partner-only access. Live fares are sourced through SerpApi's Google Flights engine, " +
    'a commercial API operating under its own terms.',
};

/** Air India Express — a thinner network, so a good test of low-inventory routes. */
export const AIR_INDIA_EXPRESS_CONFIG: SerpApiProviderConfig = {
  providerId: 'airindiaexpress',
  displayName: 'Air India Express',
  carrierCode: 'IX',
  integrationNote:
    "No public developer API. Live fares are sourced through SerpApi's Google Flights " +
    'engine, the same route used for IndiGo.',
};

/**
 * Builds the two SerpApi-backed airline providers.
 *
 * @param apiKey - SerpApi key, or `undefined` to run from fixtures only.
 * @param mode - Data source mode.
 * @returns The IndiGo and Air India Express adapters.
 */
export function createSerpApiProviders(
  apiKey: string | undefined,
  mode: ProviderMode = 'hybrid',
): SerpApiProvider[] {
  return [
    new SerpApiProvider(INDIGO_CONFIG, apiKey, mode),
    new SerpApiProvider(AIR_INDIA_EXPRESS_CONFIG, apiKey, mode),
  ];
}
