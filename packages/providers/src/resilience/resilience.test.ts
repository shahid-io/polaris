import { describe, expect, it, vi } from 'vitest';
import { withTimeout } from './with-timeout';
import { isRetryable, withRetry } from './retry';
import {
  ProviderCredentialsMissingError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from '../types';

describe('withTimeout', () => {
  it('returns the result when the operation finishes in time', async () => {
    const result = await withTimeout('cleartrip', 1000, async () => 'offers');

    expect(result).toBe('offers');
  });

  it('throws ProviderTimeoutError when the budget elapses', async () => {
    const neverResolves = () => new Promise<string>(() => {});

    await expect(withTimeout('cleartrip', 10, neverResolves)).rejects.toThrow(ProviderTimeoutError);
  });

  it('attributes the timeout to the right provider and budget', async () => {
    const neverResolves = () => new Promise<string>(() => {});

    await expect(withTimeout('cleartrip', 10, neverResolves)).rejects.toMatchObject({
      providerId: 'cleartrip',
      timeoutMs: 10,
    });
  });

  /**
   * Racing a promise would resolve the search on time but leave the request running.
   * The signal must actually reach the operation so cancellation propagates to fetch.
   */
  it('aborts the operation rather than merely abandoning it', async () => {
    let observed: AbortSignal | undefined;

    await expect(
      withTimeout('cleartrip', 10, (signal) => {
        observed = signal;
        return new Promise<string>(() => {});
      }),
    ).rejects.toThrow(ProviderTimeoutError);

    expect(observed?.aborted).toBe(true);
  });

  it('propagates the operation’s own error untouched', async () => {
    const failure = new ProviderUnavailableError('goibibo', 'upstream 503');

    await expect(withTimeout('goibibo', 1000, () => Promise.reject(failure))).rejects.toBe(failure);
  });

  it('aborts when an external signal is aborted', async () => {
    const parent = new AbortController();
    let observed: AbortSignal | undefined;

    const pending = withTimeout(
      'cleartrip',
      5000,
      (signal) => {
        observed = signal;
        return new Promise<string>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
      parent.signal,
    );

    parent.abort();

    await expect(pending).rejects.toThrow('aborted');
    expect(observed?.aborted).toBe(true);
  });

  it('does not relabel an external abort as a timeout', async () => {
    const parent = new AbortController();
    const pending = withTimeout(
      'cleartrip',
      5000,
      (signal) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled by caller')));
        }),
      parent.signal,
    );

    parent.abort();

    await expect(pending).rejects.not.toBeInstanceOf(ProviderTimeoutError);
  });

  it('clears its timer so a fast success leaves nothing pending', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    await withTimeout('cleartrip', 1000, async () => 'ok');

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe('withRetry', () => {
  const noSleep = async () => {};
  const noJitter = () => 0;

  it('returns the first successful result without retrying', async () => {
    const operation = vi.fn(async () => 'ok');

    const result = await withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 10,
      sleep: noSleep,
      random: noJitter,
    });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure and succeeds', async () => {
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new ProviderUnavailableError('goibibo', '503'))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 10,
      sleep: noSleep,
      random: noJitter,
    });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('gives up after the final attempt and rethrows', async () => {
    const failure = new ProviderUnavailableError('goibibo', '503');
    const operation = vi.fn(async () => {
      throw failure;
    });

    await expect(
      withRetry(operation, { maxAttempts: 3, baseDelayMs: 10, sleep: noSleep, random: noJitter }),
    ).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  /**
   * The whole reason ProviderError carries a retryable flag: a missing key cannot
   * succeed on attempt two, and retrying would spend the search's time budget proving it.
   */
  it('does not retry a non-retryable failure', async () => {
    const operation = vi.fn(async () => {
      throw new ProviderCredentialsMissingError('cleartrip', 'BROWSER_PROVIDERS');
    });

    await expect(
      withRetry(operation, { maxAttempts: 3, baseDelayMs: 10, sleep: noSleep, random: noJitter }),
    ).rejects.toThrow(ProviderCredentialsMissingError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('treats an unknown error as retryable', async () => {
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce('ok');

    await expect(
      withRetry(operation, { maxAttempts: 2, baseDelayMs: 10, sleep: noSleep, random: noJitter }),
    ).resolves.toBe('ok');
  });

  it('passes the attempt number to the operation', async () => {
    const attempts: number[] = [];
    const operation = vi.fn(async (attempt: number) => {
      attempts.push(attempt);
      if (attempt < 3) throw new ProviderUnavailableError('goibibo', 'retry');
      return 'ok';
    });

    await withRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 10,
      sleep: noSleep,
      random: noJitter,
    });

    expect(attempts).toEqual([1, 2, 3]);
  });

  it('doubles the backoff ceiling on each attempt', async () => {
    const delays: number[] = [];
    const operation = vi.fn(async () => {
      throw new ProviderUnavailableError('goibibo', '503');
    });

    await expect(
      withRetry(operation, {
        maxAttempts: 4,
        baseDelayMs: 100,
        sleep: async (ms) => {
          delays.push(ms);
        },
        // Full jitter at its maximum reveals the ceiling.
        random: () => 0.999999,
      }),
    ).rejects.toThrow();

    expect(delays).toEqual([99, 199, 399]);
  });

  it('caps the backoff at maxDelayMs', async () => {
    const delays: number[] = [];
    const operation = vi.fn(async () => {
      throw new ProviderUnavailableError('goibibo', '503');
    });

    await expect(
      withRetry(operation, {
        maxAttempts: 4,
        baseDelayMs: 1000,
        maxDelayMs: 1500,
        sleep: async (ms) => {
          delays.push(ms);
        },
        random: () => 0.999999,
      }),
    ).rejects.toThrow();

    expect(delays.every((delay) => delay <= 1500)).toBe(true);
  });

  it('jitters delays rather than using a fixed backoff', async () => {
    // A fixed backoff makes every recovering client hit the provider simultaneously.
    const delays: number[] = [];
    const operation = vi.fn(async () => {
      throw new ProviderUnavailableError('goibibo', '503');
    });

    await expect(
      withRetry(operation, {
        maxAttempts: 3,
        baseDelayMs: 1000,
        sleep: async (ms) => {
          delays.push(ms);
        },
        random: () => 0.25,
      }),
    ).rejects.toThrow();

    expect(delays).toEqual([250, 500]);
  });

  it('does not retry at all when maxAttempts is 1', async () => {
    const operation = vi.fn(async () => {
      throw new ProviderUnavailableError('goibibo', '503');
    });

    await expect(
      withRetry(operation, { maxAttempts: 1, baseDelayMs: 10, sleep: noSleep }),
    ).rejects.toThrow();
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('isRetryable', () => {
  it('honours the flag on a ProviderError', () => {
    expect(isRetryable(new ProviderUnavailableError('goibibo', '503'))).toBe(true);
    expect(isRetryable(new ProviderCredentialsMissingError('cleartrip', 'KEY'))).toBe(false);
  });

  it('assumes an unknown error is a transient transport failure', () => {
    expect(isRetryable(new Error('ECONNRESET'))).toBe(true);
  });
});
