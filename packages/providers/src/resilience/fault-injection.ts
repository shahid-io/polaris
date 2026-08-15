import type { ProviderId, SearchQuery } from '@polaris/contracts';
import type { FlightProvider, ProviderContext, ProviderResult } from '../types';
import { ProviderUnavailableError } from '../types';

/**
 * @packageDocumentation
 * Deliberate provider failure, for demonstrating what happens when one goes down.
 *
 * The brief requires unavailable providers and partial results to be handled, and this
 * system does handle them: a failure becomes a visible `providerStatuses` entry and the
 * search continues with whoever answered. But a behaviour nobody can trigger is a behaviour
 * nobody can see. Waiting for a real outage during a walkthrough is not a plan, and pulling
 * the network takes down every provider at once, which demonstrates something else
 * entirely: total failure rather than partial results.
 *
 * So the failure is made summonable. Explicit configuration rather than a random failure
 * rate: a demonstration whose key moment depends on a coin toss is not a demonstration.
 */

/** How a provider should misbehave. */
export type SimulatedFailure = 'none' | 'error' | 'timeout' | 'empty';

/**
 * Wraps a provider so it fails on demand.
 *
 * A wrapper rather than a flag inside each adapter, for two reasons. The adapters stay
 * concerned only with talking to their seller, and the injection applies uniformly to any
 * provider ever added, including ones that do not exist yet.
 *
 * @example
 * ```ts
 * new FaultInjectingProvider(cleartrip, 'timeout'); // exceeds its budget, every time
 * ```
 */
export class FaultInjectingProvider implements FlightProvider {
  /**
   * @param inner - The real provider, whose descriptor is presented unchanged.
   * @param mode - How to fail. `none` delegates untouched.
   */
  constructor(
    private readonly inner: FlightProvider,
    private readonly mode: SimulatedFailure,
  ) {}

  /**
   * The wrapped provider's own descriptor.
   *
   * Deliberately not marked as degraded. `GET /api/providers` describes what a provider
   * *is*, and injection does not change that; what actually happened on a call belongs in
   * the per-search status, which is exactly where the failure will show up.
   */
  get descriptor() {
    return this.inner.descriptor;
  }

  /**
   * Fails as configured, or delegates.
   *
   * The real search is never started for `error` and `empty`: there is no reason to drive a
   * seller's site and then throw the answer away, and doing so would put avoidable traffic
   * on a third party for a demonstration.
   *
   * @param query - The validated search query.
   * @param ctx - Cancellation signal and search-start clock.
   * @returns The inner provider's result, or an injected outcome.
   * @throws {ProviderUnavailableError} In `error` mode.
   */
  async search(query: SearchQuery, ctx: ProviderContext): Promise<ProviderResult> {
    switch (this.mode) {
      case 'error':
        throw new ProviderUnavailableError(
          this.descriptor.providerId,
          'Simulated provider failure (SIMULATED_FAILURES)',
          true,
        );

      case 'timeout':
        // Hangs until the orchestrator's per-provider deadline fires, so the timeout path
        // is exercised for real rather than by throwing a timeout error directly. That
        // distinction matters: it proves the budget is enforced, not merely reported.
        return neverSettles(ctx.signal);

      case 'empty':
        // A provider that answers successfully with nothing. Distinct from failing, and
        // the UI is supposed to say so rather than showing an empty space.
        return {
          offers: [],
          droppedOfferCount: 0,
          message: 'Simulated empty response (SIMULATED_FAILURES)',
        };

      default:
        return this.inner.search(query, ctx);
    }
  }
}

/**
 * A promise that only ever rejects, when the caller gives up.
 *
 * @param signal - The orchestrator's deadline.
 * @returns A promise that never resolves.
 * @internal
 */
function neverSettles(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    const onAbort = () => reject(new Error('Simulated timeout, aborted by deadline'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Every mode {@link parseSimulatedFailures} will accept. */
const MODES = new Set<SimulatedFailure>(['none', 'error', 'timeout', 'empty']);

/**
 * Parses the failure-injection setting.
 *
 * Unknown providers and modes are ignored rather than rejected. This is a demonstration
 * aid, and a typo in it should leave the system behaving normally rather than refuse to
 * start the API.
 *
 * @param raw - Comma-separated `provider:mode` pairs, e.g. `cleartrip:timeout,ixigo:error`.
 * @returns Failure mode by provider id.
 *
 * @example
 * ```ts
 * parseSimulatedFailures('cleartrip:timeout'); // { cleartrip: 'timeout' }
 * ```
 */
export function parseSimulatedFailures(
  raw: string | undefined,
): Partial<Record<ProviderId, SimulatedFailure>> {
  const result: Partial<Record<ProviderId, SimulatedFailure>> = {};
  if (!raw?.trim()) return result;

  for (const pair of raw.split(',')) {
    const [provider, mode] = pair.split(':').map((part) => part.trim());
    if (!provider || !mode) continue;
    if (!MODES.has(mode as SimulatedFailure)) continue;

    result[provider as ProviderId] = mode as SimulatedFailure;
  }

  return result;
}

/**
 * Applies configured failures to a provider list.
 *
 * @param providers - The real providers.
 * @param failures - Modes by provider id, from {@link parseSimulatedFailures}.
 * @returns The same providers, with the configured ones wrapped.
 */
export function withSimulatedFailures(
  providers: readonly FlightProvider[],
  failures: Partial<Record<ProviderId, SimulatedFailure>>,
): FlightProvider[] {
  return providers.map((provider) => {
    const mode = failures[provider.descriptor.providerId];
    return mode && mode !== 'none' ? new FaultInjectingProvider(provider, mode) : provider;
  });
}
