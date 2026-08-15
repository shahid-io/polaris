import { describe, expect, it } from 'vitest';
import { countMultiProviderGroups, groupOffers } from './grouping';
import {
  buildItinerary,
  buildOffer,
  buildSameFlightAcrossProviders,
  buildSegment,
  istTime,
} from './testing/builders';

const rupees = (amountMinor: number) => amountMinor / 100;

describe('groupOffers', () => {
  it('returns nothing for no offers', () => {
    expect(groupOffers([])).toEqual([]);
  });

  it('collapses the same flight from three providers into one group', () => {
    // The central requirement of the brief, stated as a test.
    const offers = buildSameFlightAcrossProviders({
      easemytrip: 5499,
      ixigo: 5299,
      cleartrip: 5199,
    });

    const groups = groupOffers(offers);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.offers).toHaveLength(3);
    expect(groups[0]!.providerCount).toBe(3);
    // Cheapest provider first, derived from the price-sorted offers.
    expect(groups[0]!.providerIds).toEqual(['cleartrip', 'ixigo', 'easemytrip']);
  });

  it('keeps genuinely different flights apart', () => {
    const groups = groupOffers([
      buildOffer({ itinerary: buildItinerary() }),
      buildOffer({
        itinerary: buildItinerary({ segments: [buildSegment({ flightNumber: '5217' })] }),
      }),
    ]);

    expect(groups).toHaveLength(2);
  });

  it('orders offers within a group cheapest first', () => {
    const groups = groupOffers(
      buildSameFlightAcrossProviders({ easemytrip: 5499, ixigo: 5299, cleartrip: 5199 }),
    );

    const prices = groups[0]!.offers.map((offer) => rupees(offer.price.total.amountMinor));

    expect(prices).toEqual([5199, 5299, 5499]);
  });

  it('points cheapestOfferId at the lowest-priced offer', () => {
    const groups = groupOffers(buildSameFlightAcrossProviders({ easemytrip: 5499, cleartrip: 5199 }));
    const group = groups[0]!;

    const cheapest = group.offers.find((offer) => offer.id === group.cheapestOfferId)!;

    expect(cheapest.providerId).toBe('cleartrip');
    expect(rupees(cheapest.price.total.amountMinor)).toBe(5199);
  });

  it('reports the price spread across providers', () => {
    const groups = groupOffers(
      buildSameFlightAcrossProviders({ easemytrip: 5499, ixigo: 5299, cleartrip: 5199 }),
    );
    const { priceSpread } = groups[0]!;

    expect(rupees(priceSpread.min.amountMinor)).toBe(5199);
    expect(rupees(priceSpread.max.amountMinor)).toBe(5499);
    expect(rupees(priceSpread.delta.amountMinor)).toBe(300);
    expect(priceSpread.percentage).toBeCloseTo(5.8, 1);
  });

  it('reports a zero spread when only one provider sells the flight', () => {
    const groups = groupOffers([buildOffer({ providerId: 'cleartrip', priceInr: 5199 })]);
    const { priceSpread } = groups[0]!;

    expect(priceSpread.delta.amountMinor).toBe(0);
    expect(priceSpread.percentage).toBe(0);
  });

  /**
   * Guards a specific wrong answer.
   *
   * A group can hold several fare families from one provider. Measuring the spread across
   * every offer would report ₹2,300 here, implying a provider choice worth ₹2,300, when
   * both cheap fares come from the same seller. The spread must compare each provider's
   * best price.
   */
  it('measures spread per provider, not across fare families', () => {
    const itinerary = buildItinerary();
    const groups = groupOffers([
      buildOffer({ providerId: 'cleartrip', itinerary, fareFamily: 'SAVER', priceInr: 5199 }),
      buildOffer({ providerId: 'cleartrip', itinerary, fareFamily: 'FLEXI', priceInr: 7499 }),
      buildOffer({ providerId: 'easemytrip', itinerary, fareFamily: 'SAVER', priceInr: 5399 }),
    ]);
    const group = groups[0]!;

    expect(group.offers).toHaveLength(3);
    expect(group.providerCount).toBe(2);
    // Cleartrip's best (5199) vs EaseMyTrip's best (5399), not 5199 vs 7499.
    expect(rupees(group.priceSpread.delta.amountMinor)).toBe(200);
  });

  it('counts a provider once even when it sells several fares', () => {
    const itinerary = buildItinerary();
    const groups = groupOffers([
      buildOffer({ providerId: 'cleartrip', itinerary, fareFamily: 'SAVER' }),
      buildOffer({ providerId: 'cleartrip', itinerary, fareFamily: 'FLEXI' }),
    ]);

    expect(groups[0]!.providerCount).toBe(1);
    expect(groups[0]!.providerIds).toEqual(['cleartrip']);
  });

  it('groups a red-eye consistently despite its UTC date differing', () => {
    // End-to-end proof of the local-date rule, through the grouping layer.
    const redEye = buildItinerary({
      segments: [
        buildSegment({
          departure: istTime('2026-08-20T00:45'),
          arrival: istTime('2026-08-20T02:55'),
        }),
      ],
    });

    const groups = groupOffers([
      buildOffer({ providerId: 'easemytrip', itinerary: redEye }),
      buildOffer({ providerId: 'ixigo', itinerary: redEye }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.canonicalKey).toBe('6E-2134-2026-08-20-DEL-BOM');
  });

  it('preserves first-appearance order so results are deterministic', () => {
    const groups = groupOffers([
      buildOffer({
        itinerary: buildItinerary({ segments: [buildSegment({ flightNumber: '900' })] }),
      }),
      buildOffer({
        itinerary: buildItinerary({ segments: [buildSegment({ flightNumber: '100' })] }),
      }),
    ]);

    expect(groups.map((group) => group.canonicalKey)).toEqual([
      '6E-900-2026-08-20-DEL-BOM',
      '6E-100-2026-08-20-DEL-BOM',
    ]);
  });
});

describe('countMultiProviderGroups', () => {
  it('counts only flights sold by more than one provider', () => {
    const shared = buildItinerary();
    const soloItinerary = buildItinerary({
      segments: [buildSegment({ flightNumber: '5217' })],
    });

    const groups = groupOffers([
      buildOffer({ providerId: 'easemytrip', itinerary: shared }),
      buildOffer({ providerId: 'ixigo', itinerary: shared }),
      buildOffer({ providerId: 'cleartrip', itinerary: soloItinerary }),
    ]);

    expect(groups).toHaveLength(2);
    expect(countMultiProviderGroups(groups)).toBe(1);
  });
});
