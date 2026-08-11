import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  type NormalizedOffer,
  type ProviderCallStatus,
  type ProviderStatus,
  type SearchRequest,
  type SearchResponse,
} from '@polaris/contracts';
import {
  countMultiProviderGroups,
  filterGroups,
  groupOffers,
  scoreGroups,
  sortGroups,
} from '@polaris/core';
import {
  CircuitBreaker,
  ProviderCredentialsMissingError,
  ProviderError,
  ProviderTimeoutError,
  withTimeout,
  type FlightProvider,
} from '@polaris/providers';
import { FLIGHT_PROVIDERS } from '../providers/providers.module';
import { CACHE_STORE, buildCacheKey, type CacheStore } from '../cache/cache.store';
import type { Env } from '../config/env';

/**
 * Folds the query's preferred time range into the effective filters.
 *
 * `timeRange` is one of the four search criteria the brief names, and it was previously
 * accepted, validated and then ignored — a stated capability that silently did nothing.
 *
 * It is applied here, after grouping and scoring, rather than inside each adapter. Three
 * reasons:
 *
 * 1. **Quota.** Providers fetch a whole day for a route. One cached fetch then serves a
 *    morning search, an evening search and an unfiltered one. Pushing the window down to
 *    the adapters would make each window its own upstream call, and the live source allows
 *    250 a month.
 * 2. **Consistent scoring.** Scores are normalised across the full day's flights, so a
 *    flight's value does not change depending on which window the user asked for — the
 *    same principle that puts filtering after scoring.
 * 3. **One implementation.** SerpApi has no time-window parameter, so a post-filter would
 *    be needed regardless. Doing it once in the domain layer beats doing it per adapter.
 *
 * An explicit `filters.departureWindow` wins if the caller supplies one, since it is the
 * more specific instruction.
 *
 * @param filters - Filters from the request, if any.
 * @param query - The validated query, carrying the preferred time range.
 * @returns Filters with the query's window applied.
 * @internal
 */
function mergeTimeRange(
  filters: SearchRequest['filters'],
  query: SearchRequest['query'],
): SearchRequest['filters'] {
  if (!query.timeRange) return filters;
  if (filters?.departureWindow) return filters;

  return { ...filters, departureWindow: query.timeRange };
}

/** What one provider contributed to a search, before assembly into the response. */
interface ProviderOutcome {
  status: ProviderStatus;
  offers: NormalizedOffer[];
}

/** Cached shape — the unfiltered result, so filtering never re-queries providers. */
interface CachedSearch {
  offers: NormalizedOffer[];
  providerStatuses: ProviderStatus[];
}

/**
 * Runs a search across every registered provider and assembles the comparison.
 *
 * This is the only place that knows a search involves more than one provider. Adapters
 * know nothing about each other; the domain package knows nothing about I/O. The
 * orchestrator owns exactly three concerns adapters must not duplicate: the time budget,
 * failure isolation, and deciding when a provider has failed often enough to skip.
 */
@Injectable()
export class SearchOrchestrator {
  private readonly logger = new Logger(SearchOrchestrator.name);

  /**
   * One breaker per provider, held for the process lifetime.
   *
   * State must outlive a single request — the entire point is that failures observed on
   * one search inform the next. Keyed by provider id rather than by instance so a rebuilt
   * adapter does not reset its own history.
   */
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    @Inject(FLIGHT_PROVIDERS) private readonly providers: FlightProvider[],
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Executes a search end to end.
   *
   * Never rejects because a provider failed. A search where every provider fails is still
   * a successful response carrying zero flights and an honest account of why — the client
   * can distinguish "no flights on this route" from "nothing answered", which a thrown
   * error would collapse into one indistinguishable failure.
   *
   * @param request - Validated query, plus optional filters and sort.
   * @returns Grouped, scored, filtered and sorted flights with per-provider statuses.
   *
   * @example
   * ```ts
   * const response = await orchestrator.search({ query, filters: { maxStops: 0 } });
   * response.meta.partial;          // true when a provider failed
   * response.providerStatuses;      // why, per provider
   * ```
   */
  async search(request: SearchRequest): Promise<SearchResponse> {
    const startedAtMs = Date.now();
    const searchId = randomUUID();
    const { query, filters, sort } = request;

    const cacheKey = buildCacheKey(query);
    const cached = await this.cache.get<CachedSearch>(cacheKey);

    const { offers, providerStatuses } = cached ?? (await this.fanOut(request, searchId));

    if (!cached) {
      await this.cache.set(
        cacheKey,
        { offers, providerStatuses } satisfies CachedSearch,
        this.config.get('CACHE_TTL_SECONDS', { infer: true }),
      );
    }

    // Grouping and scoring run over the complete result set, then filtering narrows it.
    // Filtering earlier would rescale every score as the user toggles a checkbox.
    const allGroups = scoreGroups(groupOffers(offers));
    const visible = sortGroups(
      filterGroups(allGroups, mergeTimeRange(filters, query)),
      sort?.key,
      sort?.direction,
    );

    const succeeded = providerStatuses.filter(
      (status) => status.status === 'ok' || status.status === 'empty',
    ).length;

    return {
      query,
      groups: visible,
      providerStatuses,
      meta: {
        searchId,
        totalOffers: offers.length,
        totalGroups: allGroups.length,
        multiProviderGroups: countMultiProviderGroups(allGroups),
        tookMs: Date.now() - startedAtMs,
        cached: cached !== undefined,
        currency: 'INR',
        providersSucceeded: succeeded,
        providersAttempted: providerStatuses.length,
        partial: succeeded < providerStatuses.length,
      },
    };
  }

  /**
   * Calls every provider concurrently and collects what each contributed.
   *
   * `Promise.all` would be wrong here in a way that matters: it rejects on the first
   * failure, discarding results already returned by providers that succeeded. Settling
   * every promise is what makes partial results possible at all.
   *
   * @param request - The search request.
   * @param searchId - Correlates provider logs with this search.
   * @returns Every offer collected, and one status per provider.
   * @internal
   */
  private async fanOut(
    request: SearchRequest,
    searchId: string,
  ): Promise<{ offers: NormalizedOffer[]; providerStatuses: ProviderStatus[] }> {
    const selected = this.selectProviders(request);
    const outcomes = await Promise.all(
      selected.map((provider) => this.callProvider(provider, request, searchId)),
    );

    return {
      offers: outcomes.flatMap((outcome) => outcome.offers),
      providerStatuses: outcomes.map((outcome) => outcome.status),
    };
  }

  /**
   * Narrows the provider set when the query names specific providers.
   *
   * @param request - The search request.
   * @returns Providers to call. All registered providers when none are named.
   * @internal
   */
  private selectProviders(request: SearchRequest): FlightProvider[] {
    const requested = request.query.providers;
    if (!requested?.length) return this.providers;

    return this.providers.filter((provider) =>
      requested.includes(provider.descriptor.providerId),
    );
  }

  /**
   * Calls one provider under a deadline, converting any failure into a status.
   *
   * This method is why a provider crash cannot fail a search: every exit path returns a
   * {@link ProviderOutcome}, and nothing propagates out.
   *
   * @param provider - The adapter to call.
   * @param request - The search request.
   * @param searchId - Correlation id passed through to the adapter.
   * @returns The provider's offers and its status.
   * @internal
   */
  private async callProvider(
    provider: FlightProvider,
    request: SearchRequest,
    searchId: string,
  ): Promise<ProviderOutcome> {
    const { descriptor } = provider;
    const breaker = this.breakerFor(descriptor.providerId);
    const startedAtMs = Date.now();

    if (!breaker.canAttempt()) {
      // Skipped without cost: a provider that has failed repeatedly would otherwise
      // charge every subsequent search the full timeout to fail again.
      return {
        offers: [],
        status: this.buildStatus(provider, 'circuit_open', 0, 0, 0, {
          message: `Temporarily skipped after ${breaker.failureCount()} consecutive failures`,
        }),
      };
    }

    try {
      const result = await withTimeout(
        descriptor.providerId,
        this.config.get('PROVIDER_TIMEOUT_MS', { infer: true }),
        (signal) => provider.search(request.query, { signal, searchId, now: new Date() }),
      );

      breaker.recordSuccess();

      const latencyMs = Date.now() - startedAtMs;
      // An empty result is a successful call, and distinguishing it from a failure is the
      // difference between "no flights on this route" and "we could not find out".
      const status = result.offers.length > 0 ? 'ok' : 'empty';

      return {
        offers: result.offers,
        status: this.buildStatus(
          provider,
          status,
          latencyMs,
          result.offers.length,
          result.droppedOfferCount,
          { message: result.message },
        ),
      };
    } catch (error) {
      return this.handleFailure(provider, breaker, error, Date.now() - startedAtMs);
    }
  }

  /**
   * Classifies a provider failure and records it against the breaker.
   *
   * A missing credential deliberately does not count as a failure: the provider is not
   * broken, it is unconfigured, and tripping a breaker over it would be meaningless.
   *
   * @param provider - The adapter that failed.
   * @param breaker - Its circuit breaker.
   * @param error - What was thrown.
   * @param latencyMs - Time spent before failing.
   * @returns An outcome carrying no offers and an explanatory status.
   * @internal
   */
  private handleFailure(
    provider: FlightProvider,
    breaker: CircuitBreaker,
    error: unknown,
    latencyMs: number,
  ): ProviderOutcome {
    const { providerId } = provider.descriptor;

    if (error instanceof ProviderCredentialsMissingError) {
      return {
        offers: [],
        status: this.buildStatus(provider, 'skipped', latencyMs, 0, 0, {
          message: error.message,
        }),
      };
    }

    breaker.recordFailure();

    const status: ProviderCallStatus = error instanceof ProviderTimeoutError ? 'timeout' : 'error';
    const message =
      error instanceof ProviderError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unknown provider failure';

    this.logger.warn(
      `Provider ${providerId} failed (${status}) after ${latencyMs}ms: ${message}`,
    );

    return {
      offers: [],
      status: this.buildStatus(provider, status, latencyMs, 0, 0, { message }),
    };
  }

  /**
   * Shapes a provider status for the response.
   *
   * @param provider - The adapter described.
   * @param status - Outcome of the call.
   * @param latencyMs - Wall-clock duration.
   * @param offerCount - Offers contributed.
   * @param droppedOfferCount - Offers discarded in validation.
   * @param extra - Optional human-readable message.
   * @returns The status, ready to return to the client.
   * @internal
   */
  private buildStatus(
    provider: FlightProvider,
    status: ProviderCallStatus,
    latencyMs: number,
    offerCount: number,
    droppedOfferCount: number,
    extra: { message?: string } = {},
  ): ProviderStatus {
    const { descriptor } = provider;

    return {
      providerId: descriptor.providerId,
      displayName: descriptor.displayName,
      integrationType: descriptor.integrationType,
      dataSource: descriptor.dataSource,
      status,
      latencyMs,
      offerCount,
      droppedOfferCount,
      ...(extra.message ? { message: extra.message } : {}),
    };
  }

  /**
   * Returns the breaker for a provider, creating it on first use.
   *
   * @param providerId - Provider identifier.
   * @returns Its circuit breaker.
   * @internal
   */
  private breakerFor(providerId: string): CircuitBreaker {
    let breaker = this.breakers.get(providerId);

    if (!breaker) {
      breaker = new CircuitBreaker({
        failureThreshold: this.config.get('CIRCUIT_FAILURE_THRESHOLD', { infer: true }),
        resetMs: this.config.get('CIRCUIT_RESET_MS', { infer: true }),
      });
      this.breakers.set(providerId, breaker);
    }

    return breaker;
  }

  /** @returns Current circuit state per provider, for the health dashboard. */
  circuitStates(): Record<string, { state: string; failures: number }> {
    return Object.fromEntries(
      [...this.breakers.entries()].map(([providerId, breaker]) => [
        providerId,
        { state: breaker.currentState(), failures: breaker.failureCount() },
      ]),
    );
  }
}
