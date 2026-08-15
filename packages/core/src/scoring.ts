import type { ComparisonGroup, Money, ScoreBreakdown } from '@polaris/contracts';
import type { UnscoredComparisonGroup } from './grouping';
import { sum } from './money';

/**
 * Default weighting for the overall value score.
 *
 * Price dominates because it is what users actually optimise for, but not so heavily that
 * a ₹200 saving beats a two-hour detour. These are a judgement call, deliberately exposed
 * as a parameter and echoed in the API response so the ranking can be explained and
 * reproduced rather than taken on faith.
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreBreakdown = {
  price: 0.45,
  duration: 0.25,
  stops: 0.2,
  benefits: 0.1,
};

/**
 * Applies value scores to grouped flights.
 *
 * The brief asks users to compare on "overall value", which is inherently a judgement.
 * Rather than hide that behind one opaque number, every sub-score and the weights that
 * produced it are attached to each group, so the UI can answer *"why is this ranked
 * first?"*.
 *
 * ### Relative vs absolute sub-scores
 * `price`, `duration` and `benefits` are min-max normalised **within this result set**, a
 * score is a statement about this search, not an absolute rating. `stops` is absolute
 * (`1 / (1 + stops)`), because a non-stop is objectively a non-stop regardless of what
 * else happens to be in the results; normalising it would make the only non-stop in a set
 * of two-stop options score identically to the only one-stop in a set of non-stops.
 *
 * ### When a dimension does not vary
 * If every group shares a value (all the same price, say), that dimension scores `1` for
 * everyone. Nobody is worse on it, so it correctly stops differentiating.
 *
 * @param groups - Grouped flights from {@link groupOffers}. May be empty.
 * @param weights - Optional weighting. Need not sum to 1; it is normalised internally.
 * @returns The same groups, each with a `score`. Input order is preserved, ranking is
 *   the sorter's job.
 *
 * @example
 * ```ts
 * const scored = scoreGroups(groups);
 * scored[0].score.total;             // 0.87
 * scored[0].score.breakdown.price;   // 1, cheapest in this result set
 * scored[0].score.weights.price;     // 0.45, echoed so the UI can explain the total
 * ```
 */
export function scoreGroups(
  groups: readonly UnscoredComparisonGroup[],
  weights: ScoreBreakdown = DEFAULT_SCORE_WEIGHTS,
): ComparisonGroup[] {
  const normalisedWeights = normaliseWeights(weights);

  const prices = groups.map((group) => group.priceSpread.min.amountMinor);
  const durations = groups.map((group) => group.itinerary.totalDurationMinutes);
  const benefits = groups.map(benefitValueOf);

  return groups.map((group, index) => {
    const breakdown: ScoreBreakdown = {
      // Lower is better, so the scale is inverted.
      price: invertedNormalise(prices[index]!, prices),
      duration: invertedNormalise(durations[index]!, durations),
      stops: 1 / (1 + group.itinerary.stops),
      // Higher is better, no inversion.
      benefits: normalise(benefits[index]!, benefits),
    };

    return {
      ...group,
      score: {
        total: weightedTotal(breakdown, normalisedWeights),
        breakdown,
        weights: normalisedWeights,
      },
    };
  });
}

/**
 * Total monetary value of the quantifiable benefits on a group's cheapest offer.
 *
 * The cheapest offer is used because it is the one the group leads with and the one a user
 * would most likely book. Benefits without a monetary value (a lounge pass, say) are real
 * but not comparable across providers, so they are shown in the UI and excluded here
 * rather than assigned an invented number.
 *
 * Conditional benefits, those needing a specific card or coupon, are excluded too. A
 * "₹500 off with HDFC cards" offer is not a saving for most users, and counting it would
 * systematically over-rank whichever provider advertises the most card promotions.
 *
 * @param group - The group to value.
 * @returns Total benefit value in minor units. Zero when nothing is quantifiable.
 * @internal
 */
function benefitValueOf(group: UnscoredComparisonGroup): number {
  // The offer the group actually leads with, which is the cheapest *current* one. Reading
  // offers[0] would score a replayed offer's perks onto a group priced on a live fare.
  const cheapest =
    group.offers.find((offer) => offer.id === group.cheapestOfferId) ?? group.offers[0]!;
  const quantified: Money[] = cheapest.benefits
    .filter((benefit) => !benefit.conditional && benefit.value !== undefined)
    .map((benefit) => benefit.value!);

  return quantified.length > 0 ? sum(quantified).amountMinor : 0;
}

/**
 * Min-max normalises a value where higher is better.
 *
 * @param value - The value to score.
 * @param all - Every value in the result set, including `value`.
 * @returns `0..1`, or `1` for every entry when the values do not vary.
 * @internal
 */
function normalise(value: number, all: readonly number[]): number {
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (min === max) return 1;
  return (value - min) / (max - min);
}

/**
 * Min-max normalises a value where lower is better, such as price or duration.
 *
 * @param value - The value to score.
 * @param all - Every value in the result set, including `value`.
 * @returns `0..1` with the lowest input scoring `1`, or `1` for every entry when the
 *   values do not vary.
 * @internal
 */
function invertedNormalise(value: number, all: readonly number[]): number {
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (min === max) return 1;
  return (max - value) / (max - min);
}

/**
 * Scales weights so they sum to 1.
 *
 * Callers may pass any positive weighting, `{ price: 3, duration: 1, ... }` is as valid
 * as fractions, and the resulting total stays within `0..1` as the contract requires.
 *
 * Weights that already sum to 1 are returned untouched. Dividing them anyway would
 * introduce floating-point drift (0.45 becomes 0.45000000000000007), and since the applied
 * weights are echoed to the client, the response would no longer match what the caller
 * passed in.
 *
 * @param weights - Raw weights. Negative values are clamped to zero.
 * @returns Weights summing to 1, falling back to {@link DEFAULT_SCORE_WEIGHTS} when the
 *   input sums to zero.
 * @internal
 */
function normaliseWeights(weights: ScoreBreakdown): ScoreBreakdown {
  const safe: ScoreBreakdown = {
    price: Math.max(0, weights.price),
    duration: Math.max(0, weights.duration),
    stops: Math.max(0, weights.stops),
    benefits: Math.max(0, weights.benefits),
  };

  const total = safe.price + safe.duration + safe.stops + safe.benefits;
  if (total === 0) return DEFAULT_SCORE_WEIGHTS;
  if (Math.abs(total - 1) < Number.EPSILON * 8) return safe;

  return {
    price: safe.price / total,
    duration: safe.duration / total,
    stops: safe.stops / total,
    benefits: safe.benefits / total,
  };
}

/**
 * Combines sub-scores into a single 0..1 total.
 *
 * @param breakdown - Per-dimension sub-scores.
 * @param weights - Weights summing to 1.
 * @returns The weighted total, clamped to `0..1` against floating-point drift.
 * @internal
 */
function weightedTotal(breakdown: ScoreBreakdown, weights: ScoreBreakdown): number {
  const total =
    breakdown.price * weights.price +
    breakdown.duration * weights.duration +
    breakdown.stops * weights.stops +
    breakdown.benefits * weights.benefits;

  return Math.min(1, Math.max(0, total));
}
