import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, resolving Tailwind conflicts.
 *
 * `clsx` handles conditionals and falsy values; `twMerge` resolves collisions so a caller's
 * `className` genuinely overrides a component's default rather than both landing in the
 * class list and letting stylesheet order decide.
 *
 * @param inputs - Class values, conditionals or arrays.
 * @returns One merged class string.
 *
 * @example
 * ```ts
 * cn('px-4 py-2', isActive && 'bg-primary', className)
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats an integer minor-unit amount as Indian rupees.
 *
 * Prices cross the wire as integer paise, see the `Money` contract, so every display
 * path converts here rather than each component dividing by 100 and hoping.
 *
 * @param amountMinor - Amount in paise.
 * @param options - Formatting options.
 * @param options.showDecimals - Include paise. Off by default: fares are quoted in whole
 *   rupees and trailing `.00` on every price is noise.
 * @returns A formatted string, e.g. `₹5,499`.
 *
 * @example
 * ```ts
 * formatRupees(549_900);                        // "₹5,499"
 * formatRupees(549_950, { showDecimals: true }); // "₹5,499.50"
 * ```
 */
export function formatRupees(
  amountMinor: number,
  options: { showDecimals?: boolean } = {},
): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: options.showDecimals ? 2 : 0,
    maximumFractionDigits: options.showDecimals ? 2 : 0,
  }).format(amountMinor / 100);
}

/**
 * Formats a duration in minutes as `2h 05m`.
 *
 * @param totalMinutes - Duration in minutes.
 * @returns A compact duration string. Durations under an hour omit the hours part.
 *
 * @example
 * ```ts
 * formatDuration(125); // "2h 05m"
 * formatDuration(45);  // "45m"
 * ```
 */
export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/**
 * Extracts the wall-clock time from a local datetime.
 *
 * Deliberately a string slice rather than a `Date`. The value is offset-less local time at
 * the airport; constructing a `Date` would reinterpret it in the *browser's* timezone, so a
 * user in London would see Indian departure times shifted by five and a half hours.
 *
 * @param localDateTime - Local datetime, e.g. `2026-08-20T06:15:00`.
 * @returns `HH:MM`.
 */
export function formatLocalTime(localDateTime: string): string {
  return localDateTime.slice(11, 16);
}

/**
 * Formats a calendar date for display.
 *
 * @param isoDate - `YYYY-MM-DD`.
 * @returns e.g. `Thu, 20 Aug 2026`.
 */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  // Date.UTC, then read back in UTC, the same reason as formatLocalTime.
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));

  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Indicates whether an arrival falls on a later calendar day than its departure.
 *
 * A 21:55 departure arriving 00:05 needs a `+1` marker, or the flight reads as though it
 * lands two hours before it leaves.
 *
 * @param departureLocal - Local departure datetime.
 * @param arrivalLocal - Local arrival datetime.
 * @returns Days gained, `0` when the flight lands the same day.
 */
export function dayOffset(departureLocal: string, arrivalLocal: string): number {
  const departureDate = departureLocal.slice(0, 10);
  const arrivalDate = arrivalLocal.slice(0, 10);
  if (departureDate === arrivalDate) return 0;

  const oneDayMs = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(arrivalDate) - Date.parse(departureDate)) / oneDayMs);
}
