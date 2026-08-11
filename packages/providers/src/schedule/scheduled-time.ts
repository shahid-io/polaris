import type { ScheduledTime } from '@polaris/contracts';
import type { Airport } from './airports';

/**
 * Builds a {@link ScheduledTime} from a local date, a local time and the airport.
 *
 * All three representations are produced together, local wall clock, the same instant in
 * UTC, and the IANA zone, because downstream code needs different ones and picking the
 * wrong one is the subtlest bug in the system. The canonical key needs the local date; a
 * duration calculation needs UTC.
 *
 * @param isoDate - Local calendar date at the airport, `YYYY-MM-DD`.
 * @param localTime - Local wall-clock time, `HH:MM`.
 * @param airport - The airport, supplying the offset and zone.
 * @returns The time in all three forms.
 *
 * @example
 * ```ts
 * toScheduledTime('2026-08-20', '00:45', delhi);
 * // { local: '2026-08-20T00:45:00',
 * //   utc:   '2026-08-19T19:15:00Z',   ← note the previous day
 * //   timeZone: 'Asia/Kolkata' }
 * ```
 */
export function toScheduledTime(
  isoDate: string,
  localTime: string,
  airport: Airport,
): ScheduledTime {
  const [year, month, day] = isoDate.split('-').map(Number);
  const [hours, minutes] = localTime.split(':').map(Number);

  // Treat the local wall clock as if it were UTC, then subtract the offset to recover the
  // true instant. Date.UTC avoids the host timezone influencing the result at all.
  const asIfUtcMs = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0);
  const trueInstantMs = asIfUtcMs - airport.utcOffsetMinutes * 60_000;

  return {
    local: `${isoDate}T${pad(hours ?? 0)}:${pad(minutes ?? 0)}:00`,
    utc: `${new Date(trueInstantMs).toISOString().slice(0, 19)}Z`,
    timeZone: airport.timeZone,
  };
}

/**
 * Advances a scheduled time, rolling the local date over midnight where needed.
 *
 * Used to derive an arrival from a departure plus a duration. A 21:55 departure with a
 * 130-minute block time arrives at 00:05 the *next* local day, and the returned local date
 * reflects that, which matters because an arrival-sorted list would otherwise place it
 * before every morning flight.
 *
 * @param from - Starting time.
 * @param minutes - Minutes to add.
 * @param airport - Airport the resulting time is local to. May differ from the origin's.
 * @returns The advanced time, in all three forms.
 */
export function addMinutes(from: ScheduledTime, minutes: number, airport: Airport): ScheduledTime {
  const instantMs = Date.parse(from.utc) + minutes * 60_000;
  const localMs = instantMs + airport.utcOffsetMinutes * 60_000;
  const asLocal = new Date(localMs);

  const isoDate = asLocal.toISOString().slice(0, 10);
  const localTime = `${pad(asLocal.getUTCHours())}:${pad(asLocal.getUTCMinutes())}`;

  return {
    local: `${isoDate}T${localTime}:00`,
    utc: `${new Date(instantMs).toISOString().slice(0, 19)}Z`,
    timeZone: airport.timeZone,
  };
}

/**
 * Zero-pads a number to two digits.
 *
 * @param value - Number to pad.
 * @returns Two-character string.
 * @internal
 */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}
