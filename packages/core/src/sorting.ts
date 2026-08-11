import type { ComparisonGroup, SortDirection, SortKey } from '@polaris/contracts';

/**
 * Orders grouped flights by the user's chosen criterion.
 *
 * Sorting is stable and non-mutating: a new array is returned and equal elements keep their
 * relative order, so toggling between sorts never reshuffles ties arbitrarily.
 *
 * Each key compares the value a user would actually see on the card: `price` uses the
 * group's cheapest offer, since that is the headline figure, not an average across
 * providers.
 *
 * @param groups - Scored groups.
 * @param key - Criterion to sort by. Defaults to `value`.
 * @param direction - Sort direction. Defaults to the natural one for the key, descending
 *   for `value` (best first), ascending for everything else (cheapest, shortest, earliest).
 * @returns A new sorted array. The input is not modified.
 *
 * @example
 * ```ts
 * sortGroups(groups);                   // best overall value first
 * sortGroups(groups, 'price');           // cheapest first
 * sortGroups(groups, 'departure', 'desc'); // latest departure first
 * ```
 */
export function sortGroups(
  groups: readonly ComparisonGroup[],
  key: SortKey = 'value',
  direction: SortDirection = defaultDirectionFor(key),
): ComparisonGroup[] {
  const multiplier = direction === 'asc' ? 1 : -1;

  return [...groups].sort((a, b) => multiplier * compareBy(key, a, b));
}

/**
 * The direction users expect for each criterion.
 *
 * Value is the odd one out: a higher score is better, whereas lower is better for price,
 * duration and time. Encoding that here means the UI does not have to special-case it.
 *
 * @param key - Sort criterion.
 * @returns `desc` for `value`, `asc` otherwise.
 */
export function defaultDirectionFor(key: SortKey): SortDirection {
  return key === 'value' ? 'desc' : 'asc';
}

/**
 * Compares two groups on one criterion, ascending.
 *
 * @param key - Sort criterion.
 * @param a - Left group.
 * @param b - Right group.
 * @returns Negative when `a` sorts first, positive when `b` does, zero when tied.
 * @internal
 */
function compareBy(key: SortKey, a: ComparisonGroup, b: ComparisonGroup): number {
  switch (key) {
    case 'value':
      return a.score.total - b.score.total;

    case 'price':
      // The cheapest offer, the figure shown on the card.
      return a.priceSpread.min.amountMinor - b.priceSpread.min.amountMinor;

    case 'duration':
      return a.itinerary.totalDurationMinutes - b.itinerary.totalDurationMinutes;

    case 'departure':
      return compareLocalTimes(departureOf(a), departureOf(b));

    case 'arrival':
      return compareLocalTimes(arrivalOf(a), arrivalOf(b));
  }
}

/**
 * Local departure time of a journey's first leg.
 *
 * @param group - The group to read.
 * @returns Local datetime string.
 * @internal
 */
function departureOf(group: ComparisonGroup): string {
  return group.itinerary.segments[0]!.departure.local;
}

/**
 * Local arrival time of a journey's final leg.
 *
 * @param group - The group to read.
 * @returns Local datetime string.
 * @internal
 */
function arrivalOf(group: ComparisonGroup): string {
  const segments = group.itinerary.segments;
  return segments[segments.length - 1]!.arrival.local;
}

/**
 * Compares two local datetime strings chronologically.
 *
 * ISO-8601 local strings sort lexicographically in chronological order, so string
 * comparison is exact here and avoids constructing Date objects, which would reinterpret
 * an offset-less string in the server's timezone and could reorder flights depending on
 * where the API runs.
 *
 * @param a - Left datetime, e.g. `2026-08-20T06:15:00`.
 * @param b - Right datetime.
 * @returns Negative, zero or positive per standard comparator contract.
 * @internal
 */
function compareLocalTimes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
