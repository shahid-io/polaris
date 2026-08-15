import { describe, expect, it } from 'vitest';
import { buildCacheKey, InMemoryCacheStore } from './cache.store';

const baseQuery = {
  origin: 'DEL',
  destination: 'BOM',
  departureDate: '2026-08-20',
  passengers: 1,
  cabinClass: 'economy',
};

describe('buildCacheKey', () => {
  it('is stable for an identical query', () => {
    expect(buildCacheKey(baseQuery)).toBe(buildCacheKey({ ...baseQuery }));
  });

  /**
   * These are the fields adapters actually read. Any one of them colliding means two
   * different searches share a cached answer and the second silently gets the first's
   * results, the failure this whole test group exists to prevent.
   */
  it.each([
    ['origin', { origin: 'BOM' }],
    ['destination', { destination: 'BLR' }],
    ['departureDate', { departureDate: '2026-08-21' }],
    ['passengers', { passengers: 2 }],
    ['cabinClass', { cabinClass: 'business' }],
    ['providers', { providers: ['ixigo'] }],
  ])('changes when %s changes', (_field, override) => {
    expect(buildCacheKey({ ...baseQuery, ...override })).not.toBe(buildCacheKey(baseQuery));
  });

  it('treats the same providers in a different order as one key', () => {
    const a = buildCacheKey({ ...baseQuery, providers: ['ixigo', 'cleartrip'] });
    const b = buildCacheKey({ ...baseQuery, providers: ['cleartrip', 'ixigo'] });

    expect(a).toBe(b);
  });

  /**
   * Pins the deliberate exclusion documented on buildCacheKey.
   *
   * Adapters fetch a whole day and the preferred window is applied afterwards, so one
   * cached fetch serves every window, which matters against a 250-a-month live quota.
   *
   * If this test ever fails because someone pushed the time window down into an adapter's
   * upstream request, the fix is to ADD timeRange to the key, not to delete this test:
   * otherwise an evening search is served a morning result.
   */
  it('ignores timeRange, because providers fetch the whole day', () => {
    const morning = buildCacheKey({
      ...baseQuery,
      timeRange: { from: '06:00', to: '12:00' },
    } as never);
    const evening = buildCacheKey({
      ...baseQuery,
      timeRange: { from: '18:00', to: '23:59' },
    } as never);

    expect(morning).toBe(evening);
  });
});

describe('InMemoryCacheStore', () => {
  it('stores and returns a value', async () => {
    const cache = new InMemoryCacheStore();
    await cache.set('k', { value: 1 }, 60);

    await expect(cache.get('k')).resolves.toEqual({ value: 1 });
  });

  it('returns undefined for a missing key', async () => {
    await expect(new InMemoryCacheStore().get('nope')).resolves.toBeUndefined();
  });

  it('expires an entry once its ttl has passed', async () => {
    let now = 1_000_000;
    const cache = new InMemoryCacheStore(500, () => now);
    await cache.set('k', 'v', 60);

    now += 59_999;
    await expect(cache.get('k')).resolves.toBe('v');

    now += 1;
    await expect(cache.get('k')).resolves.toBeUndefined();
  });

  it('does not store an entry with a zero ttl', async () => {
    const cache = new InMemoryCacheStore();
    await cache.set('k', 'v', 0);

    await expect(cache.get('k')).resolves.toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('evicts the least recently used entry when full', async () => {
    const cache = new InMemoryCacheStore(2);
    await cache.set('a', 1, 60);
    await cache.set('b', 2, 60);

    // Reading 'a' makes 'b' the least recently used.
    await cache.get('a');
    await cache.set('c', 3, 60);

    expect(cache.size()).toBe(2);
    await expect(cache.get('b')).resolves.toBeUndefined();
    await expect(cache.get('a')).resolves.toBe(1);
    await expect(cache.get('c')).resolves.toBe(3);
  });

  it('refreshes recency when a key is overwritten', async () => {
    const cache = new InMemoryCacheStore(2);
    await cache.set('a', 1, 60);
    await cache.set('b', 2, 60);
    await cache.set('a', 11, 60);

    await cache.set('c', 3, 60);

    // 'b' was least recently touched, so it goes rather than the rewritten 'a'.
    await expect(cache.get('b')).resolves.toBeUndefined();
    await expect(cache.get('a')).resolves.toBe(11);
  });

  it('clears every entry', async () => {
    const cache = new InMemoryCacheStore();
    await cache.set('a', 1, 60);

    await cache.clear();

    expect(cache.size()).toBe(0);
  });
});
