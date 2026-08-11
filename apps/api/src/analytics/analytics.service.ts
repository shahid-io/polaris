import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type Connection } from 'mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import type { SearchResponse } from '@polaris/contracts';
import { SearchEvent } from './search-event.schema';

/** Aggregate view of one provider's behaviour over a window. */
export interface ProviderPerformance {
  providerId: string;
  calls: number;
  successRate: number;
  /** Mean latency over successful calls only, failures skew the average uselessly. */
  averageLatencyMs: number;
  timeouts: number;
  errors: number;
}

/** Headline numbers for the analytics view. */
export interface AnalyticsSummary {
  connected: boolean;
  totalSearches: number;
  partialRate: number;
  cacheHitRate: number;
  averageTookMs: number;
  /** Mean groups sold by more than one provider, deduplication, measured. */
  averageMultiProviderGroups: number;
  topRoutes: { route: string; searches: number }[];
  providerPerformance: ProviderPerformance[];
}

/**
 * Records searches and answers operational questions about them.
 *
 * ### Fail-open by design
 * Every write is best-effort. If MongoDB is unreachable, not running, still starting,
 * container stopped, the search still succeeds and the failure is logged once rather than
 * propagated. Telemetry is not worth failing a user's search over, and a database being
 * down should never be the reason a demo breaks.
 *
 * This is why the model is injected optionally: when analytics is disabled the service is
 * constructed without one and every method degrades quietly.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  /** Logged once per process, so a stopped database does not flood the output. */
  private warnedAboutUnavailability = false;

  constructor(
    @Optional() @InjectModel(SearchEvent.name) private readonly model?: Model<SearchEvent>,
    @Optional() @InjectConnection() private readonly connection?: Connection,
  ) {}

  /** @returns Whether a usable database connection exists right now. */
  isConnected(): boolean {
    // Mongoose readyState 1 is "connected".
    return this.model !== undefined && this.connection?.readyState === 1;
  }

  /**
   * Records a completed search.
   *
   * Deliberately not awaited by the caller, see {@link recordSearch} usage in the
   * controller. A failure here is swallowed after one warning.
   *
   * @param response - The response that was returned to the client.
   */
  async recordSearch(response: SearchResponse): Promise<void> {
    if (!this.isConnected()) {
      this.warnOnce('MongoDB unavailable: search analytics are being skipped');
      return;
    }

    try {
      await this.model!.create({
        route: `${response.query.origin}-${response.query.destination}`,
        origin: response.query.origin,
        destination: response.query.destination,
        departureDate: response.query.departureDate,
        passengers: response.query.passengers,
        cabinClass: response.query.cabinClass,
        providers: response.providerStatuses.map((status) => ({
          providerId: status.providerId,
          status: status.status,
          latencyMs: status.latencyMs,
          offerCount: status.offerCount,
          droppedOfferCount: status.droppedOfferCount,
        })),
        totalOffers: response.meta.totalOffers,
        totalGroups: response.meta.totalGroups,
        multiProviderGroups: response.meta.multiProviderGroups,
        tookMs: response.meta.tookMs,
        cached: response.meta.cached,
        partial: response.meta.partial,
        providersSucceeded: response.meta.providersSucceeded,
        providersAttempted: response.meta.providersAttempted,
        searchId: response.meta.searchId,
      });
    } catch (error) {
      // Never rethrow: the user's search already succeeded, and telemetry must not
      // retroactively turn it into a failure.
      this.logger.warn(
        `Failed to record search analytics: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Summarises recorded searches.
   *
   * @param sinceDays - Window to summarise. Defaults to the last 7 days.
   * @returns The summary, with `connected: false` and zeroed figures when the database is
   *   unavailable, so the UI can say "analytics offline" rather than "zero searches",
   *   which would be a lie.
   */
  async summary(sinceDays = 7): Promise<AnalyticsSummary> {
    if (!this.isConnected()) return emptySummary();

    try {
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      const events = await this.model!.find({ createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      if (events.length === 0) return { ...emptySummary(), connected: true };

      return {
        connected: true,
        totalSearches: events.length,
        partialRate: rate(events.filter((event) => event.partial).length, events.length),
        cacheHitRate: rate(events.filter((event) => event.cached).length, events.length),
        averageTookMs: Math.round(mean(events.map((event) => event.tookMs))),
        averageMultiProviderGroups:
          Math.round(mean(events.map((event) => event.multiProviderGroups)) * 10) / 10,
        topRoutes: topRoutes(events),
        providerPerformance: providerPerformance(events),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to read search analytics: ${error instanceof Error ? error.message : error}`,
      );
      return emptySummary();
    }
  }

  /**
   * Logs a message the first time only.
   *
   * @param message - What to warn about.
   * @internal
   */
  private warnOnce(message: string): void {
    if (this.warnedAboutUnavailability) return;
    this.warnedAboutUnavailability = true;
    this.logger.warn(message);
  }
}

/** @returns A summary describing an unavailable database, distinct from "no data". */
function emptySummary(): AnalyticsSummary {
  return {
    connected: false,
    totalSearches: 0,
    partialRate: 0,
    cacheHitRate: 0,
    averageTookMs: 0,
    averageMultiProviderGroups: 0,
    topRoutes: [],
    providerPerformance: [],
  };
}

/** @internal */
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** @returns A percentage to one decimal place. @internal */
function rate(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/** @internal */
function topRoutes(events: readonly { route: string }[]): { route: string; searches: number }[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.route, (counts.get(event.route) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([route, searches]) => ({ route, searches }))
    .sort((a, b) => b.searches - a.searches)
    .slice(0, 5);
}

/**
 * Aggregates per-provider behaviour.
 *
 * Average latency counts successful calls only. Including a 6000 ms timeout would drag the
 * mean toward the timeout ceiling and make a fast-but-flaky provider look uniformly slow,
 * two different problems that need telling apart. The timeout and error counts carry that
 * information separately.
 *
 * @internal
 */
function providerPerformance(
  events: readonly { providers: { providerId: string; status: string; latencyMs: number }[] }[],
): ProviderPerformance[] {
  const byProvider = new Map<
    string,
    { calls: number; successes: number; latencies: number[]; timeouts: number; errors: number }
  >();

  for (const event of events) {
    for (const outcome of event.providers) {
      const stats = byProvider.get(outcome.providerId) ?? {
        calls: 0,
        successes: 0,
        latencies: [],
        timeouts: 0,
        errors: 0,
      };

      stats.calls += 1;
      if (outcome.status === 'ok' || outcome.status === 'empty') {
        stats.successes += 1;
        stats.latencies.push(outcome.latencyMs);
      }
      if (outcome.status === 'timeout') stats.timeouts += 1;
      if (outcome.status === 'error') stats.errors += 1;

      byProvider.set(outcome.providerId, stats);
    }
  }

  return [...byProvider.entries()]
    .map(([providerId, stats]) => ({
      providerId,
      calls: stats.calls,
      successRate: rate(stats.successes, stats.calls),
      averageLatencyMs: Math.round(mean(stats.latencies)),
      timeouts: stats.timeouts,
      errors: stats.errors,
    }))
    .sort((a, b) => b.calls - a.calls);
}
