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

  /**
   * Regression. The pattern alone accepts any four-two-two digit string, so days that do
   * not exist passed validation and reached the providers as a real search.
   */
  it.each(['2026-02-31', '2026-13-01', '2026-00-10', '2026-04-31'])(
    'rejects %s, which matches the pattern but is not a date',
    (departureDate) => {
      expect(searchQuerySchema.safeParse({ ...validQuery, departureDate }).success).toBe(false);
    },
  );

  it('accepts a leap day in a leap year and rejects it otherwise', () => {
    expect(searchQuerySchema.safeParse({ ...validQuery, departureDate: '2028-02-29' }).success).toBe(
      true,
    );
    expect(searchQuerySchema.safeParse({ ...validQuery, departureDate: '2026-02-29' }).success).toBe(
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

  describe('provider selection', () => {
    it('accepts known provider ids', () => {
      expect(
        searchQuerySchema.safeParse({ ...validQuery, providers: ['indigo', 'goibibo'] }).success,
      ).toBe(true);
    });

    /**
     * Regression. This previously accepted any string, so a typo passed validation, matched
     * no provider, and produced a successful-looking response in which nothing had actually
     * been searched — a silent wrong answer instead of a 400 naming the bad value.
     */
    it('rejects an unknown provider id rather than searching nothing', () => {
      const result = searchQuerySchema.safeParse({
        ...validQuery,
        providers: ['makemytrp'],
      });

      expect(result.success).toBe(false);
    });

    it('rejects an empty provider list', () => {
      // "search no providers" and "search all providers" must not be spelled the same way.
      expect(searchQuerySchema.safeParse({ ...validQuery, providers: [] }).success).toBe(false);
    });
  });

  it('caps passengers at the 9 supported by the providers', () => {
    expect(searchQuerySchema.safeParse({ ...validQuery, passengers: 9 }).success).toBe(true);
    expect(searchQuerySchema.safeParse({ ...validQuery, passengers: 10 }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ ...validQuery, passengers: 0 }).success).toBe(false);
  });
});
