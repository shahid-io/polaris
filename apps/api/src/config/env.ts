import { z } from 'zod';

/**
 * Environment is validated at boot with the same Zod approach used for API contracts.
 *
 * Failing fast on a malformed or missing variable is deliberate: the alternative is a
 * provider silently returning zero offers at demo time because a key was absent, which
 * looks like a bug in the aggregation rather than a configuration problem.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_CORS_ORIGIN: z.string().default('http://localhost:3000'),

  /**
   * Per-provider ceiling. One slow provider must never hold up the whole search.
   *
   * This is now a real measure of one provider's work. Browser sessions are serialised per
   * host rather than globally, so providers run concurrently and a provider's budget is
   * spent searching rather than waiting behind another seller's page. Measured live on
   * DEL-BOM: roughly 3-5s each, in parallel.
   *
   * 20s leaves generous headroom over that for a cold browser launch and a slow network.
   * The cost is that a genuinely dead provider is waited on for 20s, which is bounded, runs
   * concurrently with the others, and is stopped from recurring by the circuit breaker.
   */
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(300),

  /**
   * Shorter lifetime for a search where some provider failed.
   *
   * A cached response carries the provider statuses alongside the offers, so caching a
   * timeout at the full TTL would suppress the retry for five minutes: the second search
   * is served from cache, never reaches the fan-out, and the circuit breaker, the
   * component whose actual job is deciding when to stop calling a broken provider, is
   * never consulted. A transient blip would look like a five-minute outage.
   *
   * 30s is short enough that the failed provider is retried while the user is still
   * looking at the page, and long enough that the providers that *did* answer are not
   * re-fetched on every keystroke, which matters against a live source capped at 250
   * searches a month.
   */
  CACHE_PARTIAL_TTL_SECONDS: z.coerce.number().int().nonnegative().default(30),

  CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),
  CIRCUIT_RESET_MS: z.coerce.number().int().positive().default(30_000),

  /**
   * MongoDB connection string for search analytics.
   *
   * Optional. Absent means analytics is disabled and every search still works, the app
   * must run on a clean checkout with nothing else started.
   */
  MONGODB_URI: z.string().optional(),

  /**
   * Demo failure injection, as comma-separated `provider:mode` pairs,
   * e.g. `cleartrip:timeout,ixigo:error`. Modes: `error`, `timeout`, `empty`.
   *
   * The brief requires unavailable providers and partial results to be handled, and they
   * are, but a behaviour nobody can trigger is a behaviour nobody can see. Waiting for a
   * real outage mid-walkthrough is not a plan, and pulling the network takes down every
   * provider at once, which demonstrates total failure rather than partial results.
   *
   * Explicit configuration rather than a random failure rate: a demonstration whose key
   * moment depends on a coin toss is not a demonstration.
   */
  SIMULATED_FAILURES: z.string().optional(),

  /**
   * Travel agencies to read from their own public search.
   *
   * Comma-separated ids, or `all`. Supported: `cleartrip`, `easemytrip`, `ixigo`.
   * MakeMyTrip and Goibibo are absent because both refuse automated clients at their CDN
   * edge, which was measured rather than assumed, see docs/INTEGRATIONS.md.
   *
   * **Omitting this enables all of them**, because they are the only providers whose prices
   * can be checked against the seller that quoted them. Turning them off is the decision
   * that should have to be made deliberately. Set it to an empty string to do so; the app
   * then registers no providers at all and every search returns an empty result.
   *
   * Requires Chromium (`pnpm exec playwright install chromium`). Without it each agency
   * reports `skipped`, the same treatment as a missing API key.
   */
  BROWSER_PROVIDERS: z.string().optional(),

  /**
   * Where browser-backed providers take their data from.
   *
   * Defaults to `hybrid`: drive the live session, fall back to a recording when it fails,
   * and label the result as replayed rather than current.
   */
  BROWSER_PROVIDER_MODE: z.enum(['live', 'fixture', 'hybrid']).default('hybrid'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  return result.data;
}
