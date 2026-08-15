import { describe, expect, it } from 'vitest';
import { defaultDirectionFor, sortGroups } from './sorting';
import { groupOffers } from './grouping';
import { scoreGroups } from './scoring';
import { buildItinerary, buildOffer, buildSegment, istTime } from './testing/builders';

const flight = (flightNumber: string, overrides: Parameters<typeof buildSegment>[0] = {}) =>
  buildItinerary({ segments: [buildSegment({ flightNumber, ...overrides })] });

const priceOf = (group: { priceSpread: { min: { amountMinor: number } } }) =>
  group.priceSpread.min.amountMinor / 100;

const flightNumbersOf = (
  groups: readonly { itinerary: { segments: { flightNumber: string }[] } }[],
) => groups.map((group) => group.itinerary.segments[0]!.flightNumber);

describe('sortGroups', () => {
  it('sorts by best overall value by default', () => {
    const groups = scoreGroups(
      groupOffers([
        buildOffer({ itinerary: flight('100'), priceInr: 9000 }),
        buildOffer({ itinerary: flight('200'), priceInr: 5000 }),
      ]),
    );

    const sorted = sortGroups(groups);

    expect(sorted[0]!.score.total).toBeGreaterThan(sorted[1]!.score.total);
    expect(flightNumbersOf(sorted)).toEqual(['200', '100']);
  });

  it('sorts cheapest first by price', () => {
    const groups = scoreGroups(
      groupOffers([
        buildOffer({ itinerary: flight('100'), priceInr: 9000 }),
        buildOffer({ itinerary: flight('200'), priceInr: 5000 }),
        buildOffer({ itinerary: flight('300'), priceInr: 7000 }),
      ]),
    );

    expect(sortGroups(groups, 'price').map(priceOf)).toEqual([5000, 7000, 9000]);
  });

  it('sorts by the cheapest offer in a group, not the dearest', () => {
    const cheapElsewhere = flight('100');
    const groups = scoreGroups(
      groupOffers([
        buildOffer({ providerId: 'easemytrip', itinerary: cheapElsewhere, priceInr: 9000 }),
        buildOffer({ providerId: 'cleartrip', itinerary: cheapElsewhere, priceInr: 4000 }),
        buildOffer({ itinerary: flight('200'), priceInr: 6000 }),
      ]),
    );

    expect(flightNumbersOf(sortGroups(groups, 'price'))).toEqual(['100', '200']);
  });

  it('sorts shortest first by duration', () => {
    const groups = scoreGroups(
      groupOffers([
        buildOffer({ itinerary: flight('100', { durationMinutes: 240 }) }),
        buildOffer({ itinerary: flight('200', { durationMinutes: 125 }) }),
      ]),
    );

    expect(flightNumbersOf(sortGroups(groups, 'duration'))).toEqual(['200', '100']);
  });

  it('sorts earliest first by departure', () => {
    const groups = scoreGroups(
      groupOffers([
        buildOffer({ itinerary: flight('100', { departure: istTime('2026-08-20T19:45') }) }),
        buildOffer({ itinerary: flight('200', { departure: istTime('2026-08-20T06:15') }) }),
      ]),
    );

    expect(flightNumbersOf(sortGroups(groups, 'departure'))).toEqual(['200', '100']);
  });

  it('sorts by arrival using the final leg', () => {
    const groups = scoreGroups(
      groupOffers([
        buildOffer({
          itinerary: buildItinerary({
            segments: [
              buildSegment({ flightNumber: '100', origin: 'DEL', destination: 'HYD' }),
              buildSegment({
                flightNumber: '901',
                origin: 'HYD',
                destination: 'BOM',
                departure: istTime('2026-08-20T14:00'),
                arrival: istTime('2026-08-20T23:30'),
              }),
            ],
          }),
        }),
        buildOffer({
          itinerary: flight('200', { arrival: istTime('2026-08-20T08:20') }),
        }),
      ]),
    );

    expect(flightNumbersOf(sortGroups(groups, 'arrival'))).toEqual(['200', '100']);
  });

  it('honours an explicit direction override', () => {
    const groups = scoreGroups(
      groupOffers([
        buildOffer({ itinerary: flight('100'), priceInr: 5000 }),
        buildOffer({ itinerary: flight('200'), priceInr: 9000 }),
      ]),
    );

    expect(sortGroups(groups, 'price', 'desc').map(priceOf)).toEqual([9000, 5000]);
  });

  it('is stable, preserving input order for ties', () => {
    const groups = scoreGroups(
      groupOffers([
        buildOffer({ itinerary: flight('100'), priceInr: 5000 }),
        buildOffer({ itinerary: flight('200'), priceInr: 5000 }),
        buildOffer({ itinerary: flight('300'), priceInr: 5000 }),
      ]),
    );

    expect(flightNumbersOf(sortGroups(groups, 'price'))).toEqual(['100', '200', '300']);
  });

  it('does not mutate the input array', () => {
    const groups = scoreGroups(
      groupOffers([
        buildOffer({ itinerary: flight('100'), priceInr: 9000 }),
        buildOffer({ itinerary: flight('200'), priceInr: 5000 }),
      ]),
    );
    const originalOrder = flightNumbersOf(groups);

    sortGroups(groups, 'price');

    expect(flightNumbersOf(groups)).toEqual(originalOrder);
  });

  it('handles an empty result set', () => {
    expect(sortGroups([])).toEqual([]);
  });
});

describe('defaultDirectionFor', () => {
  it('sorts value descending, since a higher score is better', () => {
    expect(defaultDirectionFor('value')).toBe('desc');
  });

  it('sorts every other criterion ascending', () => {
    expect(defaultDirectionFor('price')).toBe('asc');
    expect(defaultDirectionFor('duration')).toBe('asc');
    expect(defaultDirectionFor('departure')).toBe('asc');
    expect(defaultDirectionFor('arrival')).toBe('asc');
  });
});
