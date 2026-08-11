'use client';

import { useMemo, useState } from 'react';
import { PlaneTakeoffIcon, SearchXIcon } from 'lucide-react';
import type { ComparisonGroup, SortKey } from '@polaris/contracts';

import { SearchForm } from '@/components/search/SearchForm';
import { FlightGroupCard } from '@/components/results/FlightGroupCard';
import { ProviderStatusBanner } from '@/components/results/ProviderStatusBanner';
import { ResultControls, type FilterState } from '@/components/results/ResultControls';
import { ResultsHeader } from '@/components/results/ResultsHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useAirports } from '@/hooks/useAirports';
import { useFlightSearch } from '@/hooks/useFlightSearch';

const NO_FILTERS: FilterState = { nonStopOnly: false, airlines: [], providers: [] };

/**
 * The search page.
 *
 * Filtering and sorting run here rather than on the server. The API returns the complete
 * result set, so narrowing it is instant and costs neither a provider fan-out nor a
 * metered SerpApi credit per checkbox.
 */
export default function HomePage() {
  const { airports, routes, isLoading: airportsLoading, error: airportsError } = useAirports();
  const { response, isSearching, error, hasSearched, search } = useFlightSearch();

  const [sort, setSort] = useState<SortKey>('value');
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS);

  const groups = useMemo(() => response?.groups ?? [], [response]);
  // Built from the unfiltered result, so no option ever yields zero.
  const available = useMemo(() => buildFilterOptions(groups), [groups]);
  const visible = useMemo(
    () => sortGroups(applyFilters(groups, filters), sort),
    [groups, filters, sort],
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Polaris</h1>
        <p className="mt-1 text-muted-foreground">
          Compare the same flight across every provider that sells it.
        </p>
      </header>

      {airportsError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          {airportsError}
        </p>
      ) : airportsLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <SearchForm
          airports={airports}
          routes={routes}
          isSearching={isSearching}
          onSearch={(query) => {
            setFilters(NO_FILTERS);
            void search(query);
          }}
        />
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
        >
          {error}
        </p>
      )}

      {isSearching && <SearchingSkeleton />}

      {!isSearching && response && (
        <>
          <ProviderStatusBanner statuses={response.providerStatuses} meta={response.meta} />

          {response.groups.length === 0 ? (
            <EmptyState
              title="No flights found"
              description="No provider returned a flight for this route and date. Try a different date, or another route."
            />
          ) : (
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
              <div className="lg:w-64 lg:shrink-0">
                <ResultControls
                  sort={sort}
                  filters={filters}
                  available={available}
                  onSortChange={setSort}
                  onFiltersChange={setFilters}
                />
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <ResultsHeader meta={response.meta} shown={visible.length} />

                {visible.length === 0 ? (
                  <EmptyState
                    title="No flights match these filters"
                    description="Clear a filter to see more results."
                  />
                ) : (
                  visible.map((group, index) => (
                    <FlightGroupCard
                      key={group.canonicalKey}
                      group={group}
                      isTopResult={index === 0 && sort === 'value'}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}

      {!isSearching && !hasSearched && !error && (
        <EmptyState
          icon="search"
          title="Search to compare fares"
          description="Pick a route and date. Polaris queries every provider at once and groups the results, so you see one row per flight with each seller's price."
        />
      )}
    </div>
  );
}

/** Loading state shaped like the results it replaces. */
function SearchingSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Searching providers">
      <Skeleton className="h-5 w-64" />
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-40 w-full" />
      ))}
    </div>
  );
}

function EmptyState({
  title,
  description,
  icon = 'none',
}: {
  title: string;
  description: string;
  icon?: 'search' | 'none';
}) {
  const Icon = icon === 'search' ? PlaneTakeoffIcon : SearchXIcon;

  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center">
      <Icon className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

/**
 * Collects the filter options present in a result set.
 *
 * @param groups - Unfiltered groups.
 * @returns Airlines, providers and price bounds actually available.
 */
function buildFilterOptions(groups: readonly ComparisonGroup[]) {
  const airlines = new Set<string>();
  const providers = new Map<string, string>();
  let minPriceMinor = Number.POSITIVE_INFINITY;
  let maxPriceMinor = 0;
  let hasConnections = false;

  for (const group of groups) {
    for (const segment of group.itinerary.segments) airlines.add(segment.marketingCarrier);
    for (const offer of group.offers) providers.set(offer.providerId, offer.providerDisplayName);

    minPriceMinor = Math.min(minPriceMinor, group.priceSpread.min.amountMinor);
    maxPriceMinor = Math.max(maxPriceMinor, group.priceSpread.min.amountMinor);
    if (group.itinerary.stops > 0) hasConnections = true;
  }

  return {
    airlines: [...airlines].sort(),
    providers: [...providers].map(([id, label]) => ({ id, label })),
    minPriceMinor: Number.isFinite(minPriceMinor) ? minPriceMinor : 0,
    maxPriceMinor,
    hasConnections,
  };
}

/**
 * Applies filters client-side.
 *
 * @param groups - Unfiltered groups.
 * @param filters - Active constraints, combined with AND.
 * @returns Matching groups.
 */
function applyFilters(
  groups: readonly ComparisonGroup[],
  filters: FilterState,
): ComparisonGroup[] {
  return groups.filter((group) => {
    if (filters.nonStopOnly && group.itinerary.stops > 0) return false;

    if (
      filters.maxPriceMinor !== undefined &&
      group.priceSpread.min.amountMinor > filters.maxPriceMinor
    ) {
      return false;
    }

    if (
      filters.airlines.length > 0 &&
      !group.itinerary.segments.some((segment) =>
        filters.airlines.includes(segment.marketingCarrier),
      )
    ) {
      return false;
    }

    if (
      filters.providers.length > 0 &&
      !group.providerIds.some((providerId) => filters.providers.includes(providerId))
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Orders groups by the chosen criterion.
 *
 * Non-mutating, and value sorts descending because a higher score is better while every
 * other criterion is better when lower.
 *
 * @param groups - Filtered groups.
 * @param sort - Criterion.
 * @returns A new sorted array.
 */
function sortGroups(groups: readonly ComparisonGroup[], sort: SortKey): ComparisonGroup[] {
  const sorted = [...groups];

  switch (sort) {
    case 'value':
      return sorted.sort((a, b) => b.score.total - a.score.total);
    case 'price':
      return sorted.sort((a, b) => a.priceSpread.min.amountMinor - b.priceSpread.min.amountMinor);
    case 'duration':
      return sorted.sort(
        (a, b) => a.itinerary.totalDurationMinutes - b.itinerary.totalDurationMinutes,
      );
    case 'departure':
      return sorted.sort((a, b) =>
        a.itinerary.segments[0]!.departure.local.localeCompare(
          b.itinerary.segments[0]!.departure.local,
        ),
      );
    case 'arrival':
      return sorted.sort((a, b) => lastArrival(a).localeCompare(lastArrival(b)));
  }
}

/** @returns Local arrival time of a journey's final leg. */
function lastArrival(group: ComparisonGroup): string {
  return group.itinerary.segments[group.itinerary.segments.length - 1]!.arrival.local;
}
