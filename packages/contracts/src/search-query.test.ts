import { describe, expect, it } from 'vitest';
import { searchQuerySchema, TIME_RANGE_PRESETS } from './search-query';

const validQuery = {
  origin: 'DEL',
  destination: 'BOM',
  departureDate: '2026-08-20',
};

describe('searchQuerySchema', () => {
  it('applies defaults for optional fields', () => {
    const parsed = searchQuerySchema.parse(validQuery);

    expect(parsed.passengers).toBe(1);
    expect(parsed.cabinClass).toBe('economy');
    expect(parsed.timeRange).toBeUndefined();
  });

  it('rejects a lowercase airport code rather than silently coercing it', () => {
    // Adapters build cache keys and canonical keys from these values, so casing
    // must be normalised at the edge by the client, not guessed at here.
    const result = searchQuerySchema.safeParse({ ...validQuery, origin: 'del' });

    expect(result.success).toBe(false);
  });

  it('rejects a search from an airport to itself', () => {
    const result = searchQuerySchema.safeParse({ ...validQuery, destination: 'DEL' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['destination']);
    }
  });

  it('rejects a malformed travel date', () => {
    expect(searchQuerySchema.safeParse({ ...validQuery, departureDate: '20-08-2026' }).success).toBe(
      false,
    );
  });

  it('rejects an inverted time range', () => {
    const result = searchQuerySchema.safeParse({
      ...validQuery,
      timeRange: { from: '18:00', to: '06:00' },
    });

    expect(result.success).toBe(false);
  });

  it('accepts every UI time-range preset', () => {
    for (const preset of Object.values(TIME_RANGE_PRESETS)) {
      expect(searchQuerySchema.safeParse({ ...validQuery, timeRange: preset }).success).toBe(true);
    }
  });

  it('caps passengers at the 9 supported by the providers', () => {
    expect(searchQuerySchema.safeParse({ ...validQuery, passengers: 9 }).success).toBe(true);
    expect(searchQuerySchema.safeParse({ ...validQuery, passengers: 10 }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ ...validQuery, passengers: 0 }).success).toBe(false);
  });
});
