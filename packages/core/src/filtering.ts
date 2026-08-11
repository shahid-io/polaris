import type {
  ComparisonGroup,
  FlightFilters,
  IataAirlineCode,
  ProviderId,
  TimeRange,
} from '@polaris/contracts';

export type { FlightFilters };

/**
 * Applies filters to grouped flights.
 *
 * Filtering happens **after** grouping and scoring, not before, for two reasons. Scores are
 * normalised across the result set, so filtering first would silently rescale every score
 * as the user toggles a checkbox, a flight's "value" would change simply because another
 * flight was hidden. Second, a provider filter must be able to inspect every offer in a
 * group, which only exists post-grouping.
 *
 * @param groups - Scored groups.
 * @param filters - Constraints to apply. An empty object returns everything.
 * @returns Groups matching every constraint, in their original order.
 *
 * @example
 * ```ts
 * filterGroups(groups, { maxStops: 0, maxPriceMinor: 600_000 });
 * // non-stop flights at or under ₹6,000
 * ```
 */
export function filterGroups(
  groups: readonly ComparisonGroup[],
  filters: FlightFilters = {},
): ComparisonGroup[] {
  return groups.filter((group) => matchesAll(group, filters));
}

/**
 * Tests one group against every filter.
 *
 * @param group - The group under test.
 * @param filters - Constraints to apply.
 * @returns `true` when the group satisfies all of them.
 * @internal
 */
function matchesAll(group: ComparisonGroup, filters: FlightFilters): boolean {
  const { itinerary } = group;

  if (filters.maxStops !== undefined && itinerary.stops > filters.maxStops) {
    return false;
  }

  if (
    filters.maxDurationMinutes !== undefined &&
    itinerary.totalDurationMinutes > filters.maxDurationMinutes
  ) {
    return false;
  }

  if (
    filters.maxPriceMinor !== undefined &&
    group.priceSpread.min.amountMinor > filters.maxPriceMinor
  ) {
    return false;
  }

  if (filters.departureWindow && !departsWithin(group, filters.departureWindow)) {
    return false;
  }

  if (filters.airlines?.length && !operatedByAny(group, filters.airlines)) {
    return false;
  }

  if (filters.providers?.length && !soldByAny(group, filters.providers)) {
    return false;
  }

  if (filters.refundableOnly && !group.offers.some((offer) => offer.refundable === true)) {
    return false;
  }

  return true;
}

/**
 * Tests whether a flight departs inside a time window.
 *
 * Compares the origin's local wall-clock time, matching how a user thinks about "a morning
 * flight": 06:00 at the departure gate, not 06:00 UTC. The window is inclusive at both
 * ends so a preset ending at 12:00 still matches a noon departure.
 *
 * @param group - The group under test.
 * @param window - Local time window.
 * @returns `true` when the first segment departs within the window.
 * @internal
 */
function departsWithin(group: ComparisonGroup, window: TimeRange): boolean {
  const firstSegment = group.itinerary.segments[0]!;
  // "2026-08-20T06:15:00" → "06:15", comparable as a string in 24-hour form.
  const departureTime = firstSegment.departure.local.slice(11, 16);

  return departureTime >= window.from && departureTime <= window.to;
}

/**
 * Tests whether any leg is marketed by one of the given carriers.
 *
 * Any leg rather than all: on a connecting itinerary a user filtering for IndiGo still
 * wants the journey where IndiGo flies one leg, rather than an empty result set.
 *
 * @param group - The group under test.
 * @param airlines - Acceptable marketing carriers.
 * @returns `true` when at least one segment matches.
 * @internal
 */
function operatedByAny(group: ComparisonGroup, airlines: readonly IataAirlineCode[]): boolean {
  return group.itinerary.segments.some((segment) => airlines.includes(segment.marketingCarrier));
}

/**
 * Tests whether any of the given providers sells this flight.
 *
 * @param group - The group under test.
 * @param providers - Acceptable providers.
 * @returns `true` when at least one offer comes from one of them.
 * @internal
 */
function soldByAny(group: ComparisonGroup, providers: readonly ProviderId[]): boolean {
  return group.providerIds.some((providerId) => providers.includes(providerId));
}

/**
 * Collects the filter options actually present in a result set.
 *
 * Lets the UI build filter controls from what exists rather than a hardcoded list, so a
 * user is never offered an airline that would return nothing.
 *
 * @param groups - Scored groups, unfiltered.
 * @returns Airlines, providers, price bounds and duration bounds present in the set.
 */
export function availableFilterOptions(groups: readonly ComparisonGroup[]): {
  airlines: IataAirlineCode[];
  providers: ProviderId[];
  minPriceMinor: number;
  maxPriceMinor: number;
  maxStops: number;
  maxDurationMinutes: number;
} {
  const airlines = new Set<IataAirlineCode>();
  const providers = new Set<ProviderId>();
  let minPriceMinor = Number.POSITIVE_INFINITY;
  let maxPriceMinor = 0;
  let maxStops = 0;
  let maxDurationMinutes = 0;

  for (const group of groups) {
    for (const segment of group.itinerary.segments) airlines.add(segment.marketingCarrier);
    for (const providerId of group.providerIds) providers.add(providerId);

    minPriceMinor = Math.min(minPriceMinor, group.priceSpread.min.amountMinor);
    maxPriceMinor = Math.max(maxPriceMinor, group.priceSpread.max.amountMinor);
    maxStops = Math.max(maxStops, group.itinerary.stops);
    maxDurationMinutes = Math.max(maxDurationMinutes, group.itinerary.totalDurationMinutes);
  }

  return {
    airlines: [...airlines].sort(),
    providers: [...providers],
    minPriceMinor: Number.isFinite(minPriceMinor) ? minPriceMinor : 0,
    maxPriceMinor,
    maxStops,
    maxDurationMinutes,
  };
}
