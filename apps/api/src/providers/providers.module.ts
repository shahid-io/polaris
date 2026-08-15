import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createWebSessionProviders,
  parseSimulatedFailures,
  parseWebSessionSites,
  WEB_SESSION_SITE_IDS,
  withSimulatedFailures,
  type BrowserProviderMode,
  type FlightProvider,
} from '@polaris/providers';
import type { Env } from '../config/env';

/**
 * Injection token holding every registered provider.
 *
 * The orchestrator depends on this array and never names a concrete provider, which is
 * what keeps adding a provider to a one-line change. It is also what lets tests swap in
 * deliberately failing fakes to drive the partial-results and circuit-breaker paths
 * without touching production code.
 */
export const FLIGHT_PROVIDERS = Symbol('FLIGHT_PROVIDERS');

/**
 * Registers the provider adapters.
 *
 * A dynamic module because *which* adapters exist is a runtime decision driven by
 * `BROWSER_PROVIDERS`. Registering the set at module
 * construction, rather than having each adapter decide at call time whether it is
 * enabled: means the provider list is a fact about the running system, reportable by
 * `GET /api/providers` before any search happens.
 *
 * @example
 * ```ts
 * // in AppModule
 * ProvidersModule.forRoot()
 * ```
 */
@Module({})
export class ProvidersModule {
  /**
   * Builds the module, selecting adapters from configuration.
   *
   * @returns A dynamic module exporting {@link FLIGHT_PROVIDERS}.
   */
  static forRoot(): DynamicModule {
    return {
      module: ProvidersModule,
      global: true,
      providers: [
        {
          provide: FLIGHT_PROVIDERS,
          inject: [ConfigService],
          useFactory: (config: ConfigService<Env, true>): FlightProvider[] =>
            buildProviders(config),
        },
      ],
      exports: [FLIGHT_PROVIDERS],
    };
  }
}

/**
 * Assembles the adapter list for the current configuration.
 *
 * **Every provider registered here reports a price some real seller is actually showing.**
 * Nothing generates a fare. A provider that cannot be sourced truthfully is absent rather
 * than filled in, because a generated number under a real company's name is precisely the
 * error this product exists to catch, and labelling it does not make it true.
 *
 * That is why an unreachable seller simply does not appear. MakeMyTrip and Goibibo refuse
 * automated clients at their CDN edge, so they have no adapter: not a degraded one, none.
 *
 * @param config - Validated environment.
 * @returns Providers to register.
 * @internal
 */
function buildProviders(config: ConfigService<Env, true>): FlightProvider[] {
  const configured = config.get('BROWSER_PROVIDERS', { infer: true });
  // Real sourcing is the default, not an opt-in. The agencies are the only providers whose
  // prices can be checked against the seller that quoted them, so switching them off is the
  // choice that needs making deliberately, not the choice that needs making to get them.
  const agencies = configured === undefined ? new Set(WEB_SESSION_SITE_IDS) : parseWebSessionSites(configured);
  const browserMode = config.get('BROWSER_PROVIDER_MODE', { infer: true }) as BrowserProviderMode;

  // Travel agency fares, read from each agency's own public search. Wrapped last, so a
  // configured failure applies to whatever the registration produced rather than having to
  // be threaded through every adapter.
  return withSimulatedFailures(
    createWebSessionProviders(agencies, browserMode),
    parseSimulatedFailures(config.get('SIMULATED_FAILURES', { infer: true })),
  );
}
