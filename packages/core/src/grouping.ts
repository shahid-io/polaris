import type {
  ComparisonGroup,
  NormalizedOffer,
  PriceSpread,
  ProviderId,
} from '@polaris/contracts';
import { canonicalKeyForOffer } from './canonical-key';
import { isLessThan, maxOf, minOf, percentageOf, subtract } from './money';

/**
 * A comparison group before scoring is applied.
 *
 * Scores depend on the whole result set (sub-scores are min-max normalised across it), so
 * they are added in a second pass. Splitting the two keeps each function a pure map over
 * its input rather than one function needing global context to do half its job.
 *
 * @see {@link groupOffers}
 */
export type UnscoredComparisonGroup = Omit<ComparisonGroup, 'score'>;

/**
 * Collapses many provider offers into one entry per marketed flight.
 *
 * This implements the brief's requirement to "handle the same flight available through
 * multiple providers". Forty offers from six providers typically become a dozen or so
 * groups: the user compares *flights*, and within each, who sells it cheapest.
 *
 * Groups are returned in first-appearance order so output is deterministic and tests are
 * stable. Final presentation order is the sorter's job, not this function's.
 *
 * @param offers - Normalised offers from every provider that responded. May be empty.
 * @returns One group per distinct flight, each with its offers cheapest-first.
 *
 * @example
 * ```ts
 * const groups = groupOffers([mmtOffer, goibiboOffer, indigoOffer]);
 * groups.length;               // 1 — all three sell 6E-2134
 * groups[0].providerCount;     // 3
 * groups[0].priceSpread.delta; // ₹300 between the cheapest and dearest provider
 * ```
 *
 * @see {@link canonicalKeyForOffer} for how flight identity is decided.
 */
export function groupOffers(offers: readonly NormalizedOffer[]): UnscoredComparisonGroup[] {
  const byKey = new Map<string, NormalizedOffer[]>();

  for (const offer of offers) {
    const key = canonicalKeyForOffer(offer);
    const existing = byKey.get(key);
    if (existing) {
      existing.push(offer);
    } else {
      byKey.set(key, [offer]);
    }
  }

  return [...byKey.entries()].map(([canonicalKey, offersForKey]) =>
    buildGroup(canonicalKey, offersForKey),
  );
}

/**
 * Assembles one group from the offers sharing a canonical key.
 *
 * @param canonicalKey - Identity shared by every offer in `offers`.
 * @param offers - Non-empty offers for a single flight.
 * @returns The assembled group, offers sorted cheapest-first.
 * @internal
 */
function buildGroup(canonicalKey: string, offers: NormalizedOffer[]): UnscoredComparisonGroup {
  // Cheapest first: the UI leads with the best price for this flight, and the ordering
  // makes offers[0] meaningful everywhere downstream.
  const sorted = [...offers].sort((a, b) =>
    isLessThan(a.price.total, b.price.total) ? -1 : isLessThan(b.price.total, a.price.total) ? 1 : 0,
  );

  const cheapest = sorted[0]!;
  // Derived from the sorted list, so providers are listed cheapest-first.
  const providerIds = [...new Set(sorted.map((offer) => offer.providerId))];

  return {
    canonicalKey,
    // Every offer in a group shares an itinerary by construction — the canonical key is
    // derived from it — so taking the cheapest offer's copy is safe.
    itinerary: cheapest.itinerary,
    offers: sorted,
    cheapestOfferId: cheapest.id,
    providerIds,
    providerCount: providerIds.length,
    priceSpread: computePriceSpread(sorted, providerIds),
  };
}

/**
 * Measures how much one flight's price varies across the providers selling it.
 *
 * Computed over the **cheapest offer per provider**, not over every offer. A group can
 * hold several fare families from one provider (IndiGo SAVER at ₹5,199 and FLEXI at
 * ₹7,499); spanning those would report a ₹2,300 "spread" that has nothing to do with
 * choosing a provider. Comparing each provider's best price answers the question the user
 * actually has: *where should I book this flight?*
 *
 * @param offers - Every offer in the group.
 * @param providerIds - Distinct providers present in `offers`.
 * @returns Min, max, absolute delta and percentage variation across providers.
 *   Delta and percentage are zero when only one provider sells the flight.
 * @internal
 */
function computePriceSpread(
  offers: readonly NormalizedOffer[],
  providerIds: readonly ProviderId[],
): PriceSpread {
  const bestPerProvider = providerIds.map((providerId) => {
    const forProvider = offers.filter((offer) => offer.providerId === providerId);
    return minOf(forProvider.map((offer) => offer.price.total));
  });

  const min = minOf(bestPerProvider);
  const max = maxOf(bestPerProvider);
  const delta = subtract(max, min);

  return { min, max, delta, percentage: percentageOf(delta, min) };
}

/**
 * Counts flights sold by more than one provider — the deduplication working, quantified.
 *
 * Surfaced in the search response meta, and worth showing in the demo: it is the number
 * that proves grouping did something.
 *
 * @param groups - Groups from {@link groupOffers}.
 * @returns How many groups have offers from two or more providers.
 */
export function countMultiProviderGroups(groups: readonly UnscoredComparisonGroup[]): number {
  return groups.filter((group) => group.providerCount > 1).length;
}
