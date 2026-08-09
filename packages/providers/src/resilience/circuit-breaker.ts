/**
 * States of a circuit breaker.
 *
 * - `closed` — calls pass through, failures are counted.
 * - `open` — calls are rejected immediately without touching the provider.
 * - `half_open` — one probe is allowed through to test recovery.
 */
export type CircuitState = 'closed' | 'open' | 'half_open';

/** Tuning for {@link CircuitBreaker}. */
export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the circuit open. */
  failureThreshold: number;
  /** How long the circuit stays open before allowing a probe. */
  resetMs: number;
  /** Injected clock, so tests do not have to wait in real time. */
  now?: () => number;
}

/**
 * Per-provider circuit breaker.
 *
 * A provider that has failed three times in a row will almost certainly fail the fourth
 * time too. Continuing to call it costs the full timeout on every search, which the user
 * pays for in latency while getting nothing back. The breaker converts that slow failure
 * into an instant one, and — equally important — into an honest `circuit_open` status the
 * UI can explain rather than an unexplained gap in results.
 *
 * Recovery is automatic: after `resetMs` a single probe is allowed through, and a success
 * closes the circuit.
 *
 * @example
 * ```ts
 * const breaker = new CircuitBreaker({ failureThreshold: 3, resetMs: 30_000 });
 *
 * if (!breaker.canAttempt()) return skipped('circuit_open');
 * try {
 *   const result = await provider.search(query, ctx);
 *   breaker.recordSuccess();
 *   return result;
 * } catch (error) {
 *   breaker.recordFailure();
 *   throw error;
 * }
 * ```
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly now: () => number;

  /**
   * @param options - Failure threshold, reset window and an optional injected clock.
   */
  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Decides whether a call may proceed, transitioning to `half_open` when the reset
   * window has elapsed.
   *
   * Not side-effect free by design: asking is what allows the probe through, which keeps
   * callers from having to drive the state machine themselves.
   *
   * @returns `true` when the call should be attempted.
   */
  canAttempt(): boolean {
    if (this.state === 'closed') return true;

    if (this.state === 'open' && this.now() - this.openedAt >= this.options.resetMs) {
      this.state = 'half_open';
      return true;
    }

    return this.state === 'half_open';
  }

  /**
   * Records a successful call, closing the circuit and clearing the failure count.
   *
   * A success in `half_open` fully closes the circuit rather than requiring several — a
   * provider that answers correctly after a cooldown is working, and demanding more probes
   * would keep results hidden from users for no benefit.
   */
  recordSuccess(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
  }

  /**
   * Records a failed call, tripping the circuit at the threshold.
   *
   * A failure while `half_open` re-opens immediately regardless of the count: the probe
   * exists precisely to answer "has it recovered?", and the answer was no.
   */
  recordFailure(): void {
    this.consecutiveFailures += 1;

    if (this.state === 'half_open' || this.consecutiveFailures >= this.options.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }

  /**
   * Current state, without side effects.
   *
   * Reports `open` even when the reset window has elapsed — only {@link canAttempt} performs
   * the transition. Intended for diagnostics and the provider health dashboard.
   *
   * @returns The current state.
   */
  currentState(): CircuitState {
    return this.state;
  }

  /** @returns Consecutive failures since the last success. */
  failureCount(): number {
    return this.consecutiveFailures;
  }

  /** Resets to a fully closed circuit. Intended for tests and administrative reset. */
  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }
}
