import { ProviderTimeoutError } from '../types';
import type { ProviderId } from '@polaris/contracts';

/**
 * Runs an operation under a deadline, aborting it when the budget is exceeded.
 *
 * ### Why both an abort signal and a race
 * The signal is passed *into* the operation so cancellation reaches the underlying I/O:
 * racing alone would resolve the search on time but leave the request running, holding a
 * socket open and, on a busy server, leaking connections that outlive the requests that
 * spawned them.
 *
 * But aborting is only a request. An adapter that ignores its signal — a third-party
 * client that does not accept one, or simply a mistake — would never settle, and awaiting
 * it directly would hang the entire search on the one provider the timeout was meant to
 * contain. Racing a rejecting timer guarantees this function returns on schedule whether
 * or not the operation cooperates.
 *
 * Each mechanism covers the other's blind spot: the signal stops the work, the race
 * bounds the wait.
 *
 * @typeParam T - What the operation resolves to.
 * @param providerId - Provider being called, for error attribution.
 * @param timeoutMs - Budget in milliseconds.
 * @param operation - Receives a signal it should pass to any I/O it performs.
 * @param externalSignal - Optional parent signal; aborting it aborts the operation.
 *   Honouring it requires a cooperative operation, since only the deadline is raced.
 * @returns Whatever `operation` resolves to.
 * @throws {ProviderTimeoutError} When the budget elapses first.
 *
 * @example
 * ```ts
 * const offers = await withTimeout('indigo', 6000, (signal) =>
 *   fetch(url, { signal }).then((r) => r.json()),
 * );
 * ```
 */
export async function withTimeout<T>(
  providerId: ProviderId,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      // Ask the operation to stop, then reject regardless of whether it obliges.
      controller.abort();
      reject(new ProviderTimeoutError(providerId, timeoutMs));
    }, timeoutMs);
  });

  const forwardAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } catch (error) {
    // Translate an abort we caused into a meaningful domain error. An abort originating
    // from the external signal is not ours to relabel, so it propagates untouched.
    if (timedOut) {
      throw new ProviderTimeoutError(providerId, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}
