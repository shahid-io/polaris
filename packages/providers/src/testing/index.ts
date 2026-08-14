/**
 * @packageDocumentation
 * Deterministic provider fakes, for tests only.
 *
 * These generate offers rather than fetching them, which is exactly what the application
 * must never ship: a generated fare shown under a real seller's name is the failure the
 * product exists to prevent, and no badge makes it acceptable.
 *
 * They remain because the alternative is worse. Partial results, per-provider timeouts and
 * the circuit breaker cannot be tested against live third-party sites: those paths need a
 * provider that fails exactly when asked, and a real one cannot be made to. Keeping the
 * fakes behind a separate entry point, absent from the package's main barrel, is what makes
 * the distinction structural rather than a matter of remembering.
 *
 * Nothing in `apps/` may import this.
 */
export * from './seeded-random';
export * from './flight-schedule';
export * from './representative-provider';
export * from './ota-providers';
