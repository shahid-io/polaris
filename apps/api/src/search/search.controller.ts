import { Body, Controller, Post } from '@nestjs/common';
import { searchRequestSchema, type SearchRequest, type SearchResponse } from '@polaris/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SearchOrchestrator } from './search.orchestrator';
import { AnalyticsService } from '../analytics/analytics.service';

@Controller('api/search')
export class SearchController {
  constructor(
    private readonly orchestrator: SearchOrchestrator,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Searches every provider and returns grouped, ranked flights.
   *
   * Always 200 when the request is valid, even if every provider failed — the outcome of
   * each is reported in `providerStatuses` rather than collapsed into an HTTP error. Only
   * a malformed request (400) or an internal fault (500) is a non-2xx.
   *
   * @param request - Validated query, plus optional filters and sort.
   * @returns Comparison groups, per-provider statuses and search metadata.
   */
  @Post()
  async search(
    @Body(new ZodValidationPipe(searchRequestSchema)) request: SearchRequest,
  ): Promise<SearchResponse> {
    const response = await this.orchestrator.search(request);

    // Deliberately not awaited. Recording telemetry must not add latency to a response
    // the user is waiting for, and must not be able to fail a search that already
    // succeeded. AnalyticsService swallows its own errors, so there is nothing to catch.
    void this.analytics.recordSearch(response);

    return response;
  }
}
