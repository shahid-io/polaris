import { describe, expect, it } from 'vitest';
import { searchQuerySchema, type SearchQuery } from '@polaris/contracts';
import { canonicalKeyForOffer, groupOffers } from '@polaris/core';
import { RepresentativeProvider } from './representative-provider';
import {
  CLEARTRIP_CONFIG,
  GOIBIBO_CONFIG,
  MAKEMYTRIP_CONFIG,
  createOtaProviders,
} from './ota-providers';
import { ProviderUnavailableError } from '../types';
import { findFlights } from '../schedule/flight-schedule';

const query = (overrides: Partial<SearchQuery> = {}): SearchQuery =>
  searchQuerySchema.parse({
    origin: 'DEL',
    destination: 'BOM',
    departureDate: '2026-08-20',
    ...overrides,
  });

/** Simulated latency is realism for the demo and pure cost in tests. */
const noLatency = { simulateLatency: false } as const;

/**
 * A provider that lists the entire timetable.
 *
 * Structural assertions: timezone resolution, date rollover, day-of-week filtering, need
 * a specific flight to be present. Against a partial-inventory provider those tests would
 * silently pass whenever coverage happened to exclude the flight, asserting nothing.
 */
const FULL_COVERAGE_CONFIG = { ...MAKEMYTRIP_CONFIG, inventoryCoverage: 1 };

const ctx = (signal = new AbortController().signal) => ({
  signal,
  searchId: 'test-search',
  now: new Date('2026-08-09T12:00:00.000Z'),
});

describe('RepresentativeProvider', () => {
  it('declares itself as representative rather than real data', () => {
    // Honesty by construction, the UI badge and the docs both read from this.
    const provider = new RepresentativeProvider(MAKEMYTRIP_CONFIG, noLatency);

    expect(provider.descriptor.integrationType).toBe('representative');
    expect(provider.descriptor.isRealData).toBe(false);
    expect(provider.descriptor.integrationNote).toContain('commercially gated');
  });

  it('returns offers for a served route', async () => {
    const provider = new RepresentativeProvider(MAKEMYTRIP_CONFIG, noLatency);

    const result = await provider.search(query(), ctx());

    expect(result.offers.length).toBeGreaterThan(0);
    expect(result.droppedOfferCount).toBe(0);
  });

  it('stamps every offer as representative', async () => {
    const provider = new RepresentativeProvider(GOIBIBO_CONFIG, noLatency);

    const { offers } = await provider.search(query(), ctx());

    expect(offers.every((offer) => offer.integrationType === 'representative')).toBe(true);
  });

  it('returns an empty result for an unserved route rather than throwing', async () => {
    const provider = new RepresentativeProvider(MAKEMYTRIP_CONFIG, noLatency);

    const result = await provider.search(query({ origin: 'DEL', destination: 'COK' }), ctx());

    expect(result.offers).toEqual([]);
    expect(result.droppedOfferCount).toBe(0);
  });

  it('returns an empty result for an unknown airport', async () => {
    const provider = new RepresentativeProvider(MAKEMYTRIP_CONFIG, noLatency);

    const result = await provider.search(query({ destination: 'XYZ' as 'BOM' }), ctx());

    expect(result.offers).toEqual([]);
    expect(result.message).toContain('not served');
  });

  /**
   * Determinism is not a nicety here. Without it the cache would be meaningless, tests
   * would be flaky, and prices would visibly shift between refreshes during a demo.
   */
  it('returns byte-identical results for the same query', async () => {
    const provider = new RepresentativeProvider(MAKEMYTRIP_CONFIG, noLatency);

    const first = await provider.search(query(), ctx());
    const second = await provider.search(query(), ctx());

    expect(JSON.stringify(second.offers)).toBe(JSON.stringify(first.offers));
  });

  it('produces different results for a different date', async () => {
    const provider = new RepresentativeProvider(MAKEMYTRIP_CONFIG, noLatency);

    const august = await provider.search(query({ departureDate: '2026-08-20' }), ctx());
    const september = await provider.search(query({ departureDate: '2026-09-14' }), ctx());

    expect(JSON.stringify(september.offers)).not.toBe(JSON.stringify(august.offers));
  });

  it('prices the same flight differently across providers', async () => {
    const [mmt, goibibo] = [
      new RepresentativeProvider(MAKEMYTRIP_CONFIG, noLatency),
      new RepresentativeProvider(GOIBIBO_CONFIG, noLatency),
    ];

    const mmtOffers = (await mmt.search(query(), ctx())).offers;
    const goibiboOffers = (await goibibo.search(query(), ctx())).offers;

    const sharedKey = mmtOffers
      .map(canonicalKeyForOffer)
      .find((key) => goibiboOffers.some((offer) => canonicalKeyForOffer(offer) === key))!;

    const mmtPrice = mmtOffers.find((o) => canonicalKeyForOffer(o) === sharedKey)!.price.total;
    const goibiboPrice = goibiboOffers.find((o) => canonicalKeyForOffer(o) === sharedKey)!.price
      .total;

    expect(mmtPrice.amountMinor).not.toBe(goibiboPrice.amountMinor);
  });

  it('lists a subset of the timetable, not every flight', async () => {
    // Coverage below 1 is what makes some flights sold by three providers and others by
    // one, without it every comparison group would look identical.
    const provider = new RepresentativeProvider(CLEARTRIP_CONFIG, noLatency);

    const { offers } = await provider.search(query(), ctx());
    const distinctFlights = new Set(offers.map(canonicalKeyForOffer));

    // Compared against the timetable itself rather than a hardcoded count, so adding a
    // departure does not silently invert what this test is checking.
    const scheduled = findFlights('DEL', 'BOM', '2026-08-20').length;

    expect(distinctFlights.size).toBeLessThan(scheduled);
    expect(distinctFlights.size).toBeGreaterThan(0);
  });

  it('scales the total by passenger count', async () => {
    const provider = new RepresentativeProvider(MAKEMYTRIP_CONFIG, noLatency);

    const one = await provider.search(query({ passengers: 1 }), ctx());
    const three = await provider.search(query({ passengers: 3 }), ctx());

    expect(three.offers[0]!.price.total.amountMinor).toBe(
      one.offers[0]!.price.total.amountMinor * 3,
    );
  });

  it('prices business class above economy', async () => {
    const provider = new RepresentativeProvider(MAKEMYTRIP_CONFIG, noLatency);

    const economy = await provider.search(query({ cabinClass: 'economy' }), ctx());
    const business = await provider.search(query({ cabinClass: 'business' }), ctx());

    expect(business.offers[0]!.price.total.amountMinor).toBeGreaterThan(
      economy.offers[0]!.price.total.amountMinor,
    );
  });

  it('keeps prices in exact whole rupees', async () => {
    // Fares are quoted in whole rupees; a fractional paisa remainder would mean the
    // rounding happened in the wrong place.
    const provider = new RepresentativeProvider(MAKEMYTRIP_CONFIG, noLatency);

    const { offers } = await provider.search(query(), ctx());

    for (const offer of offers) {
      expect(offer.price.total.amountMinor % 100).toBe(0);
      expect(Number.isInteger(offer.price.total.amountMinor)).toBe(true);
    }
  });

  it('resolves the red-eye to the correct local date', async () => {
    // DEL–BOM 6E-2134 departs 00:45 IST, 19:15Z the previous day.
    const provider = new RepresentativeProvider(FULL_COVERAGE_CONFIG, noLatency);

    const { offers } = await provider.search(query(), ctx());
    const redEye = offers.find((offer) => offer.itinerary.segments[0]!.flightNumber === '2134');

    expect(redEye).toBeDefined();
    const departure = redEye!.itinerary.segments[0]!.departure;
    expect(departure.local).toBe('2026-08-20T00:45:00');
    expect(departure.utc).toBe('2026-08-19T19:15:00Z');
    // The key follows the local date, so this flight groups with every other provider's
    // copy of it regardless of which representation they reported.
    expect(canonicalKeyForOffer(redEye!)).toBe('6E-2134-2026-08-20-DEL-BOM');
  });

  it('rolls the arrival date over midnight for a late departure', async () => {
    const provider = new RepresentativeProvider(FULL_COVERAGE_CONFIG, noLatency);

    const { offers } = await provider.search(query(), ctx());
    const lateNight = offers.find((offer) => offer.itinerary.segments[0]!.flightNumber === '944');

    expect(lateNight).toBeDefined();
    {
      // 21:55 + 130 minutes = 00:05 the next day.
      const segment = lateNight!.itinerary.segments[0]!;
      expect(segment.departure.local).toBe('2026-08-20T21:55:00');
      expect(segment.arrival.local).toBe('2026-08-21T00:05:00');
    }
  });

  it('builds a one-stop service as two timed legs through the via airport', async () => {
    const provider = new RepresentativeProvider(FULL_COVERAGE_CONFIG, noLatency);

    const { offers } = await provider.search(query(), ctx());
    // DEL–BOM 6E-2871 routes via AMD: 08:10 + 95 airborne, 70 on the ground, then the rest.
    const oneStop = offers.find((offer) => offer.itinerary.segments[0]!.flightNumber === '2871');

    expect(oneStop).toBeDefined();
    expect(oneStop!.itinerary.stops).toBe(1);

    const [first, second] = oneStop!.itinerary.segments;
    expect(first!.origin).toBe('DEL');
    expect(first!.destination).toBe('AMD');
    expect(first!.departure.local).toBe('2026-08-20T08:10:00');
    expect(first!.arrival.local).toBe('2026-08-20T09:45:00');

    expect(second!.origin).toBe('AMD');
    expect(second!.destination).toBe('BOM');
    // 09:45 plus the 70 minute layover.
    expect(second!.departure.local).toBe('2026-08-20T10:55:00');
    // The whole journey is 260 minutes from the origin departure, layover included.
    expect(second!.arrival.local).toBe('2026-08-20T12:30:00');

    // The legs plus the layover account for the advertised duration exactly, so a journey
    // cannot quietly gain or lose time in the middle.
    expect(first!.durationMinutes + 70 + second!.durationMinutes).toBe(
      oneStop!.itinerary.totalDurationMinutes,
    );
  });

  it('offers connecting flights on a trunk route, so the stops filter has something to do', async () => {
    // Guards the whole no-credentials experience, not just this provider. Every itinerary
    // here was non-stop until now, which meant `hasConnections` was false, the "Non-stop
    // only" control never rendered, and the browser test asserting it existed passed only
    // on days when the searched date happened to hit a recorded live fixture.
    const provider = new RepresentativeProvider(FULL_COVERAGE_CONFIG, noLatency);

    const { offers } = await provider.search(query(), ctx());

    expect(offers.some((offer) => offer.itinerary.stops > 0)).toBe(true);
    expect(offers.some((offer) => offer.itinerary.stops === 0)).toBe(true);
  });

  it('prices a connection below every non-stop on the route', async () => {
    // The trade-off that makes the filter worth using: stopping is cheaper and slower. If
    // connections were priced above the non-stops nothing would ever surface them.
    const provider = new RepresentativeProvider(FULL_COVERAGE_CONFIG, noLatency);

    const { offers } = await provider.search(query(), ctx());
    const cheapest = (stops: number) =>
      Math.min(
        ...offers
          .filter((offer) =>
            stops === 0 ? offer.itinerary.stops === 0 : offer.itinerary.stops > 0,
          )
          .map((offer) => offer.price.total.amountMinor),
      );

    expect(cheapest(1)).toBeLessThan(cheapest(0));
  });

  it('omits a weekend-only flight on a weekday', async () => {
    const provider = new RepresentativeProvider(FULL_COVERAGE_CONFIG, noLatency);
    const delGoi = (date: string) =>
      provider.search(query({ destination: 'GOI', departureDate: date }), ctx());

    // 2026-08-19 is a Wednesday; 2026-08-22 is a Saturday.
    const wednesday = await delGoi('2026-08-19');
    const saturday = await delGoi('2026-08-22');

    const has4315 = (offers: { itinerary: { segments: { flightNumber: string }[] } }[]) =>
      offers.some((offer) => offer.itinerary.segments[0]!.flightNumber === '4315');

    expect(has4315(wednesday.offers)).toBe(false);
    expect(has4315(saturday.offers)).toBe(true);
  });

  it('stamps retrievedAt from the search clock, not wall time', async () => {
    const provider = new RepresentativeProvider(MAKEMYTRIP_CONFIG, noLatency);
    const context = ctx();

    const { offers } = await provider.search(query(), context);

    expect(offers.every((offer) => offer.retrievedAt === context.now.toISOString())).toBe(true);
  });

  it('throws a provider error when forced to fail', async () => {
    const provider = new RepresentativeProvider(CLEARTRIP_CONFIG, {
      ...noLatency,
      failureMode: 'error',
    });

    await expect(provider.search(query(), ctx())).rejects.toThrow(ProviderUnavailableError);
  });

  it('resolves its simulated latency early when the search is cancelled', async () => {
    const controller = new AbortController();
    // Latency deliberately left on, resolving early is exactly what is under test.
    const provider = new RepresentativeProvider(CLEARTRIP_CONFIG);

    const pending = provider.search(query(), ctx(controller.signal));
    controller.abort();

    await expect(pending).resolves.toBeDefined();
  });
});

describe('the three OTAs together', () => {
  /**
   * The payoff of a shared timetable, asserted end to end: several providers really do
   * sell the same marketed flight, so grouping has something to group.
   */
  it('sell overlapping flights that deduplicate into shared groups', async () => {
    const providers = createOtaProviders({ simulateLatency: false });

    const results = await Promise.all(providers.map((p) => p.search(query(), ctx())));
    const allOffers = results.flatMap((result) => result.offers);
    const groups = groupOffers(allOffers);

    const multiProvider = groups.filter((group) => group.providerCount > 1);

    expect(groups.length).toBeGreaterThan(0);
    expect(multiProvider.length).toBeGreaterThan(0);
    expect(allOffers.length).toBeGreaterThan(groups.length);
  });

  it('produce a real price spread on shared flights', async () => {
    const providers = createOtaProviders({ simulateLatency: false });

    const results = await Promise.all(providers.map((p) => p.search(query(), ctx())));
    const groups = groupOffers(results.flatMap((result) => result.offers));
    const shared = groups.filter((group) => group.providerCount > 1);

    expect(shared.every((group) => group.priceSpread.delta.amountMinor > 0)).toBe(true);
  });

  it('leave some flights sold by a single provider', async () => {
    const providers = createOtaProviders({ simulateLatency: false });

    const results = await Promise.all(providers.map((p) => p.search(query(), ctx())));
    const groups = groupOffers(results.flatMap((result) => result.offers));

    expect(groups.some((group) => group.providerCount === 1)).toBe(true);
  });

  it('isolate a forced failure from the providers that still work', async () => {
    const providers = createOtaProviders({
      simulateLatency: false,
      failureModes: { cleartrip: 'error' },
    });

    const settled = await Promise.allSettled(providers.map((p) => p.search(query(), ctx())));

    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(settled.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});

describe('overlap with live data', () => {
  /**
   * The demonstration this project exists to make, asserted end to end.
   *
   * The live adapter returns the flights that genuinely operate; the OTAs price a
   * timetable. If the two sets never intersect, every cross-provider comparison comes from
   * simulated data alone and the deduplication is never shown working on anything real.
   *
   * Several DEL–BOM services therefore carry real IndiGo flight numbers and block times,
   * so a live fare and these representative fares produce the same canonical key.
   */
  it('sells real IndiGo services that the live adapter also returns', async () => {
    const providers = createOtaProviders({ simulateLatency: false });
    const searchQuery = query({ departureDate: '2026-08-25' });

    const results = await Promise.all(providers.map((p) => p.search(searchQuery, ctx())));
    const soldFlightNumbers = new Set(
      results.flatMap((r) => r.offers.map((o) => o.itinerary.segments[0]!.flightNumber)),
    );

    // Flight numbers taken from a recorded Google Flights response for this route.
    const realServices = ['449', '6814', '6107', '324', '354', '395'];
    const covered = realServices.filter((number) => soldFlightNumbers.has(number));

    expect(covered.length).toBeGreaterThanOrEqual(4);
  });

  it('produces identical canonical keys for a shared service', async () => {
    // Same carrier, number, date and route on both sides, which is all the key uses.
    const [makeMyTrip] = createOtaProviders({ simulateLatency: false });
    const { offers } = await makeMyTrip!.search(query({ departureDate: '2026-08-25' }), ctx());

    const shared = offers.find((o) => o.itinerary.segments[0]!.flightNumber === '449');

    expect(shared).toBeDefined();
    expect(canonicalKeyForOffer(shared!)).toBe('6E-449-2026-08-25-DEL-BOM');
  });
});
