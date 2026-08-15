import { describe, expect, it, vi } from 'vitest';
import { searchQuerySchema } from '@polaris/contracts';
import {
  FaultInjectingProvider,
  parseSimulatedFailures,
  withSimulatedFailures,
} from './fault-injection';
import { ProviderUnavailableError, type FlightProvider } from '../types';

const query = searchQuerySchema.parse({
  origin: 'DEL',
  destination: 'BOM',
  departureDate: '2026-08-27',
});

const ctx = (signal = new AbortController().signal) => ({
  signal,
  searchId: 'test',
  now: new Date('2026-08-15T12:00:00.000Z'),
});

/** A provider that always succeeds, so any failure observed is injected rather than real. */
const healthy = (): FlightProvider => ({
  descriptor: {
    providerId: 'cleartrip',
    displayName: 'Cleartrip',
    integrationType: 'browser-automation',
    dataSource: 'provider-web-session',
    isRealData: true,
    integrationNote: 'test',
    enabled: true,
  },
  search: vi.fn().mockResolvedValue({ offers: [], droppedOfferCount: 0, message: 'real call' }),
});

describe('FaultInjectingProvider', () => {
  it('delegates untouched when no failure is configured', async () => {
    const inner = healthy();

    const result = await new FaultInjectingProvider(inner, 'none').search(query, ctx());

    expect(result.message).toBe('real call');
    expect(inner.search).toHaveBeenCalledOnce();
  });

  it('fails as a retryable provider error', async () => {
    const inner = healthy();

    await expect(new FaultInjectingProvider(inner, 'error').search(query, ctx())).rejects.toThrow(
      ProviderUnavailableError,
    );
  });

  /**
   * The real search must not run for an injected failure. Driving a seller's site and then
   * discarding the answer would put avoidable traffic on a third party to stage a demo.
   */
  it('does not call the seller when the failure is decided in advance', async () => {
    const inner = healthy();

    await new FaultInjectingProvider(inner, 'error').search(query, ctx()).catch(() => undefined);
    await new FaultInjectingProvider(inner, 'empty').search(query, ctx());

    expect(inner.search).not.toHaveBeenCalled();
  });

  /**
   * Hangs rather than throwing a timeout directly, so the orchestrator's budget is what
   * ends the call. That difference is the point: it demonstrates the timeout being
   * enforced, not merely reported.
   */
  it('hangs until the deadline rather than throwing its own timeout', async () => {
    const controller = new AbortController();
    const pending = new FaultInjectingProvider(healthy(), 'timeout').search(
      query,
      ctx(controller.signal),
    );

    let settled = false;
    void pending.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    controller.abort();
    await expect(pending).rejects.toThrow(/Simulated timeout/);
  });

  it('can answer successfully with nothing, which is not the same as failing', async () => {
    const result = await new FaultInjectingProvider(healthy(), 'empty').search(query, ctx());

    expect(result.offers).toEqual([]);
    expect(result.droppedOfferCount).toBe(0);
    expect(result.message).toContain('Simulated empty response');
  });

  /** `GET /api/providers` describes what a provider is; injection does not change that. */
  it('presents the wrapped provider’s descriptor unchanged', () => {
    const inner = healthy();

    expect(new FaultInjectingProvider(inner, 'error').descriptor).toEqual(inner.descriptor);
  });
});

describe('parseSimulatedFailures', () => {
  it('reads provider and mode pairs', () => {
    expect(parseSimulatedFailures('cleartrip:timeout,ixigo:error')).toEqual({
      cleartrip: 'timeout',
      ixigo: 'error',
    });
  });

  /** A typo in a demo aid must not stop the API booting. */
  it('ignores unknown modes and malformed pairs rather than failing', () => {
    expect(parseSimulatedFailures('cleartrip:explode,nonsense,ixigo:')).toEqual({});
    expect(parseSimulatedFailures(undefined)).toEqual({});
    expect(parseSimulatedFailures('  ')).toEqual({});
  });
});

describe('withSimulatedFailures', () => {
  it('wraps only the providers named', () => {
    const cleartrip = healthy();
    const other = { ...healthy(), descriptor: { ...healthy().descriptor, providerId: 'ixigo' } };

    const [wrapped, untouched] = withSimulatedFailures([cleartrip, other as FlightProvider], {
      cleartrip: 'error',
    });

    expect(wrapped).toBeInstanceOf(FaultInjectingProvider);
    expect(untouched).toBe(other);
  });

  it('leaves everything alone when nothing is configured', () => {
    const providers = [healthy()];

    expect(withSimulatedFailures(providers, {})[0]).toBe(providers[0]);
  });
});
