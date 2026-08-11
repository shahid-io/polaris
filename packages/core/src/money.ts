import type { Money } from '@polaris/contracts';

/**
 * @packageDocumentation
 * Integer money arithmetic.
 *
 * Amounts are integer minor units (paise for INR), so every operation here is exact,
 * no float drift in cross-provider price spreads. The module's other job is to refuse to
 * compare amounts in different currencies rather than silently produce a meaningless
 * number.
 */

/**
 * Thrown when two amounts in different currencies are compared or combined.
 *
 * Preferred over coercion or a silent zero: a mixed-currency result set means an adapter
 * is mapping prices wrongly, and that should surface loudly rather than as a subtly wrong
 * "cheapest" badge.
 */
export class CurrencyMismatchError extends Error {
  /**
   * @param a - Currency code of the left operand.
   * @param b - Currency code of the right operand.
   */
  constructor(a: string, b: string) {
    super(`Cannot compare money in different currencies: ${a} vs ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

/**
 * Guards that two amounts share a currency.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @throws {CurrencyMismatchError} When the currencies differ.
 * @internal
 */
function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
}

/**
 * Subtracts one amount from another.
 *
 * @param a - Amount to subtract from.
 * @param b - Amount to subtract.
 * @returns `a - b`, in the shared currency. May be negative.
 * @throws {CurrencyMismatchError} When the currencies differ.
 */
export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

/**
 * Strict less-than comparison.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns `true` when `a` is strictly cheaper than `b`.
 * @throws {CurrencyMismatchError} When the currencies differ.
 */
export function isLessThan(a: Money, b: Money): boolean {
  assertSameCurrency(a, b);
  return a.amountMinor < b.amountMinor;
}

/**
 * Finds the smallest amount.
 *
 * @param amounts - Non-empty list of amounts in one currency.
 * @returns The lowest amount.
 * @throws {Error} When `amounts` is empty.
 * @throws {CurrencyMismatchError} When the currencies differ.
 */
export function minOf(amounts: readonly Money[]): Money {
  const [first, ...rest] = amounts;
  if (!first) throw new Error('minOf requires at least one amount');
  return rest.reduce((lowest, next) => (isLessThan(next, lowest) ? next : lowest), first);
}

/**
 * Finds the largest amount.
 *
 * @param amounts - Non-empty list of amounts in one currency.
 * @returns The highest amount.
 * @throws {Error} When `amounts` is empty.
 * @throws {CurrencyMismatchError} When the currencies differ.
 */
export function maxOf(amounts: readonly Money[]): Money {
  const [first, ...rest] = amounts;
  if (!first) throw new Error('maxOf requires at least one amount');
  return rest.reduce((highest, next) => (isLessThan(highest, next) ? next : highest), first);
}

/**
 * Adds amounts together.
 *
 * @param amounts - Non-empty list of amounts in one currency.
 * @returns Their total.
 * @throws {Error} When `amounts` is empty.
 * @throws {CurrencyMismatchError} When the currencies differ.
 */
export function sum(amounts: readonly Money[]): Money {
  const [first, ...rest] = amounts;
  if (!first) throw new Error('sum requires at least one amount');
  return rest.reduce((total, next) => {
    assertSameCurrency(total, next);
    return { amountMinor: total.amountMinor + next.amountMinor, currency: total.currency };
  }, first);
}

/**
 * Expresses one amount as a percentage of another.
 *
 * Used for the headline "prices vary by 5.8% across providers" figure.
 *
 * @param part - The amount to express, e.g. a price delta.
 * @param base - The reference amount, e.g. the cheapest price.
 * @returns Percentage rounded to one decimal place. Returns `0` when `base` is zero.
 * @throws {CurrencyMismatchError} When the currencies differ.
 *
 * @example
 * ```ts
 * percentageOf({ amountMinor: 30_000, currency: 'INR' },
 *              { amountMinor: 519_900, currency: 'INR' }); // 5.8
 * ```
 */
export function percentageOf(part: Money, base: Money): number {
  assertSameCurrency(part, base);
  if (base.amountMinor === 0) return 0;
  return Math.round((part.amountMinor / base.amountMinor) * 1000) / 10;
}
