/**
 * @packageDocumentation
 * Provider adapters and the resilience primitives that isolate their failures.
 *
 * Every provider implements one `FlightProvider` interface regardless of what sits behind
 * it — a live API, a vendor sandbox, or deterministic representative data. The orchestrator
 * cannot tell them apart, which is why adding a provider touches one array.
 */
export * from './types';
export * from './resilience/circuit-breaker';
export * from './resilience/with-timeout';
export * from './resilience/retry';
export * from './schedule/airports';
export * from './schedule/flight-schedule';
export * from './schedule/scheduled-time';
export * from './representative/seeded-random';
export * from './representative/representative-provider';
export * from './representative/ota-providers';
