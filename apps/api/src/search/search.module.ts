import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchOrchestrator } from './search.orchestrator';

/**
 * Search feature module.
 *
 * Depends on FLIGHT_PROVIDERS and CACHE_STORE, both provided by global modules, so this
 * module declares only what it owns.
 */
@Module({
  controllers: [SearchController],
  providers: [SearchOrchestrator],
  exports: [SearchOrchestrator],
})
export class SearchModule {}
