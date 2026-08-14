/**
 * @packageDocumentation
 * Provider adapters and the resilience primitives that isolate their failures.
 *
 * Every provider implements one `FlightProvider` interface regardless of what sits behind
 * it, a third-party API or a provider's own web search. The orchestrator cannot tell them
 * apart, which is why adding a provider touches one array.
 *
 * Nothing exported here generates a price. Every adapter reports what some real source
 * actually quoted, and every offer it produces carries a link back to that source so the
 * number can be checked rather than trusted. Deterministic fakes still exist for tests, but
 * they live in `@polaris/providers/testing` and are deliberately absent from this barrel:
 * a generated fare must not be one import away from being registered as a provider.
 */
export * from './types';
export * from './resilience/circuit-breaker';
export * from './resilience/with-timeout';
export * from './resilience/retry';
export * from './schedule/airports';
export * from './schedule/scheduled-time';
export * from './live/serpapi-client';
export * from './live/serpapi.provider';
export * from './browser/browser-session';
export * from './browser/site-helpers';
export * from './browser/web-session-site';
export * from './browser/web-session.provider';
export * from './browser/sites/cleartrip.site';
export * from './browser/sites/easemytrip.site';
export * from './browser/sites/ixigo.site';
export * from './browser/web-session-providers';
