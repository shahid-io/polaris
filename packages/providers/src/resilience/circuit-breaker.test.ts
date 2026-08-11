import { beforeEach, describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let clock: number;
  const now = () => clock;

  const build = (failureThreshold = 3, resetMs = 30_000) =>
    new CircuitBreaker({ failureThreshold, resetMs, now });

  beforeEach(() => {
    clock = 1_000_000;
  });

  it('starts closed and allows calls', () => {
    const breaker = build();

    expect(breaker.currentState()).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('stays closed below the failure threshold', () => {
    const breaker = build(3);

    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.currentState()).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('opens on the threshold failure and rejects calls', () => {
    const breaker = build(3);

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.currentState()).toBe('open');
    expect(breaker.canAttempt()).toBe(false);
  });

  it('resets the failure count on success', () => {
    const breaker = build(3);

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();

    expect(breaker.failureCount()).toBe(1);
    expect(breaker.currentState()).toBe('closed');
  });

  it('counts only consecutive failures', () => {
    const breaker = build(3);

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();

    // Five failures overall, but never three in a row.
    expect(breaker.currentState()).toBe('closed');
  });

  it('keeps rejecting while the reset window has not elapsed', () => {
    const breaker = build(1, 30_000);
    breaker.recordFailure();

    clock += 29_999;

    expect(breaker.canAttempt()).toBe(false);
  });

  it('allows one probe once the reset window elapses', () => {
    const breaker = build(1, 30_000);
    breaker.recordFailure();

    clock += 30_000;

    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.currentState()).toBe('half_open');
  });

  /**
   * The whole point of `half_open`. The orchestrator fans out concurrently, so two searches
   * can reach `canAttempt` in the same tick just after the cooldown ends, admitting both
   * would send full traffic to a provider that has not yet proved it recovered.
   */
  it('admits exactly one probe when several callers race the end of the reset window', () => {
    const breaker = build(1, 30_000);
    breaker.recordFailure();

    clock += 30_000;

    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.canAttempt()).toBe(false);
    expect(breaker.canAttempt()).toBe(false);
  });

  it('keeps rejecting while the probe is still in flight, however long it takes', () => {
    const breaker = build(1, 30_000);
    breaker.recordFailure();
    clock += 30_000;
    breaker.canAttempt();

    // Well past a second reset window, elapsed time must not hand out another probe
    // while the first one is unresolved.
    clock += 300_000;

    expect(breaker.canAttempt()).toBe(false);
    expect(breaker.currentState()).toBe('half_open');
  });

  it('admits the next caller once the probe resolves', () => {
    const breaker = build(1, 30_000);
    breaker.recordFailure();
    clock += 30_000;
    breaker.canAttempt();

    breaker.recordSuccess();

    expect(breaker.canAttempt()).toBe(true);
  });

  it('closes fully when the probe succeeds', () => {
    const breaker = build(1, 30_000);
    breaker.recordFailure();
    clock += 30_000;
    breaker.canAttempt();

    breaker.recordSuccess();

    expect(breaker.currentState()).toBe('closed');
    expect(breaker.failureCount()).toBe(0);
  });

  /**
   * The probe exists to answer "has it recovered?". A failed probe answers no, so the
   * circuit re-opens immediately rather than waiting to re-reach the threshold.
   */
  it('re-opens immediately when the probe fails, ignoring the threshold', () => {
    const breaker = build(3, 30_000);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    clock += 30_000;
    breaker.canAttempt();
    expect(breaker.currentState()).toBe('half_open');

    breaker.recordFailure();

    expect(breaker.currentState()).toBe('open');
    expect(breaker.canAttempt()).toBe(false);
  });

  it('restarts the reset window from the re-opening, not the first failure', () => {
    const breaker = build(1, 30_000);
    breaker.recordFailure();
    clock += 30_000;
    breaker.canAttempt();
    breaker.recordFailure();

    clock += 29_999;
    expect(breaker.canAttempt()).toBe(false);

    clock += 1;
    expect(breaker.canAttempt()).toBe(true);
  });

  it('reports state without transitioning it', () => {
    const breaker = build(1, 30_000);
    breaker.recordFailure();
    clock += 60_000;

    // currentState is for diagnostics; only canAttempt drives the state machine.
    expect(breaker.currentState()).toBe('open');
    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.currentState()).toBe('half_open');
  });

  it('returns to a clean closed state on reset', () => {
    const breaker = build(1);
    breaker.recordFailure();

    breaker.reset();

    expect(breaker.currentState()).toBe('closed');
    expect(breaker.failureCount()).toBe(0);
    expect(breaker.canAttempt()).toBe(true);
  });
});
