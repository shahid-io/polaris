'use client';

import { useMemo, useState } from 'react';
import { PlaneTakeoffIcon, SearchXIcon } from 'lucide-react';
import type { ComparisonGroup, FlightFilters, SortKey } from '@polaris/contracts';
import { filterGroups, sortGroups } from '@polaris/core';

import { SearchForm } from '@/components/search/SearchForm';
import { FlightGroupCard } from '@/components/results/FlightGroupCard';
import { ProviderStatusBanner } from '@/components/results/ProviderStatusBanner';
import { ResultControls, type FilterState } from '@/components/results/ResultControls';
import { ResultsHeader } from '@/components/results/ResultsHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useAirports } from '@/hooks/useAirports';
import { useFlightSearch } from '@/hooks/useFlightSearch';

const NO_FILTERS: FilterState = {
  nonStopOnly: false,
  refundableOnly: false,
  airlines: [],
  providers: [],
};

/**
 * The search page.
 *
 * Filtering and sorting run here rather than on the server. The API returns the complete
 * result set, so narrowing it is instant and costs neither a provider fan-out nor a
 * metered SerpApi credit per checkbox.
 */
export default function HomePage() {
  const { airports, isLoading: airportsLoading, error: airportsError } = useAirports();
  const { response, isSearching, error, hasSearched, search } = useFlightSearch();

  const [sort, setSort] = useState<SortKey>('value');
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS);

  const groups = useMemo(() => response?.groups ?? [], [response]);
  // Built from the unfiltered result, so no option ever yields zero.
  const available = useMemo(() => buildFilterOptions(groups), [groups]);
  // Filtering and sorting come from @polaris/core, the same functions the API runs.
  // Reimplementing them here would give the UI and the API two definitions of "cheapest
  // first", which agree today and drift the first time either gains a tie-breaker.
  const visible = useMemo(
    () => sortGroups(filterGroups(groups, toCoreFilters(filters)), sort),
    [groups, filters, sort],
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Compare the same flight across every provider
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
          One row per flight, with every seller&apos;s price beside it. Not one row per offer.
        </p>
      </div>

      {airportsError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          {airportsError}
        </p>
      ) : airportsLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <SearchForm
          airports={airports}
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
              <div className="lg:sticky lg:top-[4.5rem] lg:w-64 lg:shrink-0 lg:self-start">
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
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
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
  // Counts rather than a bare list: knowing a filter leaves two results is the difference
  // between narrowing deliberately and clicking into an empty state.
  const airlines = new Map<string, number>();
  const providers = new Map<string, { label: string; count: number }>();
  let minPriceMinor = Number.POSITIVE_INFINITY;
  let maxPriceMinor = 0;
  let hasConnections = false;
  let hasRefundable = false;

  for (const group of groups) {
    if (group.offers.some((offer) => offer.refundable === true)) hasRefundable = true;

    for (const carrier of new Set(group.itinerary.segments.map((s) => s.marketingCarrier))) {
      airlines.set(carrier, (airlines.get(carrier) ?? 0) + 1);
    }
    // Counted per flight, not per offer: a provider selling two fare families on one
    // flight still only offers that one flight, and the filter selects flights.
    for (const providerId of group.providerIds) {
      const label =
        group.offers.find((offer) => offer.providerId === providerId)?.providerDisplayName ??
        providerId;
      providers.set(providerId, {
        label,
        count: (providers.get(providerId)?.count ?? 0) + 1,
      });
    }

    minPriceMinor = Math.min(minPriceMinor, group.priceSpread.min.amountMinor);
    maxPriceMinor = Math.max(maxPriceMinor, group.priceSpread.min.amountMinor);
    if (group.itinerary.stops > 0) hasConnections = true;
  }

  return {
    airlines: [...airlines]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    providers: [...providers].map(([id, { label, count }]) => ({ id, label, count })),
    minPriceMinor: Number.isFinite(minPriceMinor) ? minPriceMinor : 0,
    maxPriceMinor,
    hasConnections,
    hasRefundable,
  };
}

/**
 * Maps the UI's filter state onto the domain filter contract.
 *
 * The UI models "non-stop only" as a checkbox; the domain models it as `maxStops`. Keeping
 * that translation in one place lets the view state stay shaped for the controls while the
 * filtering itself remains the shared implementation.
 *
 * @param filters - UI filter state.
 * @returns Domain filters.
 */
function toCoreFilters(filters: FilterState): FlightFilters {
  return {
    ...(filters.nonStopOnly ? { maxStops: 0 } : {}),
    ...(filters.refundableOnly ? { refundableOnly: true } : {}),
    ...(filters.airlines.length > 0 ? { airlines: filters.airlines } : {}),
    ...(filters.providers.length > 0
      ? { providers: filters.providers as FlightFilters['providers'] }
      : {}),
    ...(filters.maxPriceMinor !== undefined ? { maxPriceMinor: filters.maxPriceMinor } : {}),
  };
}
