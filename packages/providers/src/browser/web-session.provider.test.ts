import { describe, expect, it } from 'vitest';
import { searchQuerySchema, type SearchQuery } from '@polaris/contracts';
import { canonicalKeyForOffer } from '@polaris/core';
import { WebSessionProvider, webSessionFixtureFileName } from './web-session.provider';
import { createWebSessionProviders, parseWebSessionSites } from './web-session-providers';
import { cleartripSite } from './sites/cleartrip.site';
import { easeMyTripSite } from './sites/easemytrip.site';
import { ixigoSite } from './sites/ixigo.site';
import { flightNumberOf, baggageKg, plainText, scheduledFromEpoch } from './site-helpers';
import type { WebSearchSite } from './web-session-site';

/** The date every checked-in DEL-BOM recording was captured for. */
const RECORDED_DATE = '2026-08-27';

const query = (overrides: Partial<SearchQuery> = {}): SearchQuery =>
  searchQuerySchema.parse({
    origin: 'DEL',
    destination: 'BOM',
    departureDate: RECORDED_DATE,
    ...overrides,
  });

const ctx = (signal = new AbortController().signal) => ({
  signal,
  searchId: 'test',
  now: new Date('2026-08-15T12:00:00.000Z'),
});

/** Every agency read through a browser session, so each is held to the same contract. */
const SITES: [string, WebSearchSite<unknown>][] = [
  ['Cleartrip', cleartripSite as WebSearchSite<unknown>],
  ['EaseMyTrip', easeMyTripSite as WebSearchSite<unknown>],
  ['Ixigo', ixigoSite as WebSearchSite<unknown>],
];

describe.each(SITES)('%s web session', (_name, site) => {
  const provider = () => new WebSessionProvider(site, 'fixture');

  it('declares browser automation as its own provenance, not a live API', () => {
    const { descriptor } = provider();

    // The distinction the whole adapter exists to keep honest: real and current data, but
    // through an undocumented endpoint outside any agreement, which is not `live-api`.
    expect(descriptor.integrationType).toBe('browser-automation');
    expect(descriptor.dataSource).toBe('provider-web-session');
    expect(descriptor.isRealData).toBe(true);
  });

  it('maps a recorded response into normalised offers', async () => {
    const result = await provider().search(query(), ctx());

    expect(result.offers.length).toBeGreaterThan(0);
    // A non-zero drop count means the payload shape changed or the mapping is wrong. It is
    // deliberately not used for inventory a mapper declines on purpose.
    expect(result.droppedOfferCount).toBe(0);
  });

  /**
   * Replayed data is never labelled with the live provenance. A recording is real data
   * that is no longer current, which is closer to representative than to anything live.
   */
  it('does not label replayed data as browser-automation', async () => {
    const { offers } = await provider().search(query(), ctx());

    expect(offers.every((o) => o.integrationType === 'representative')).toBe(true);
    expect(offers.some((o) => o.integrationType === 'browser-automation')).toBe(false);
  });

  /**
   * Every one of these sites volunteers departures from nearby airports: a Delhi search
   * returns flights out of DXN. Helpful on their own sites, wrong in a comparison where
   * other providers answered the route exactly as asked.
   */
  it('drops offers that substitute a nearby airport for the one searched', async () => {
    const { offers } = await provider().search(query(), ctx());

    for (const offer of offers) {
      expect(offer.itinerary.origin).toBe('DEL');
      expect(offer.itinerary.destination).toBe('BOM');
      expect(offer.itinerary.segments[0]!.origin).toBe('DEL');
      expect(offer.itinerary.segments.at(-1)!.destination).toBe('BOM');
    }
  });

  /** A wrong flight number silently merges two different flights under one canonical key. */
  it('emits flight numbers without a carrier prefix', async () => {
    const { offers } = await provider().search(query(), ctx());

    for (const segment of offers.flatMap((o) => o.itinerary.segments)) {
      expect(segment.flightNumber).toMatch(/^\d{1,4}[A-Z]?$/);
      expect(segment.marketingCarrier).toMatch(/^[A-Z0-9]{2}$/);
    }
  });

  it('prices every offer above zero', async () => {
    const { offers } = await provider().search(query(), ctx());

    // toMinor yields 0 for a missing amount, which must fail rather than quote a free seat.
    for (const offer of offers) {
      expect(offer.price.total.amountMinor).toBeGreaterThan(0);
      expect(offer.price.total.currency).toBe('INR');
    }
  });

  it('gives each offer a distinct id', async () => {
    const { offers } = await provider().search(query(), ctx());

    expect(new Set(offers.map((o) => o.id)).size).toBe(offers.length);
  });

  /** The canonical key is what makes cross-provider deduplication possible at all. */
  it('produces offers that group by canonical key on the local departure date', async () => {
    const { offers } = await provider().search(query(), ctx());
    const nonStop = offers.filter((o) => o.itinerary.stops === 0);

    expect(nonStop.length).toBeGreaterThan(0);
    for (const offer of nonStop) {
      // A UTC date would silently get this wrong for a red-eye.
      expect(canonicalKeyForOffer(offer)).toContain(RECORDED_DATE);
    }
  });

  it('keeps local and UTC times consistent with the reported zone', async () => {
    const { offers } = await provider().search(query(), ctx());

    for (const { departure } of offers.flatMap((o) => o.itinerary.segments)) {
      expect(departure.timeZone).toBe('Asia/Kolkata');
      expect(Date.parse(`${departure.local}Z`) - Date.parse(departure.utc)).toBe(330 * 60_000);
    }
  });

  /**
   * A recording is a snapshot of one route on one day. Serving it for another date would
   * present one day's departures as another's while the offer id claimed the date asked for.
   */
  it('refuses a recording captured for a different date', async () => {
    const result = await provider().search(query({ departureDate: '2026-12-25' }), ctx());

    expect(result.offers).toEqual([]);
    expect(result.message).toContain('No data available');
  });

  /** Configured replay is not an outage and must not be reported as one. */
  it('does not claim the live session failed when replay was configured', async () => {
    const result = await provider().search(query(), ctx());

    expect(result.message).toContain('browser sessions are disabled');
    expect(result.message).not.toContain('failed');
  });

  it('builds a results URL a person could actually follow', () => {
    const url = new URL(
      site.buildUrl({
        origin: 'DEL',
        destination: 'BOM',
        departureDate: RECORDED_DATE,
        adults: 1,
        cabinClass: 'economy',
      }),
    );

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toMatch(/cleartrip\.com|easemytrip\.com|ixigo\.com/);
  });
});

describe('Cleartrip specifics', () => {
  const provider = () => new WebSessionProvider(cleartripSite, 'fixture');

  /**
   * The reason this source is worth having beyond being real: it is the only one that
   * discloses the fare/tax split, so `price.total` can be audited rather than trusted.
   */
  it('carries a price breakdown that reconciles to the total', async () => {
    const { offers } = await provider().search(query(), ctx());

    for (const offer of offers) {
      expect(offer.price.baseFare).toBeDefined();
      expect(offer.price.taxesAndFees).toBeDefined();
      expect(offer.price.baseFare!.amountMinor + offer.price.taxesAndFees!.amountMinor).toBe(
        offer.price.total.amountMinor,
      );
    }
  });

  /**
   * Every Cleartrip fare carries a coupon. Pricing on the discounted figure would rank this
   * provider above sellers quoting honestly, on a price most users cannot obtain.
   */
  it('prices on the undiscounted total and carries the coupon as conditional', async () => {
    const { offers } = await provider().search(query(), ctx());
    const withCoupon = offers.filter((o) => o.benefits.some((b) => b.type === 'discount'));

    expect(withCoupon.length).toBeGreaterThan(0);
    for (const offer of withCoupon) {
      const coupon = offer.benefits.find((b) => b.type === 'discount')!;
      // Conditional benefits are excluded from scoring, which is the point of the flag.
      expect(coupon.conditional).toBe(true);
      expect(offer.price.total.amountMinor).toBeGreaterThan(coupon.value!.amountMinor);
    }
  });

  /**
   * `docs/LIMITATIONS.md` records that codeshares are not merged because no source supplies
   * the operating carrier. This one does.
   */
  it('records the operating carrier only when it differs from the marketing carrier', async () => {
    const { offers } = await provider().search(query(), ctx());
    const segments = offers.flatMap((o) => o.itinerary.segments);

    expect(segments.some((s) => s.operatingCarrier)).toBe(true);
    for (const segment of segments) {
      if (segment.operatingCarrier) {
        expect(segment.operatingCarrier).not.toBe(segment.marketingCarrier);
      }
    }
  });
});

describe('EaseMyTrip specifics', () => {
  const provider = () => new WebSessionProvider(easeMyTripSite, 'fixture');

  /** The only source here that reports how many seats are left at a fare. */
  it('reports seats remaining', async () => {
    const { offers } = await provider().search(query(), ctx());

    expect(offers.some((o) => typeof o.seatsAvailable === 'number')).toBe(true);
    for (const offer of offers) {
      if (offer.seatsAvailable !== undefined) {
        expect(offer.seatsAvailable).toBeGreaterThan(0);
      }
    }
  });

  it('carries the baggage allowance structurally rather than as a perk label', async () => {
    const { offers } = await provider().search(query(), ctx());

    expect(offers.some((o) => o.baggage?.checkedKg)).toBe(true);
    // A bare "7 Kgs" describes the allowance and must not be duplicated as a benefit.
    for (const offer of offers) {
      expect(offer.benefits.every((b) => !/^\d+\s*kgs?$/i.test(b.label))).toBe(true);
    }
  });

  /**
   * AP and APT are per-adult. Publishing them for a multi-passenger search would show a
   * breakdown that does not add up to the total beside it.
   */
  it('publishes a breakdown only when it reconciles', async () => {
    const { offers } = await provider().search(query(), ctx());

    for (const offer of offers) {
      if (offer.price.baseFare && offer.price.taxesAndFees) {
        expect(offer.price.baseFare.amountMinor + offer.price.taxesAndFees.amountMinor).toBe(
          offer.price.total.amountMinor,
        );
      }
    }
  });
});

describe('Ixigo specifics', () => {
  const provider = () => new WebSessionProvider(ixigoSite, 'fixture');

  /**
   * Ixigo describes a connection as a single end-to-end entry with every flight number
   * joined and layovers named by city. Synthesising legs from that would put invented
   * airport codes behind a real price, so they are declined.
   */
  it('maps only non-stop itineraries, and says so', async () => {
    const result = await provider().search(query(), ctx());

    expect(result.offers.length).toBeGreaterThan(0);
    expect(result.offers.every((o) => o.itinerary.stops === 0)).toBe(true);
    expect(result.droppedOfferCount).toBe(0);
  });

  it('strips markup and fixes the mis-encoded rupee sign in promotional copy', async () => {
    const { offers } = await provider().search(query(), ctx());
    const labels = offers.flatMap((o) => o.benefits.map((b) => b.label));

    for (const label of labels) {
      expect(label).not.toContain('<');
      expect(label).not.toContain('â‚¹');
    }
  });
});

describe('site helpers', () => {
  it('rejects a flight number it cannot read unambiguously', () => {
    // A wrong number is worse than a missing offer: the canonical key is built from it.
    expect(flightNumberOf(' 815')).toBe('815');
    expect(flightNumberOf('9584, AI2790')).toBeUndefined();
    expect(flightNumberOf('')).toBeUndefined();
    expect(flightNumberOf('2134A')).toBe('2134A');
  });

  it('reads a weight out of each site’s phrasing', () => {
    expect(baggageKg('15 kg per adult')).toBe(15);
    expect(baggageKg('Kgs|15')).toBe(15);
    expect(baggageKg(undefined)).toBeUndefined();
  });

  it('cleans promotional markup', () => {
    expect(plainText('<b>Extra â‚¹350 Off</b>')).toBe('Extra ₹350 Off');
  });

  it('derives local time from a true instant', () => {
    // 2026-08-27T05:50:00Z is 11:20 IST the same day.
    const scheduled = scheduledFromEpoch(Date.parse('2026-08-27T05:50:00Z'));

    expect(scheduled.local).toBe('2026-08-27T11:20:00');
    expect(scheduled.utc).toBe('2026-08-27T05:50:00Z');
  });
});

describe('web session registration', () => {
  it('names fixtures consistently with the loader', () => {
    expect(webSessionFixtureFileName('ixigo', 'DEL', 'BOM', RECORDED_DATE)).toBe(
      'ixigo-del-bom-2026-08-27.json',
    );
  });

  it('registers only the agencies asked for', () => {
    expect(createWebSessionProviders(['cleartrip']).map((p) => p.descriptor.providerId)).toEqual([
      'cleartrip',
    ]);
    expect(createWebSessionProviders([]).length).toBe(0);
  });

  /** A typo should leave a provider on its fallback, not refuse to boot the API. */
  it('ignores unknown ids rather than failing', () => {
    expect(parseWebSessionSites('cleartrip,makemytrip,nonsense')).toEqual(new Set(['cleartrip']));
    expect(parseWebSessionSites(undefined).size).toBe(0);
  });

  it('supports enabling every agency at once', () => {
    expect(parseWebSessionSites('all')).toEqual(new Set(['cleartrip', 'easemytrip', 'ixigo']));
  });
});
