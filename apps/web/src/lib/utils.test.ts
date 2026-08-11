import { describe, expect, it } from 'vitest';
import { dayOffset, formatDate, formatDuration, formatLocalTime, formatRupees } from './utils';

describe('formatRupees', () => {
  it('renders integer paise as whole rupees with Indian grouping', () => {
    // 5,499 not 5,499.00 — fares are quoted whole, and trailing zeros on every price
    // are noise in a column of numbers.
    expect(formatRupees(549_900)).toBe('₹5,499');
  });

  it('groups lakhs the Indian way, not in thousands', () => {
    // en-IN groups as 12,34,567 rather than 1,234,567. Getting this wrong is subtle
    // enough to survive a glance at the UI.
    expect(formatRupees(1_234_567_00)).toBe('₹12,34,567');
  });

  it('shows paise only when asked', () => {
    expect(formatRupees(549_950, { showDecimals: true })).toBe('₹5,499.50');
  });
});

describe('formatDuration', () => {
  it('renders hours and zero-padded minutes', () => {
    expect(formatDuration(125)).toBe('2h 05m');
  });

  it('omits the hours part under an hour', () => {
    expect(formatDuration(45)).toBe('45m');
  });
});

describe('formatLocalTime', () => {
  /**
   * The browser-side twin of the canonical-key timezone rule.
   *
   * The value is offset-less wall-clock time at the departure airport. Parsing it into a
   * Date would reinterpret it in the *viewer's* timezone, so someone in London would see
   * every Indian departure shifted by five and a half hours. Slicing the string is what
   * makes the displayed time independent of who is looking.
   */
  it('reads the wall clock without reinterpreting it in the viewer timezone', () => {
    expect(formatLocalTime('2026-08-20T06:15:00')).toBe('06:15');
  });

  it('keeps an after-midnight departure at its local time', () => {
    expect(formatLocalTime('2026-08-20T00:45:00')).toBe('00:45');
  });
});

describe('dayOffset', () => {
  it('is zero when the flight lands the same day', () => {
    expect(dayOffset('2026-08-20T06:15:00', '2026-08-20T08:20:00')).toBe(0);
  });

  it('is one for an overnight arrival', () => {
    // Without this, a 21:55 departure arriving 00:05 reads as landing before it left.
    expect(dayOffset('2026-08-20T21:55:00', '2026-08-21T00:05:00')).toBe(1);
  });
});

describe('formatDate', () => {
  it('formats a calendar date without shifting it', () => {
    expect(formatDate('2026-08-20')).toContain('20');
    expect(formatDate('2026-08-20')).toContain('Aug');
  });
});
