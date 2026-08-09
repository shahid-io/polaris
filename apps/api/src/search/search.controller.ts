import { Body, Controller, Post } from '@nestjs/common';
import { searchRequestSchema, type SearchRequest, type SearchResponse } from '@polaris/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SearchOrchestrator } from './search.orchestrator';

@Controller('api/search')
export class SearchController {
  constructor(private readonly orchestrator: SearchOrchestrator) {}

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
    return this.orchestrator.search(request);
  }
}
