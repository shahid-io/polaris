import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createOtaProviders,
  createSerpApiProviders,
  type FlightProvider,
  type ProviderMode,
  type SimulatedFailure,
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
 * `PROVIDER_MODE` and by which credentials are present. Registering the set at module
 * construction — rather than having each adapter decide at call time whether it is
 * enabled — means the provider list is a fact about the running system, reportable by
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
 * The three representative OTAs are always registered — they need no credentials, which is
 * why the app is fully usable with an empty `.env`. Live adapters join them as their keys
 * become available; a missing key means the provider is simply absent rather than present
 * and permanently failing.
 *
 * @param config - Validated environment.
 * @returns Providers to register.
 * @internal
 */
function buildProviders(config: ConfigService<Env, true>): FlightProvider[] {
  const failureModes = parseFailureModes(config.get('SIMULATED_FAILURES', { infer: true }));

  return [
    // Live airline fares via SerpApi. With no key these report `skipped`, so the app
    // remains fully usable on a clean checkout.
    ...createSerpApiProviders(
      config.get('SERPAPI_KEY', { infer: true }),
      config.get('PROVIDER_MODE', { infer: true }) as ProviderMode,
    ),
    ...createOtaProviders({
      failureModes,
      // Realistic response times in every mode except tests, so the timeout and circuit
      // breaker are exercised by ordinary use rather than only by contrived cases.
      simulateLatency: config.get('NODE_ENV', { infer: true }) !== 'test',
    }),
  ];
}

/**
 * Parses the demo failure-injection setting.
 *
 * Exists so the partial-results path can be demonstrated on demand — `cleartrip:timeout`
 * makes a live audience see the degradation rather than being told about it. Explicit
 * configuration rather than a random failure rate: a demo that fails a coin toss is worse
 * than no demo.
 *
 * @param raw - Comma-separated `provider:mode` pairs, e.g. `cleartrip:timeout,goibibo:error`.
 * @returns Failure modes by provider. Unknown providers and modes are ignored.
 * @internal
 */
function parseFailureModes(
  raw: string | undefined,
): Partial<Record<'makemytrip' | 'goibibo' | 'cleartrip', SimulatedFailure>> {
  if (!raw?.trim()) return {};

  const valid = new Set(['makemytrip', 'goibibo', 'cleartrip']);
  const validModes = new Set<SimulatedFailure>(['none', 'error', 'timeout']);
  const result: Record<string, SimulatedFailure> = {};

  for (const pair of raw.split(',')) {
    const [provider, mode] = pair.split(':').map((part) => part.trim());
    if (provider && mode && valid.has(provider) && validModes.has(mode as SimulatedFailure)) {
      result[provider] = mode as SimulatedFailure;
    }
  }

  return result;
}
