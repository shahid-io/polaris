import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchQuerySchema, type SearchQuery } from '@polaris/contracts';
import { canonicalKeyForOffer, groupOffers } from '@polaris/core';
import {
  AIR_INDIA_EXPRESS_CONFIG,
  INDIGO_CONFIG,
  SerpApiProvider,
  createSerpApiProviders,
} from './serpapi.provider';
import { collectItineraries, resetRequestCoalescing } from './serpapi-client';
import { ProviderCredentialsMissingError } from '../types';

const query = (overrides: Partial<SearchQuery> = {}): SearchQuery =>
  searchQuerySchema.parse({
    origin: 'DEL',
    destination: 'BOM',
    departureDate: '2026-09-15',
    ...overrides,
  });

const ctx = (signal = new AbortController().signal) => ({
  signal,
  searchId: 'test',
  now: new Date('2026-08-11T12:00:00.000Z'),
});

beforeEach(() => {
  resetRequestCoalescing();
});

describe('SerpApiProvider', () => {
  it('declares itself as live real data', () => {
    const provider = new SerpApiProvider(INDIGO_CONFIG, 'key', 'fixture');

    expect(provider.descriptor.integrationType).toBe('live-api');
    expect(provider.descriptor.isRealData).toBe(true);
    expect(provider.descriptor.dataSource).toBe('serpapi-google-flights');
  });

  it('maps a recorded response into normalised offers', async () => {
    const provider = new SerpApiProvider(INDIGO_CONFIG, undefined, 'fixture');

    const result = await provider.search(query(), ctx());

    expect(result.offers.length).toBeGreaterThan(0);
    // A non-zero drop count means the payload shape changed or the mapping is wrong.
    expect(result.droppedOfferCount).toBe(0);
  });

  /**
   * One SerpApi response carries every airline on the route. Each provider must return
   * only its own carrier, or IndiGo and Air India Express would report identical results
   * and the comparison would be meaningless.
   */
  it('returns only its own carrier', async () => {
    const indigo = new SerpApiProvider(INDIGO_CONFIG, undefined, 'fixture');
    const express = new SerpApiProvider(AIR_INDIA_EXPRESS_CONFIG, undefined, 'fixture');

    const [indigoResult, expressResult] = await Promise.all([
      indigo.search(query(), ctx()),
      express.search(query(), ctx()),
    ]);

    expect(
      indigoResult.offers.every((o) => o.itinerary.segments[0]!.marketingCarrier === '6E'),
    ).toBe(true);
    expect(
      expressResult.offers.every((o) => o.itinerary.segments[0]!.marketingCarrier === 'IX'),
    ).toBe(true);
    expect(indigoResult.offers.length).toBeGreaterThan(expressResult.offers.length);
  });

  it('resolves local times to the correct UTC instant', async () => {
    const provider = new SerpApiProvider(INDIGO_CONFIG, undefined, 'fixture');

    const { offers } = await provider.search(query(), ctx());
    const departure = offers[0]!.itinerary.segments[0]!.departure;

    expect(departure.timeZone).toBe('Asia/Kolkata');
    // IST is UTC+05:30, so the instant is 330 minutes before the wall clock.
    const localAsUtc = Date.parse(`${departure.local}Z`);
    expect(localAsUtc - Date.parse(departure.utc)).toBe(330 * 60_000);
  });

  it('keeps an after-midnight departure on its local date', async () => {
    const provider = new SerpApiProvider(INDIGO_CONFIG, undefined, 'fixture');

    const { offers } = await provider.search(query(), ctx());
    const redEye = offers.find((o) =>
      o.itinerary.segments[0]!.departure.local.slice(11, 16) < '01:00',
    );

    if (redEye) {
      const departure = redEye.itinerary.segments[0]!.departure;
      // The UTC instant falls on the previous day; the key must not follow it.
      expect(departure.utc.slice(0, 10) < departure.local.slice(0, 10)).toBe(true);
      expect(canonicalKeyForOffer(redEye)).toContain(departure.local.slice(0, 10));
    }
  });

  it('preserves connecting itineraries with their layover time', async () => {
    const provider = new SerpApiProvider(INDIGO_CONFIG, undefined, 'fixture');

    const { offers } = await provider.search(query(), ctx());
    const connecting = offers.find((o) => o.itinerary.stops > 0);

    expect(connecting).toBeDefined();
    const segmentTotal = connecting!.itinerary.segments.reduce(
      (sum, s) => sum + s.durationMinutes,
      0,
    );
    // Total duration includes the layover, so it must exceed the flown time.
    expect(connecting!.itinerary.totalDurationMinutes).toBeGreaterThan(segmentTotal);
  });

  it('converts whole-rupee prices to exact paise', async () => {
    const provider = new SerpApiProvider(INDIGO_CONFIG, undefined, 'fixture');

    const { offers } = await provider.search(query(), ctx());

    for (const offer of offers) {
      expect(offer.price.total.amountMinor % 100).toBe(0);
      expect(offer.price.total.currency).toBe('INR');
    }
  });

  it('returns an empty result when no fixture covers the route', async () => {
    const provider = new SerpApiProvider(INDIGO_CONFIG, undefined, 'fixture');

    const result = await provider.search(query({ destination: 'GAU' }), ctx());

    expect(result.offers).toEqual([]);
    expect(result.message).toContain('No data available');
  });

  /**
   * Regression, and the most serious defect found in review.
   *
   * A recording is a snapshot of one route on one specific day. loadFixture previously
   * ignored the requested date entirely, so a search for 25 August would be served the
   * 15 September recording — its offer id carrying the requested date while every
   * timestamp inside it disagreed.
   */
  it('refuses a fixture recorded for a different date', async () => {
    const provider = new SerpApiProvider(INDIGO_CONFIG, undefined, 'fixture');

    const result = await provider.search(query({ departureDate: '2026-08-25' }), ctx());

    expect(result.offers).toEqual([]);
    expect(result.message).toContain('2026-08-25');
  });

  it('returns flights whose dates match the date requested', async () => {
    const provider = new SerpApiProvider(INDIGO_CONFIG, undefined, 'fixture');

    const { offers } = await provider.search(query(), ctx());

    for (const offer of offers) {
      expect(offer.itinerary.segments[0]!.departure.local.slice(0, 10)).toBe('2026-09-15');
    }
  });

  /**
   * Provenance must reflect where the data actually came from. A hybrid provider that
   * fell back to a recording is not serving live data, and a "Live" badge on a stale
   * price is worse than no badge at all.
   */
  it('does not label replayed fixture data as live', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('quota exhausted'));
    const provider = new SerpApiProvider(INDIGO_CONFIG, 'key', 'hybrid');

    const result = await provider.search(query(), ctx());

    expect(result.offers.length).toBeGreaterThan(0);
    expect(result.offers.every((o) => o.integrationType === 'representative')).toBe(true);
    expect(result.offers.some((o) => o.integrationType === 'live-api')).toBe(false);
    expect(result.message).toContain('replayed a recorded response');
    fetchSpy.mockRestore();
  });

  it('reports missing credentials rather than failing the search', async () => {
    // Live mode with no key: not retryable, and the orchestrator maps it to "skipped".
    const provider = new SerpApiProvider(INDIGO_CONFIG, undefined, 'live');

    await expect(provider.search(query(), ctx())).rejects.toThrow(
      ProviderCredentialsMissingError,
    );
  });

  it('falls back to a fixture in hybrid mode when the API is unavailable', async () => {
    // The property that keeps a live demonstration working when the network drops or the
    // monthly quota is exhausted.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network unreachable'));
    const provider = new SerpApiProvider(INDIGO_CONFIG, 'key', 'hybrid');

    const result = await provider.search(query(), ctx());

    expect(result.offers.length).toBeGreaterThan(0);
    fetchSpy.mockRestore();
  });

  /**
   * Both airline providers share one upstream call. Creating that call on whichever
   * caller arrived first meant the first provider's timeout aborted a request the second
   * was still legitimately waiting on, inside its own untouched budget — one provider's
   * deadline silently failing another.
   */
  it('does not let one provider cancellation abort the shared request', async () => {
    let resolveUpstream: (value: Response) => void = () => {};
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>((resolve) => { resolveUpstream = resolve; }),
    );

    const [indigo, express] = createSerpApiProviders('key', 'live');
    const firstCaller = new AbortController();

    const abandoned = indigo!.search(query(), ctx(firstCaller.signal));
    const stillWaiting = express!.search(query(), ctx());

    // The first caller gives up; the shared request must survive for the second.
    firstCaller.abort();
    await expect(abandoned).rejects.toThrow(/cancelled by caller/);

    resolveUpstream(
      new Response(JSON.stringify({ best_flights: [], other_flights: [] }), { status: 200 }),
    );

    await expect(stillWaiting).resolves.toMatchObject({ offers: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});

describe('collectItineraries', () => {
  /**
   * best_flights is a curated subset that also appears in other_flights. Concatenating
   * naively would list those itineraries twice, and grouping would then show one flight
   * with a phantom second offer at an identical price.
   */
  it('removes the overlap between best_flights and other_flights', () => {
    const shared = {
      flights: [{ flight_number: '6E 100' }],
      total_duration: 100,
      price: 5000,
    } as never;

    const unique = collectItineraries({ best_flights: [shared], other_flights: [shared] });

    expect(unique).toHaveLength(1);
  });
});

describe('createSerpApiProviders', () => {
  it('builds one provider per carrier', () => {
    const providers = createSerpApiProviders('key', 'fixture');

    expect(providers.map((p) => p.descriptor.providerId)).toEqual(['indigo', 'airindiaexpress']);
  });

  /**
   * Both providers are backed by the same endpoint. Without coalescing, one user search
   * would spend two of the 250 credits the free tier allows each month on identical data.
   */
  it('coalesces the two providers into a single upstream call', async () => {
    const fixture = { best_flights: [], other_flights: [] };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    );

    const providers = createSerpApiProviders('key', 'live');
    await Promise.all(providers.map((p) => p.search(query(), ctx())));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});
