import { ProviderError } from '../types';

/** Tuning for {@link withRetry}. */
export interface RetryOptions {
  /** Attempts in total, including the first. `1` disables retrying. */
  maxAttempts: number;
  /** Delay before the first retry; doubles each subsequent attempt. */
  baseDelayMs: number;
  /** Upper bound on any single delay, so backoff cannot exceed the search budget. */
  maxDelayMs?: number;
  /** Injected sleep, so tests do not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected randomness for jitter, so tests are deterministic. */
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retries an operation with exponential backoff and full jitter.
 *
 * ### What is retried
 * Only errors marked retryable. A {@link ProviderError} carries that flag explicitly, so a
 * missing credential or a malformed request fails immediately instead of burning the whole
 * time budget on three attempts that cannot possibly succeed. Unknown errors are treated as
 * retryable, since transport failures usually arrive as generic errors.
 *
 * ### Why jitter
 * When a provider recovers from an outage, every in-flight search retries at the same
 * backoff interval and hits it simultaneously, knocking it straight back over. Randomising
 * each delay across the whole window spreads that thundering herd.
 *
 * @typeParam T - What the operation resolves to.
 * @param operation - Receives the 1-based attempt number.
 * @param options - Attempt count, backoff shape and injectable clock/randomness.
 * @returns Whatever `operation` resolves to.
 * @throws The final error, once attempts are exhausted or a non-retryable error occurs.
 *
 * @example
 * ```ts
 * await withRetry((attempt) => callProvider(attempt), {
 *   maxAttempts: 3,
 *   baseDelayMs: 200,   // waits ~0-200ms, then ~0-400ms
 * });
 * ```
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const maxDelayMs = options.maxDelayMs ?? 5_000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;

      if (!isRetryable(error) || attempt === options.maxAttempts) {
        throw error;
      }

      const ceiling = Math.min(options.baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      // Full jitter: uniformly random across the window rather than a fixed backoff.
      await sleep(Math.floor(random() * ceiling));
    }
  }

  throw lastError;
}

/**
 * Decides whether an error is worth retrying.
 *
 * @param error - The thrown value.
 * @returns The error's own flag for a {@link ProviderError}; `true` otherwise, since
 *   transport failures typically surface as generic errors.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ProviderError) return error.retryable;
  return true;
}
