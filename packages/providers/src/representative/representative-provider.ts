import {
  normalizedOfferSchema,
  type Benefit,
  type CabinClass,
  type NormalizedOffer,
  type ProviderDescriptor,
  type ProviderId,
  type SearchQuery,
} from '@polaris/contracts';
import type { FlightProvider, ProviderContext, ProviderResult } from '../types';
import { ProviderUnavailableError, ProviderTimeoutError } from '../types';
import { findFlights, type ScheduledFlight } from '../schedule/flight-schedule';
import { findAirport, requireAirport } from '../schedule/airports';
import { addMinutes, toScheduledTime } from '../schedule/scheduled-time';
import { chance, createRng, inRange, intInRange, pickSome, type Rng } from './seeded-random';

/** A fare product a provider can sell on top of a scheduled flight. */
interface FareFamily {
  /** Provider-facing name, e.g. `SAVER`. */
  name: string;
  /** Multiplier on the base fare. */
  multiplier: number;
  refundable: boolean;
  checkedKg: number;
}

/** Failure behaviour, used to demonstrate the resilience path on demand. */
export type SimulatedFailure = 'none' | 'error' | 'timeout';

/** Everything that distinguishes one representative provider from another. */
export interface RepresentativeProviderConfig {
  providerId: ProviderId;
  displayName: string;
  /** Explains why this provider is representative rather than live. Feeds the docs. */
  integrationNote: string;
  /**
   * Multiplier on the baseline fare, capturing each provider's typical position.
   * A value of 1.02 means this provider generally sits ~2% above the market.
   */
  priceMultiplier: number;
  /**
   * Share of a route's flights this provider lists, 0 to 1.
   *
   * Below 1 deliberately: no OTA sells every seat on every flight. This is what produces
   * a realistic mix of flights sold by three providers, two, or only one — without which
   * every comparison group would look identical and the dedup would prove nothing.
   */
  inventoryCoverage: number;
  /** Benefits this provider draws from, in the order they should display. */
  benefitPool: readonly Benefit[];
  /** Maximum benefits attached to one offer. */
  maxBenefitsPerOffer: number;
  /** Simulated response latency range, in milliseconds. */
  latencyMsRange: readonly [number, number];
  /** Fare products this provider sells. */
  fareFamilies: readonly FareFamily[];
}

/** Cabin multipliers applied on top of the economy base fare. */
const CABIN_MULTIPLIERS: Record<CabinClass, number> = {
  economy: 1,
  premium_economy: 1.6,
  business: 2.8,
  first: 4.5,
};

/**
 * A provider whose data is generated rather than fetched.
 *
 * Used for MakeMyTrip, Goibibo and Cleartrip, whose partner APIs are commercially gated
 * and genuinely unobtainable for a prototype. The brief explicitly permits representative
 * data in that situation provided it is documented — so every offer produced here is
 * stamped `integrationType: 'representative'` and badged as simulated in the UI, rather
 * than being quietly passed off as real.
 *
 * Crucially, all representative providers price the *same shared timetable*, so the same
 * physical flight really does appear across providers at different prices — which is the
 * behaviour the comparison engine exists to handle.
 *
 * Everything is derived from a seed built out of the query, so results are identical run
 * to run: tests are deterministic and prices do not shift under the interviewer's cursor
 * mid-demo.
 */
export class RepresentativeProvider implements FlightProvider {
  readonly descriptor: ProviderDescriptor;

  private readonly failureMode: SimulatedFailure;
  private readonly latencyEnabled: boolean;

  /**
   * @param config - What distinguishes this provider's pricing, inventory and perks.
   * @param options - Simulation behaviour.
   * @param options.failureMode - Forces a failure, to demonstrate partial-results handling
   *   live. Explicit rather than probabilistic on purpose: a random failure rate would make
   *   the demo a coin toss and the test suite flaky.
   * @param options.simulateLatency - Whether to wait a plausible amount of time before
   *   answering. On by default so the timeout and circuit breaker are genuinely exercised
   *   in development; tests turn it off, since paying real milliseconds to assert pricing
   *   logic is cost with no coverage.
   */
  constructor(
    private readonly config: RepresentativeProviderConfig,
    options: { failureMode?: SimulatedFailure; simulateLatency?: boolean } = {},
  ) {
    this.failureMode = options.failureMode ?? 'none';
    this.latencyEnabled = options.simulateLatency ?? true;
    this.descriptor = {
      providerId: config.providerId,
      displayName: config.displayName,
      integrationType: 'representative',
      dataSource: 'generated-representative',
      isRealData: false,
      integrationNote: config.integrationNote,
      enabled: true,
    };
  }

  /**
   * Searches the shared timetable and prices it as this provider would.
   *
   * @param query - The validated search query.
   * @param ctx - Cancellation signal and search-start clock.
   * @returns Normalised offers for the flights this provider lists.
   * @throws {ProviderUnavailableError} When `failureMode` is `error`.
   * @throws {ProviderTimeoutError} When `failureMode` is `timeout`.
   */
  async search(query: SearchQuery, ctx: ProviderContext): Promise<ProviderResult> {
    await this.simulateLatency(query, ctx);

    if (this.failureMode === 'error') {
      throw new ProviderUnavailableError(
        this.config.providerId,
        'Simulated provider outage (demonstration mode)',
      );
    }
    if (this.failureMode === 'timeout') {
      // Never settles; the orchestrator's deadline is what ends this.
      await new Promise<never>(() => {});
    }

    // An unserved route is a legitimate empty answer, not an error.
    if (!findAirport(query.origin) || !findAirport(query.destination)) {
      return { offers: [], droppedOfferCount: 0, message: 'Route not served by this provider' };
    }

    const scheduled = findFlights(query.origin, query.destination, query.departureDate);
    const offers: NormalizedOffer[] = [];
    let droppedOfferCount = 0;

    for (const flight of scheduled) {
      const rng = this.rngFor(query, flight);

      // Not every provider lists every flight.
      if (!chance(rng, this.config.inventoryCoverage)) continue;

      for (const fareFamily of this.fareFamiliesFor(rng)) {
        const candidate = this.buildOffer(query, ctx, flight, fareFamily, rng);

        // Validate our own output against the shared contract. An adapter is exactly
        // where a mapping bug enters the system, and a malformed offer must be counted
        // rather than allowed downstream to corrupt grouping or scoring.
        const parsed = normalizedOfferSchema.safeParse(candidate);
        if (parsed.success) {
          offers.push(parsed.data);
        } else {
          droppedOfferCount += 1;
        }
      }
    }

    return { offers, droppedOfferCount };
  }

  /**
   * Builds the seed for one flight.
   *
   * Includes the provider id so providers price the same flight differently, and every
   * query component so a different search looks genuinely different.
   *
   * @param query - The search query.
   * @param flight - The scheduled flight.
   * @returns A generator stable for this provider, query and flight.
   * @internal
   */
  private rngFor(query: SearchQuery, flight: ScheduledFlight): Rng {
    return createRng(
      this.config.providerId,
      query.origin,
      query.destination,
      query.departureDate,
      query.cabinClass,
      flight.carrier,
      flight.flightNumber,
    );
  }

  /**
   * Chooses which fare products to sell on a flight.
   *
   * The cheapest family is always offered; dearer ones appear sometimes, so a group can
   * legitimately hold two fares from one provider — the case that makes measuring price
   * spread across providers rather than across offers matter.
   *
   * @param rng - Seeded source.
   * @returns One or more fare families, cheapest first.
   * @internal
   */
  private fareFamiliesFor(rng: Rng): FareFamily[] {
    const [cheapest, ...rest] = [...this.config.fareFamilies].sort(
      (a, b) => a.multiplier - b.multiplier,
    );
    if (!cheapest) return [];

    const extras = rest.filter(() => chance(rng, 0.35));
    return [cheapest, ...extras];
  }

  /**
   * Prices one fare on one flight and shapes it into the canonical offer form.
   *
   * @param query - The search query, supplying passengers and cabin.
   * @param ctx - Supplies the search-start clock for `retrievedAt`.
   * @param flight - The scheduled flight.
   * @param fareFamily - The fare product being priced.
   * @param rng - Seeded source.
   * @returns A candidate offer, still to be validated against the contract.
   * @internal
   */
  private buildOffer(
    query: SearchQuery,
    ctx: ProviderContext,
    flight: ScheduledFlight,
    fareFamily: FareFamily,
    rng: Rng,
  ): NormalizedOffer {
    const originAirport = requireAirport(flight.origin);
    const destinationAirport = requireAirport(flight.destination);

    const departure = toScheduledTime(query.departureDate, flight.departure, originAirport);
    const arrival = addMinutes(departure, flight.durationMinutes, destinationAirport);

    const perAdultInr =
      flight.baseFareInr *
      this.config.priceMultiplier *
      fareFamily.multiplier *
      CABIN_MULTIPLIERS[query.cabinClass] *
      // A few percent of movement so identical flights are not identically priced.
      inRange(rng, 0.97, 1.06);

    // Fares are quoted in whole rupees; round before converting to paise so the minor
    // units stay exact rather than carrying a fractional remainder.
    const totalMinor = Math.round(perAdultInr) * 100 * query.passengers;

    const segment = {
      marketingCarrier: flight.carrier,
      flightNumber: flight.flightNumber,
      origin: flight.origin,
      destination: flight.destination,
      departure,
      arrival,
      durationMinutes: flight.durationMinutes,
    };

    return {
      id: `${this.config.providerId}-${flight.carrier}${flight.flightNumber}-${fareFamily.name}-${query.departureDate}`,
      providerId: this.config.providerId,
      providerDisplayName: this.config.displayName,
      integrationType: 'representative',
      itinerary: {
        segments: [segment],
        origin: flight.origin,
        destination: flight.destination,
        totalDurationMinutes: flight.durationMinutes,
        stops: 0,
      },
      price: { total: { amountMinor: totalMinor, currency: 'INR' } },
      cabinClass: query.cabinClass,
      fareFamily: fareFamily.name,
      benefits: pickSome(rng, this.config.benefitPool, intInRange(rng, 0, this.config.maxBenefitsPerOffer)),
      baggage: { cabinKg: 7, checkedKg: fareFamily.checkedKg },
      refundable: fareFamily.refundable,
      seatsAvailable: intInRange(rng, 1, 9),
      retrievedAt: ctx.now.toISOString(),
    };
  }

  /**
   * Waits a plausible amount of time before answering.
   *
   * Without this every representative provider would return in under a millisecond, and
   * the timeout, circuit breaker and partial-results behaviour would never be exercised —
   * in development or in the demo. The delay is seeded, so it is consistent per query.
   *
   * Resolves early if the search is cancelled, so a caller's abort is not held up by a
   * simulated wait.
   *
   * @param query - Seeds the latency.
   * @param ctx - Supplies the cancellation signal.
   * @internal
   */
  private simulateLatency(query: SearchQuery, ctx: ProviderContext): Promise<void> {
    if (!this.latencyEnabled) return Promise.resolve();

    const [min, max] = this.config.latencyMsRange;
    const rng = createRng(this.config.providerId, query.origin, query.destination, 'latency');
    const delayMs = Math.round(inRange(rng, min, max));

    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delayMs);
      ctx.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
