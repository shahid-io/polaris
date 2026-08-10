import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORE_WEIGHTS, scoreGroups } from './scoring';
import { groupOffers } from './grouping';
import { buildBenefit, buildItinerary, buildOffer, buildSegment } from './testing/builders';

/** Builds one group per price, each a distinct flight. */
function groupsForPrices(...pricesInr: number[]) {
  return groupOffers(
    pricesInr.map((priceInr, index) =>
      buildOffer({
        priceInr,
        itinerary: buildItinerary({
          segments: [buildSegment({ flightNumber: `${100 + index}` })],
        }),
      }),
    ),
  );
}

describe('scoreGroups', () => {
  it('returns nothing for no groups', () => {
    expect(scoreGroups([])).toEqual([]);
  });

  it('scores the cheapest flight 1 on price and the dearest 0', () => {
    const scored = scoreGroups(groupsForPrices(5000, 7000, 9000));

    expect(scored[0]!.score.breakdown.price).toBe(1);
    expect(scored[2]!.score.breakdown.price).toBe(0);
  });

  it('places a mid-priced flight proportionally between them', () => {
    const scored = scoreGroups(groupsForPrices(5000, 7000, 9000));

    expect(scored[1]!.score.breakdown.price).toBeCloseTo(0.5, 5);
  });

  it('scores every flight 1 on a dimension that does not vary', () => {
    // Nobody is worse on price, so price correctly stops differentiating.
    const scored = scoreGroups(groupsForPrices(5000, 5000));

    expect(scored.map((group) => group.score.breakdown.price)).toEqual([1, 1]);
  });

  it('gives a single result a perfect score on every relative dimension', () => {
    const scored = scoreGroups(groupsForPrices(5000));

    expect(scored[0]!.score.breakdown.price).toBe(1);
    expect(scored[0]!.score.breakdown.duration).toBe(1);
  });

  it('scores a shorter flight higher on duration', () => {
    const scored = scoreGroups(
      groupOffers([
        buildOffer({
          itinerary: buildItinerary({
            segments: [buildSegment({ flightNumber: '100', durationMinutes: 125 })],
          }),
        }),
        buildOffer({
          itinerary: buildItinerary({
            segments: [buildSegment({ flightNumber: '200', durationMinutes: 240 })],
          }),
        }),
      ]),
    );

    expect(scored[0]!.score.breakdown.duration).toBe(1);
    expect(scored[1]!.score.breakdown.duration).toBe(0);
  });

  /**
   * Stops is absolute, not min-max normalised.
   *
   * If it were relative, the only non-stop in a set of two-stop options would score
   * identically to the only one-stop in a set of non-stops — which is plainly wrong.
   */
  it('scores stops on an absolute scale, independent of the result set', () => {
    const nonStopOnly = scoreGroups(groupsForPrices(5000));
    expect(nonStopOnly[0]!.score.breakdown.stops).toBe(1);

    const withConnection = scoreGroups(
      groupOffers([
        buildOffer({
          itinerary: buildItinerary({
            segments: [
              buildSegment({ origin: 'DEL', destination: 'HYD' }),
              buildSegment({ flightNumber: '901', origin: 'HYD', destination: 'BOM' }),
            ],
          }),
        }),
      ]),
    );
    expect(withConnection[0]!.score.breakdown.stops).toBeCloseTo(0.5, 5);
  });

  it('rewards quantified benefits', () => {
    const scored = scoreGroups(
      groupOffers([
        buildOffer({
          itinerary: buildItinerary({ segments: [buildSegment({ flightNumber: '100' })] }),
          benefits: [buildBenefit({ value: { amountMinor: 50_000, currency: 'INR' } })],
        }),
        buildOffer({
          itinerary: buildItinerary({ segments: [buildSegment({ flightNumber: '200' })] }),
          benefits: [],
        }),
      ]),
    );

    expect(scored[0]!.score.breakdown.benefits).toBe(1);
    expect(scored[1]!.score.breakdown.benefits).toBe(0);
  });

  /**
   * Guards a systematic bias.
   *
   * "₹500 off with HDFC cards" is not a saving for most users. Counting conditional
   * benefits would over-rank whichever provider advertises the most card promotions.
   */
  it('ignores benefits that require a specific card or coupon', () => {
    const scored = scoreGroups(
      groupOffers([
        buildOffer({
          itinerary: buildItinerary({ segments: [buildSegment({ flightNumber: '100' })] }),
          benefits: [
            buildBenefit({
              label: '₹500 off with HDFC cards',
              conditional: true,
              value: { amountMinor: 50_000, currency: 'INR' },
            }),
          ],
        }),
        buildOffer({
          itinerary: buildItinerary({ segments: [buildSegment({ flightNumber: '200' })] }),
          benefits: [],
        }),
      ]),
    );

    // Both effectively have zero usable benefit value, so neither is advantaged.
    expect(scored[0]!.score.breakdown.benefits).toBe(1);
    expect(scored[1]!.score.breakdown.benefits).toBe(1);
  });

  it('ignores benefits with no monetary value rather than inventing one', () => {
    const scored = scoreGroups(
      groupOffers([
        buildOffer({
          itinerary: buildItinerary({ segments: [buildSegment({ flightNumber: '100' })] }),
          benefits: [buildBenefit({ type: 'lounge_access', label: 'Lounge access', value: undefined })],
        }),
        buildOffer({
          itinerary: buildItinerary({ segments: [buildSegment({ flightNumber: '200' })] }),
          benefits: [],
        }),
      ]),
    );

    expect(scored[0]!.score.breakdown.benefits).toBe(1);
    expect(scored[1]!.score.breakdown.benefits).toBe(1);
  });

  it('keeps the total within 0..1', () => {
    for (const group of scoreGroups(groupsForPrices(5000, 7000, 12000))) {
      expect(group.score.total).toBeGreaterThanOrEqual(0);
      expect(group.score.total).toBeLessThanOrEqual(1);
    }
  });

  it('ranks the cheapest non-stop above a dearer one, all else equal', () => {
    const [cheap, dear] = scoreGroups(groupsForPrices(5000, 9000));

    expect(cheap!.score.total).toBeGreaterThan(dear!.score.total);
  });

  it('echoes the weights it applied so the UI can explain the total', () => {
    const scored = scoreGroups(groupsForPrices(5000, 9000));

    expect(scored[0]!.score.weights).toEqual(DEFAULT_SCORE_WEIGHTS);
  });

  it('accepts arbitrary positive weights and normalises them to sum to 1', () => {
    const scored = scoreGroups(groupsForPrices(5000, 9000), {
      price: 3,
      duration: 1,
      stops: 0,
      benefits: 0,
    });
    const { weights } = scored[0]!.score;

    expect(weights.price).toBeCloseTo(0.75, 5);
    expect(weights.duration).toBeCloseTo(0.25, 5);
    expect(weights.price + weights.duration + weights.stops + weights.benefits).toBeCloseTo(1, 5);
  });

  it('falls back to the defaults when every weight is zero', () => {
    const scored = scoreGroups(groupsForPrices(5000), {
      price: 0,
      duration: 0,
      stops: 0,
      benefits: 0,
    });

    expect(scored[0]!.score.weights).toEqual(DEFAULT_SCORE_WEIGHTS);
  });

  it('preserves input order, leaving ranking to the sorter', () => {
    const scored = scoreGroups(groupsForPrices(9000, 5000));

    expect(scored[0]!.priceSpread.min.amountMinor).toBe(900_000);
  });
});
