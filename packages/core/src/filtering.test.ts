import { describe, expect, it } from 'vitest';
import { availableFilterOptions, filterGroups } from './filtering';
import { groupOffers } from './grouping';
import { scoreGroups } from './scoring';
import { buildItinerary, buildOffer, buildSegment, istTime } from './testing/builders';
import type { ComparisonGroup } from '@polaris/contracts';

const nonStop = (overrides: Parameters<typeof buildSegment>[0] = {}) =>
  buildItinerary({ segments: [buildSegment(overrides)] });

const connecting = () =>
  buildItinerary({
    segments: [
      buildSegment({ flightNumber: '300', origin: 'DEL', destination: 'HYD' }),
      buildSegment({ flightNumber: '901', origin: 'HYD', destination: 'BOM' }),
    ],
  });

/** Scores a set of offers so filters operate on the same shape the API produces. */
function scored(offers: Parameters<typeof groupOffers>[0]): ComparisonGroup[] {
  return scoreGroups(groupOffers(offers));
}

describe('filterGroups', () => {
  it('returns everything when no filters are given', () => {
    const groups = scored([buildOffer(), buildOffer({ itinerary: connecting() })]);

    expect(filterGroups(groups)).toHaveLength(2);
  });

  it('keeps only non-stop flights when maxStops is 0', () => {
    const groups = scored([
      buildOffer({ itinerary: nonStop() }),
      buildOffer({ itinerary: connecting() }),
    ]);

    const result = filterGroups(groups, { maxStops: 0 });

    expect(result).toHaveLength(1);
    expect(result[0]!.itinerary.stops).toBe(0);
  });

  it('filters on the cheapest offer, not the dearest', () => {
    // A flight is affordable if you can buy it for the price — even if one provider
    // charges more.
    const itinerary = nonStop();
    const groups = scored([
      buildOffer({ providerId: 'indigo', itinerary, priceInr: 4500 }),
      buildOffer({ providerId: 'makemytrip', itinerary, priceInr: 8000 }),
    ]);

    expect(filterGroups(groups, { maxPriceMinor: 500_000 })).toHaveLength(1);
  });

  it('excludes a flight priced above the ceiling', () => {
    const groups = scored([buildOffer({ priceInr: 9000 })]);

    expect(filterGroups(groups, { maxPriceMinor: 500_000 })).toHaveLength(0);
  });

  it('filters by departure window using local time at the origin', () => {
    const groups = scored([
      buildOffer({
        itinerary: nonStop({ flightNumber: '100', departure: istTime('2026-08-20T07:30') }),
      }),
      buildOffer({
        itinerary: nonStop({ flightNumber: '200', departure: istTime('2026-08-20T19:45') }),
      }),
    ]);

    const morning = filterGroups(groups, { departureWindow: { from: '06:00', to: '12:00' } });

    expect(morning).toHaveLength(1);
    expect(morning[0]!.itinerary.segments[0]!.departure.local).toContain('07:30');
  });

  it('includes a flight departing exactly on the window boundary', () => {
    const groups = scored([
      buildOffer({ itinerary: nonStop({ departure: istTime('2026-08-20T12:00') }) }),
    ]);

    expect(filterGroups(groups, { departureWindow: { from: '06:00', to: '12:00' } })).toHaveLength(
      1,
    );
  });

  it('filters a red-eye by its local time, not its UTC time', () => {
    // 00:45 IST is 19:15Z the previous evening. Filtering on UTC would wrongly place
    // this in an evening window.
    const groups = scored([
      buildOffer({ itinerary: nonStop({ departure: istTime('2026-08-20T00:45') }) }),
    ]);

    expect(
      filterGroups(groups, { departureWindow: { from: '00:00', to: '06:00' } }),
    ).toHaveLength(1);
    expect(
      filterGroups(groups, { departureWindow: { from: '18:00', to: '23:59' } }),
    ).toHaveLength(0);
  });

  it('filters by airline', () => {
    const groups = scored([
      buildOffer({ itinerary: nonStop({ flightNumber: '100', marketingCarrier: '6E' }) }),
      buildOffer({ itinerary: nonStop({ flightNumber: '200', marketingCarrier: 'IX' }) }),
    ]);

    const result = filterGroups(groups, { airlines: ['6E'] });

    expect(result).toHaveLength(1);
    expect(result[0]!.itinerary.segments[0]!.marketingCarrier).toBe('6E');
  });

  it('keeps a connecting journey when the filtered airline flies only one leg', () => {
    // A user filtering for IndiGo still wants the journey IndiGo partly operates,
    // rather than an empty result set.
    const groups = scored([
      buildOffer({
        itinerary: buildItinerary({
          segments: [
            buildSegment({ marketingCarrier: 'IX', origin: 'DEL', destination: 'HYD' }),
            buildSegment({
              marketingCarrier: '6E',
              flightNumber: '901',
              origin: 'HYD',
              destination: 'BOM',
            }),
          ],
        }),
      }),
    ]);

    expect(filterGroups(groups, { airlines: ['6E'] })).toHaveLength(1);
  });

  it('keeps a flight when any of the selected providers sells it', () => {
    const itinerary = nonStop();
    const groups = scored([
      buildOffer({ providerId: 'indigo', itinerary }),
      buildOffer({ providerId: 'makemytrip', itinerary }),
    ]);

    expect(filterGroups(groups, { providers: ['makemytrip'] })).toHaveLength(1);
    expect(filterGroups(groups, { providers: ['cleartrip'] })).toHaveLength(0);
  });

  it('combines filters with AND', () => {
    const groups = scored([
      buildOffer({ itinerary: nonStop({ flightNumber: '100' }), priceInr: 4500 }),
      buildOffer({ itinerary: nonStop({ flightNumber: '200' }), priceInr: 9000 }),
      buildOffer({ itinerary: connecting(), priceInr: 4000 }),
    ]);

    const result = filterGroups(groups, { maxStops: 0, maxPriceMinor: 500_000 });

    expect(result).toHaveLength(1);
    expect(result[0]!.itinerary.segments[0]!.flightNumber).toBe('100');
  });

  it('returns nothing when filters exclude everything', () => {
    const groups = scored([buildOffer({ priceInr: 9000 })]);

    expect(filterGroups(groups, { maxPriceMinor: 100 })).toEqual([]);
  });

  it('does not mutate the input', () => {
    const groups = scored([buildOffer(), buildOffer({ itinerary: connecting() })]);

    filterGroups(groups, { maxStops: 0 });

    expect(groups).toHaveLength(2);
  });
});

describe('availableFilterOptions', () => {
  it('reports only options present in the result set', () => {
    const itinerary = nonStop({ marketingCarrier: '6E', durationMinutes: 125 });
    const groups = scored([
      buildOffer({ providerId: 'indigo', itinerary, priceInr: 5199 }),
      buildOffer({ providerId: 'makemytrip', itinerary, priceInr: 5499 }),
      buildOffer({
        providerId: 'cleartrip',
        itinerary: nonStop({ flightNumber: '400', marketingCarrier: 'IX', durationMinutes: 140 }),
        priceInr: 6100,
      }),
    ]);

    const options = availableFilterOptions(groups);

    expect(options.airlines).toEqual(['6E', 'IX']);
    expect(options.providers).toEqual(expect.arrayContaining(['indigo', 'makemytrip', 'cleartrip']));
    expect(options.minPriceMinor).toBe(519_900);
    expect(options.maxPriceMinor).toBe(610_000);
    expect(options.maxStops).toBe(0);
    expect(options.maxDurationMinutes).toBe(140);
  });

  it('handles an empty result set without returning Infinity', () => {
    const options = availableFilterOptions([]);

    expect(options.minPriceMinor).toBe(0);
    expect(options.maxPriceMinor).toBe(0);
    expect(options.airlines).toEqual([]);
  });
});
