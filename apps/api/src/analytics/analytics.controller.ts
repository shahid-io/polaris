import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService, type AnalyticsSummary } from './analytics.service';

@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * Summarises recorded searches.
   *
   * Returns 200 with `connected: false` when the database is unavailable, rather than an
   * error. Analytics being offline is a degraded state of a working system, not a failure
   * of the request, and the UI needs to distinguish "offline" from "no searches yet".
   *
   * @param days - Window in days. Defaults to 7.
   * @returns Headline figures, top routes and per-provider performance.
   */
  @Get()
  async summary(@Query('days') days?: string): Promise<AnalyticsSummary> {
    const parsed = Number.parseInt(days ?? '', 10);
    const window = Number.isFinite(parsed) && parsed > 0 && parsed <= 365 ? parsed : 7;

    return this.analytics.summary(window);
  }
}
