/**
 * A time-limited key-value store.
 *
 * Declared as an interface so the implementation is a deployment decision rather than an
 * architectural one. The in-memory store below is right for a prototype demoed on one
 * machine; swapping it for Redis when there is more than one API instance means providing
 * another implementation of this interface and changing one line in the module, no caller
 * changes at all.
 */
export interface CacheStore {
  /**
   * Reads a value.
   *
   * @typeParam T - Expected value type.
   * @param key - Cache key.
   * @returns The value, or `undefined` when absent or expired.
   */
  get<T>(key: string): Promise<T | undefined>;

  /**
   * Writes a value.
   *
   * @param key - Cache key.
   * @param value - Value to store.
   * @param ttlSeconds - Lifetime. A value of 0 disables caching for this entry.
   */
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;

  /** Empties the store. Intended for tests and administrative reset. */
  clear(): Promise<void>;

  /** @returns Current entry count, for the health endpoint and diagnostics. */
  size(): number;
}

/** Injection token: consumers depend on the interface, never on a concrete store. */
export const CACHE_STORE = Symbol('CACHE_STORE');

interface CacheEntry {
  value: unknown;
  expiresAtMs: number;
}

/**
 * In-memory cache with LRU eviction and per-entry expiry.
 *
 * ### Why this is worth having at all
 * Flight searches are expensive and repetitive: a user toggling filters, going back, or
 * re-running the same route hits identical provider calls. On the live SerpApi adapter the
 * cache also protects a hard monthly quota of 250 searches, without it, a demo could
 * plausibly exhaust the free tier during rehearsal.
 *
 * ### Eviction
 * Least-recently-used, exploiting the fact that JavaScript `Map` preserves insertion order:
 * re-inserting a key on read moves it to the end, so the oldest entry is always first.
 * That keeps eviction O(1) without a second data structure.
 */
export class InMemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>();

  /**
   * @param maxEntries - Ceiling before least-recently-used entries are evicted. Bounded
   *   deliberately: an unbounded cache keyed on user input is a memory leak that only
   *   shows up under real traffic.
   * @param now - Injected clock, so expiry can be tested without waiting.
   */
  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAtMs <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Re-insert to mark as most recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;

    // Delete first so an overwrite also refreshes recency rather than keeping its old slot.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAtMs: this.now() + ttlSeconds * 1000 });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

/**
 * Builds a stable cache key from a search request.
 *
 * Field order is fixed explicitly rather than relying on `JSON.stringify` of the object,
 * whose output depends on property insertion order, two identical searches arriving with
 * differently-ordered JSON would otherwise miss the cache and cost a full provider fan-out.
 *
 * ### The invariant
 * **The key must contain every field that changes what providers return.** Anything a
 * provider reads but the key omits means two different searches share one cached answer,
 * and the second silently receives the first's results.
 *
 * What providers currently read: origin, destination, departureDate, passengers,
 * cabinClass: all present, plus `providers`, which selects which adapters run.
 *
 * ### Why `timeRange` is deliberately absent
 * It is not a provider input. Adapters fetch a whole day for a route, and the preferred
 * departure window is applied afterwards in the domain layer, so one cached fetch serves a
 * morning search, an evening search and an unfiltered one alike. That matters against a
 * live source capped at 250 searches a month.
 *
 * **If a future adapter ever narrows its upstream request by time, this key must gain
 * `timeRange` in the same change**, otherwise an evening search will be served a morning
 * result. Guarded by a test in `cache.store.test.ts`.
 *
 * Filters and sort are excluded for the same reason: the cached value is the full
 * unfiltered result set, so narrowing is served from the same entry.
 *
 * @param query - The validated search query.
 * @returns A deterministic key.
 *
 * @example
 * ```ts
 * buildCacheKey(query); // "search:DEL:BOM:2026-08-20:1:economy:all"
 * ```
 */
export function buildCacheKey(query: {
  origin: string;
  destination: string;
  departureDate: string;
  passengers: number;
  cabinClass: string;
  providers?: string[];
}): string {
  // Sorted, so requesting the same providers in a different order is the same key.
  const providers = query.providers?.length ? [...query.providers].sort().join(',') : 'all';

  return [
    'search',
    query.origin,
    query.destination,
    query.departureDate,
    query.passengers,
    query.cabinClass,
    providers,
  ].join(':');
}
