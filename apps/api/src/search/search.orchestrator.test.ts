import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { searchQuerySchema, type SearchRequest } from '@polaris/contracts';
import {
  ProviderCredentialsMissingError,
  ProviderUnavailableError,
  createOtaProviders,
  type FlightProvider,
  type ProviderContext,
  type ProviderResult,
} from '@polaris/providers';
import { SearchOrchestrator } from './search.orchestrator';
import { FLIGHT_PROVIDERS } from '../providers/providers.module';
import { CACHE_STORE, InMemoryCacheStore } from '../cache/cache.store';

const request = (overrides: Partial<SearchRequest> = {}): SearchRequest => ({
  query: searchQuerySchema.parse({
    origin: 'DEL',
    destination: 'BOM',
    departureDate: '2026-08-20',
  }),
  ...overrides,
});

/** Env values the orchestrator reads. Short timeouts keep the suite fast. */
const ENV: Record<string, unknown> = {
  PROVIDER_TIMEOUT_MS: 200,
  CACHE_TTL_SECONDS: 300,
  CACHE_PARTIAL_TTL_SECONDS: 30,
  CIRCUIT_FAILURE_THRESHOLD: 2,
  CIRCUIT_RESET_MS: 30_000,
};

/**
 * A provider that behaves exactly as a test needs.
 *
 * Overriding the FLIGHT_PROVIDERS token with fakes is what makes the failure paths
 * testable at all — waiting for a real provider to break is not a test strategy.
 */
function fakeProvider(
  providerId: 'makemytrip' | 'goibibo' | 'cleartrip',
  behaviour: (ctx: ProviderContext) => Promise<ProviderResult>,
): FlightProvider {
  return {
    descriptor: {
      providerId,
      displayName: providerId,
      integrationType: 'representative',
      dataSource: 'generated-representative',
      isRealData: false,
      integrationNote: 'test fake',
      enabled: true,
    },
    search: (_query, ctx) => behaviour(ctx),
  };
}

const succeedsWith = (offerCount: number, providerId: 'makemytrip' | 'goibibo' | 'cleartrip') =>
  fakeProvider(providerId, async () => {
    const real = createOtaProviders({ simulateLatency: false })[0]!;
    const result = await real.search(request().query, {
      signal: new AbortController().signal,
      searchId: 'fake',
      now: new Date('2026-08-09T12:00:00Z'),
    });
    return { offers: result.offers.slice(0, offerCount), droppedOfferCount: 0 };
  });

async function buildOrchestrator(
  providers: FlightProvider[],
  cache: InMemoryCacheStore = new InMemoryCacheStore(),
): Promise<SearchOrchestrator> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      SearchOrchestrator,
      { provide: FLIGHT_PROVIDERS, useValue: providers },
      { provide: CACHE_STORE, useValue: cache },
      {
        provide: ConfigService,
        useValue: { get: (key: string) => ENV[key] },
      },
    ],
  }).compile();

  return moduleRef.get(SearchOrchestrator);
}

describe('SearchOrchestrator', () => {
  describe('the happy path', () => {
    it('aggregates and groups offers across providers', async () => {
      const orchestrator = await buildOrchestrator(createOtaProviders({ simulateLatency: false }));

      const response = await orchestrator.search(request());

      expect(response.groups.length).toBeGreaterThan(0);
      expect(response.meta.totalOffers).toBeGreaterThan(response.meta.totalGroups);
      expect(response.meta.multiProviderGroups).toBeGreaterThan(0);
      expect(response.meta.partial).toBe(false);
    });

    it('reports a status for every provider attempted', async () => {
      const orchestrator = await buildOrchestrator(createOtaProviders({ simulateLatency: false }));

      const response = await orchestrator.search(request());

      expect(response.providerStatuses).toHaveLength(3);
      expect(response.providerStatuses.every((s) => s.status === 'ok')).toBe(true);
      expect(response.meta.providersSucceeded).toBe(3);
    });

    it('ranks by value by default', async () => {
      const orchestrator = await buildOrchestrator(createOtaProviders({ simulateLatency: false }));

      const response = await orchestrator.search(request());
      const scores = response.groups.map((group) => group.score.total);

      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    });
  });

  describe('partial results', () => {
    /**
     * The requirement the whole design turns on: one provider failing must not cost the
     * user the results from the others.
     */
    it('returns results from the survivors when one provider fails', async () => {
      const orchestrator = await buildOrchestrator([
        ...createOtaProviders({
          simulateLatency: false,
          failureModes: { cleartrip: 'error' },
        }),
      ]);

      const response = await orchestrator.search(request());

      expect(response.groups.length).toBeGreaterThan(0);
      expect(response.meta.partial).toBe(true);
      expect(response.meta.providersSucceeded).toBe(2);
      expect(response.meta.providersAttempted).toBe(3);
    });

    it('explains the failure in the provider status', async () => {
      const orchestrator = await buildOrchestrator(
        createOtaProviders({ simulateLatency: false, failureModes: { cleartrip: 'error' } }),
      );

      const response = await orchestrator.search(request());
      const cleartrip = response.providerStatuses.find((s) => s.providerId === 'cleartrip')!;

      expect(cleartrip.status).toBe('error');
      expect(cleartrip.offerCount).toBe(0);
      expect(cleartrip.message).toContain('outage');
    });

    it('records a timeout distinctly from an error', async () => {
      const orchestrator = await buildOrchestrator([
        succeedsWith(3, 'makemytrip'),
        fakeProvider('cleartrip', () => new Promise<ProviderResult>(() => {})),
      ]);

      const response = await orchestrator.search(request());
      const cleartrip = response.providerStatuses.find((s) => s.providerId === 'cleartrip')!;

      expect(cleartrip.status).toBe('timeout');
      expect(response.groups.length).toBeGreaterThan(0);
    });

    it('succeeds with zero flights when every provider fails', async () => {
      // Distinguishable from "no flights on this route", which a thrown error would not be.
      const orchestrator = await buildOrchestrator([
        fakeProvider('makemytrip', async () => {
          throw new ProviderUnavailableError('makemytrip', 'down');
        }),
        fakeProvider('goibibo', async () => {
          throw new ProviderUnavailableError('goibibo', 'down');
        }),
      ]);

      const response = await orchestrator.search(request());

      expect(response.groups).toEqual([]);
      expect(response.meta.partial).toBe(true);
      expect(response.meta.providersSucceeded).toBe(0);
    });

    it('marks an unconfigured provider skipped rather than failed', async () => {
      const orchestrator = await buildOrchestrator([
        fakeProvider('goibibo', async () => {
          throw new ProviderCredentialsMissingError('goibibo', 'SOME_KEY');
        }),
      ]);

      const response = await orchestrator.search(request());
      const status = response.providerStatuses[0]!;

      expect(status.status).toBe('skipped');
      expect(status.message).toContain('SOME_KEY');
    });

    it('distinguishes an empty result from a failure', async () => {
      const orchestrator = await buildOrchestrator([
        fakeProvider('goibibo', async () => ({ offers: [], droppedOfferCount: 0 })),
      ]);

      const response = await orchestrator.search(request());

      expect(response.providerStatuses[0]!.status).toBe('empty');
      // An empty answer is a successful call, so this is not a partial result.
      expect(response.meta.partial).toBe(false);
    });

    it('survives a provider throwing a non-Error value', async () => {
      const orchestrator = await buildOrchestrator([
        fakeProvider('goibibo', async () => {
          throw 'string thrown from a careless library';
        }),
      ]);

      const response = await orchestrator.search(request());

      expect(response.providerStatuses[0]!.status).toBe('error');
      expect(response.providerStatuses[0]!.message).toBeTruthy();
    });
  });

  describe('the circuit breaker', () => {
    it('skips a provider once it has failed repeatedly', async () => {
      const orchestrator = await buildOrchestrator([
        fakeProvider('goibibo', async () => {
          throw new ProviderUnavailableError('goibibo', 'down');
        }),
      ]);

      // Threshold is 2, so the third search should not attempt the call at all.
      await orchestrator.search(request({ query: uniqueQuery(1) }));
      await orchestrator.search(request({ query: uniqueQuery(2) }));
      const third = await orchestrator.search(request({ query: uniqueQuery(3) }));

      expect(third.providerStatuses[0]!.status).toBe('circuit_open');
      expect(third.providerStatuses[0]!.latencyMs).toBe(0);
    });

    it('exposes circuit state for the health view', async () => {
      const orchestrator = await buildOrchestrator([
        fakeProvider('goibibo', async () => {
          throw new ProviderUnavailableError('goibibo', 'down');
        }),
      ]);

      await orchestrator.search(request({ query: uniqueQuery(1) }));
      await orchestrator.search(request({ query: uniqueQuery(2) }));

      expect(orchestrator.circuitStates()['goibibo']).toEqual({ state: 'open', failures: 2 });
    });
  });

  describe('caching', () => {
    it('serves a repeated search from cache without calling providers again', async () => {
      let calls = 0;
      const orchestrator = await buildOrchestrator([
        fakeProvider('goibibo', async () => {
          calls += 1;
          return { offers: [], droppedOfferCount: 0 };
        }),
      ]);

      const first = await orchestrator.search(request());
      const second = await orchestrator.search(request());

      expect(calls).toBe(1);
      expect(first.meta.cached).toBe(false);
      expect(second.meta.cached).toBe(true);
    });

    /**
     * The cache holds the unfiltered result, so narrowing is instant rather than another
     * full fan-out — which also protects the live provider's monthly quota.
     */
    it('applies different filters to one cached result set', async () => {
      const orchestrator = await buildOrchestrator(createOtaProviders({ simulateLatency: false }));

      const all = await orchestrator.search(request());
      const cheap = await orchestrator.search(request({ filters: { maxPriceMinor: 500_000 } }));

      expect(cheap.meta.cached).toBe(true);
      expect(cheap.groups.length).toBeLessThan(all.groups.length);
      // Totals describe the whole result set, not the filtered view.
      expect(cheap.meta.totalGroups).toBe(all.meta.totalGroups);
    });
  });

  /**
   * A cache hit reproduces the provider statuses as well as the offers, and does so without
   * reaching the fan-out — so a cached failure is a failure the circuit breaker never gets
   * to reconsider. At the full TTL one timeout would present as a five-minute outage.
   */
  describe('caching a search that partly failed', () => {
    /** Cheapest way to make a provider count how often it is really called. */
    const countingFailure = (counter: { calls: number }) =>
      fakeProvider('cleartrip', async () => {
        counter.calls += 1;
        throw new ProviderUnavailableError('cleartrip', 'down');
      });

    it('retries the failed provider well before the full TTL', async () => {
      let clock = 1_000_000;
      const counter = { calls: 0 };
      const orchestrator = await buildOrchestrator(
        [succeedsWith(3, 'makemytrip'), countingFailure(counter)],
        new InMemoryCacheStore(500, () => clock),
      );

      const first = await orchestrator.search(request());
      expect(first.meta.partial).toBe(true);
      expect(counter.calls).toBe(1);

      // Inside the partial window: still served from cache, nobody re-called.
      clock += 29_000;
      expect((await orchestrator.search(request())).meta.cached).toBe(true);
      expect(counter.calls).toBe(1);

      // Past the partial TTL, and nowhere near the 300s a clean search would have kept.
      clock += 2_000;
      expect((await orchestrator.search(request())).meta.cached).toBe(false);
      expect(counter.calls).toBe(2);
    });

    it('still keeps a fully successful search for the full TTL', async () => {
      let clock = 1_000_000;
      const orchestrator = await buildOrchestrator(
        [succeedsWith(3, 'makemytrip')],
        new InMemoryCacheStore(500, () => clock),
      );

      await orchestrator.search(request());

      // The same point at which the partial result above had already expired.
      clock += 31_000;

      expect((await orchestrator.search(request())).meta.cached).toBe(true);
    });

    /**
     * An unconfigured provider is not a transient failure — it cannot recover without an
     * environment change and a restart, so shortening the TTL would re-fetch the healthy
     * providers on a loop and buy nothing.
     */
    it('does not shorten the TTL for a provider that is merely unconfigured', async () => {
      let clock = 1_000_000;
      const orchestrator = await buildOrchestrator(
        [
          succeedsWith(3, 'makemytrip'),
          fakeProvider('goibibo', async () => {
            throw new ProviderCredentialsMissingError('goibibo', 'SOME_KEY');
          }),
        ],
        new InMemoryCacheStore(500, () => clock),
      );

      const first = await orchestrator.search(request());
      expect(first.providerStatuses.some((status) => status.status === 'skipped')).toBe(true);

      clock += 31_000;

      expect((await orchestrator.search(request())).meta.cached).toBe(true);
    });
  });

  describe('filtering and sorting', () => {
    it('applies a requested sort', async () => {
      const orchestrator = await buildOrchestrator(createOtaProviders({ simulateLatency: false }));

      const response = await orchestrator.search(request({ sort: { key: 'price' } }));
      const prices = response.groups.map((group) => group.priceSpread.min.amountMinor);

      expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    });

    it('applies requested filters', async () => {
      const orchestrator = await buildOrchestrator(createOtaProviders({ simulateLatency: false }));

      const response = await orchestrator.search(
        request({ filters: { departureWindow: { from: '06:00', to: '12:00' } } }),
      );

      for (const group of response.groups) {
        const time = group.itinerary.segments[0]!.departure.local.slice(11, 16);
        expect(time >= '06:00' && time <= '12:00').toBe(true);
      }
    });

    it('narrows to the providers named in the query', async () => {
      const orchestrator = await buildOrchestrator(createOtaProviders({ simulateLatency: false }));

      const response = await orchestrator.search({
        query: searchQuerySchema.parse({
          origin: 'DEL',
          destination: 'BOM',
          departureDate: '2026-08-20',
          providers: ['goibibo'],
        }),
      });

      expect(response.providerStatuses).toHaveLength(1);
      expect(response.providerStatuses[0]!.providerId).toBe('goibibo');
    });
  });

  describe('the preferred time range', () => {
    /**
     * Regression. timeRange is one of the four search criteria the brief names. It was
     * previously accepted, validated, and then ignored entirely — so a user asking for a
     * morning flight was shown red-eyes and late-evening departures.
     */
    it('returns only flights departing inside the requested window', async () => {
      const orchestrator = await buildOrchestrator(createOtaProviders({ simulateLatency: false }));

      const response = await orchestrator.search({
        query: searchQuerySchema.parse({
          origin: 'DEL',
          destination: 'BOM',
          departureDate: '2026-08-20',
          timeRange: { from: '06:00', to: '12:00' },
        }),
      });

      expect(response.groups.length).toBeGreaterThan(0);
      for (const group of response.groups) {
        const departure = group.itinerary.segments[0]!.departure.local.slice(11, 16);
        expect(departure >= '06:00' && departure <= '12:00').toBe(true);
      }
    });

    it('excludes an after-midnight departure from a morning search', async () => {
      // DEL-BOM 6E-2134 leaves at 00:45 local. It must not appear under "morning", and
      // must be matched on local time rather than its 19:15Z instant.
      const orchestrator = await buildOrchestrator(createOtaProviders({ simulateLatency: false }));

      const morning = await orchestrator.search({
        query: searchQuerySchema.parse({
          origin: 'DEL',
          destination: 'BOM',
          departureDate: '2026-08-20',
          timeRange: { from: '06:00', to: '12:00' },
        }),
      });
      const earlyMorning = await orchestrator.search({
        query: searchQuerySchema.parse({
          origin: 'DEL',
          destination: 'BOM',
          departureDate: '2026-08-20',
          timeRange: { from: '00:00', to: '06:00' },
        }),
      });

      const has2134 = (r: typeof morning) =>
        r.groups.some((g) => g.itinerary.segments[0]!.flightNumber === '2134');

      expect(has2134(morning)).toBe(false);
      expect(has2134(earlyMorning)).toBe(true);
    });

    /**
     * The cache stores the whole day, so different windows are different views over one
     * provider fetch. This is what makes omitting timeRange from the cache key correct
     * rather than a latent bug — and it is where the original defect would have resurfaced.
     */
    it('serves different windows from one cached provider fetch', async () => {
      let calls = 0;
      const orchestrator = await buildOrchestrator([
        fakeProvider('makemytrip', async (fakeCtx) => {
          calls += 1;
          const real = createOtaProviders({ simulateLatency: false })[0]!;
          return real.search(request().query, fakeCtx);
        }),
      ]);

      const morning = await orchestrator.search({
        query: searchQuerySchema.parse({
          origin: 'DEL',
          destination: 'BOM',
          departureDate: '2026-08-20',
          timeRange: { from: '06:00', to: '12:00' },
        }),
      });
      const evening = await orchestrator.search({
        query: searchQuerySchema.parse({
          origin: 'DEL',
          destination: 'BOM',
          departureDate: '2026-08-20',
          timeRange: { from: '18:00', to: '23:59' },
        }),
      });

      expect(calls).toBe(1);
      expect(evening.meta.cached).toBe(true);
      // Same cache entry, genuinely different results — not the morning list repeated.
      expect(evening.groups.map((g) => g.canonicalKey)).not.toEqual(
        morning.groups.map((g) => g.canonicalKey),
      );
      for (const group of evening.groups) {
        expect(group.itinerary.segments[0]!.departure.local.slice(11, 16) >= '18:00').toBe(true);
      }
    });

    it('lets an explicit departureWindow filter override the query window', async () => {
      const orchestrator = await buildOrchestrator(createOtaProviders({ simulateLatency: false }));

      const response = await orchestrator.search({
        query: searchQuerySchema.parse({
          origin: 'DEL',
          destination: 'BOM',
          departureDate: '2026-08-20',
          timeRange: { from: '06:00', to: '12:00' },
        }),
        filters: { departureWindow: { from: '18:00', to: '23:59' } },
      });

      for (const group of response.groups) {
        expect(group.itinerary.segments[0]!.departure.local.slice(11, 16) >= '18:00').toBe(true);
      }
    });
  });

  it('returns no flights for an unserved route without failing', async () => {
    const orchestrator = await buildOrchestrator(createOtaProviders({ simulateLatency: false }));

    const response = await orchestrator.search({
      query: searchQuerySchema.parse({
        origin: 'GOI',
        destination: 'CCU',
        departureDate: '2026-08-20',
      }),
    });

    expect(response.groups).toEqual([]);
    expect(response.meta.partial).toBe(false);
    expect(response.providerStatuses.every((s) => s.status === 'empty')).toBe(true);
  });
});

/** Distinct queries, so cache hits do not mask repeated provider calls. */
function uniqueQuery(n: number) {
  return searchQuerySchema.parse({
    origin: 'DEL',
    destination: 'BOM',
    departureDate: `2026-08-2${n}`,
  });
}
