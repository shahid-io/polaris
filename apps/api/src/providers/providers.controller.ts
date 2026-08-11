import { Controller, Get, Inject } from '@nestjs/common';
import type { ProviderDescriptor } from '@polaris/contracts';
import type { FlightProvider } from '@polaris/providers';
import { FLIGHT_PROVIDERS } from './providers.module';
import { SearchOrchestrator } from '../search/search.orchestrator';

@Controller('api/providers')
export class ProvidersController {
  constructor(
    @Inject(FLIGHT_PROVIDERS) private readonly providers: FlightProvider[],
    private readonly orchestrator: SearchOrchestrator,
  ) {}

  /**
   * Lists every registered provider and its current circuit state.
   *
   * Serves the provider health view. Exposing which providers are real and which are
   * representative through the API, rather than only in documentation, is what lets the
   * UI badge simulated data honestly at the point a user sees a price.
   *
   * @returns Provider descriptors with live circuit state.
   */
  @Get()
  list(): { providers: (ProviderDescriptor & { circuit: string; failures: number })[] } {
    const circuits = this.orchestrator.circuitStates();

    return {
      providers: this.providers.map((provider) => ({
        ...provider.descriptor,
        circuit: circuits[provider.descriptor.providerId]?.state ?? 'closed',
        failures: circuits[provider.descriptor.providerId]?.failures ?? 0,
      })),
    };
  }
}
