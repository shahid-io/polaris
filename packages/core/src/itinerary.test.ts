import { describe, expect, it } from 'vitest';
import { carriersOn, flyingMinutes, layoversFor, waitingMinutes } from './itinerary';
import { buildItinerary, buildSegment, istTime } from './testing/builders';

const connecting = (arrival: string, nextDeparture: string) =>
  buildItinerary({
    segments: [
      buildSegment({
        origin: 'DEL',
        destination: 'AMD',
        departure: istTime('2026-08-20T00:15'),
        arrival: istTime(arrival),
        durationMinutes: 90,
      }),
      buildSegment({
        flightNumber: '6285',
        origin: 'AMD',
        destination: 'BOM',
        departure: istTime(nextDeparture),
        arrival: istTime('2026-08-20T05:30'),
        durationMinutes: 60,
      }),
    ],
    totalDurationMinutes: 315,
  });

describe('layoversFor', () => {
  it('returns nothing for a non-stop', () => {
    expect(layoversFor(buildItinerary())).toEqual([]);
  });

  it('measures the wait at the connection airport', () => {
    const layovers = layoversFor(connecting('2026-08-20T01:45', '2026-08-20T04:30'));

    expect(layovers).toHaveLength(1);
    expect(layovers[0]!.airport).toBe('AMD');
    expect(layovers[0]!.minutes).toBe(165);
  });

  /**
   * Under an hour leaves no room for a late inbound. A traveller deserves to see that
   * before booking rather than at the gate.
   */
  it('flags a connection under an hour as tight', () => {
    const layovers = layoversFor(connecting('2026-08-20T01:45', '2026-08-20T02:30'));

    expect(layovers[0]!.minutes).toBe(45);
    expect(layovers[0]!.isTight).toBe(true);
    expect(layovers[0]!.isLong).toBe(false);
  });

  it('flags a wait over four hours as long', () => {
    const layovers = layoversFor(connecting('2026-08-20T01:45', '2026-08-20T06:30'));

    expect(layovers[0]!.isLong).toBe(true);
    expect(layovers[0]!.isTight).toBe(false);
  });

  /**
   * Computed from UTC instants, not local wall clocks. Local arithmetic silently assumes
   * both airports share an offset, which is wrong the moment a connection crosses a zone.
   */
  it('derives the wait from instants rather than wall-clock strings', () => {
    const layovers = layoversFor(connecting('2026-08-20T01:45', '2026-08-20T04:30'));
    const expected =
      (Date.parse('2026-08-19T23:00:00Z') - Date.parse('2026-08-19T20:15:00Z')) / 60_000;

    expect(layovers[0]!.minutes).toBe(expected);
  });

  it('handles two connections in order', () => {
    const twoStops = buildItinerary({
      segments: [
        buildSegment({ origin: 'DEL', destination: 'AMD', arrival: istTime('2026-08-20T08:00') }),
        buildSegment({
          flightNumber: '200',
          origin: 'AMD',
          destination: 'HYD',
          departure: istTime('2026-08-20T09:30'),
          arrival: istTime('2026-08-20T11:00'),
        }),
        buildSegment({
          flightNumber: '300',
          origin: 'HYD',
          destination: 'BOM',
          departure: istTime('2026-08-20T13:00'),
          arrival: istTime('2026-08-20T14:15'),
        }),
      ],
    });

    expect(layoversFor(twoStops).map((l) => [l.airport, l.minutes])).toEqual([
      ['AMD', 90],
      ['HYD', 120],
    ]);
  });
});

describe('flyingMinutes and waitingMinutes', () => {
  it('splits a journey into flying and waiting', () => {
    const itinerary = connecting('2026-08-20T01:45', '2026-08-20T04:30');

    expect(flyingMinutes(itinerary)).toBe(150);
    expect(waitingMinutes(itinerary)).toBe(165);
    expect(flyingMinutes(itinerary) + waitingMinutes(itinerary)).toBe(
      itinerary.totalDurationMinutes,
    );
  });

  it('reports no waiting on a non-stop', () => {
    expect(waitingMinutes(buildItinerary())).toBe(0);
  });

  it('never reports negative waiting when a provider total disagrees with its segments', () => {
    // A provider's own total is authoritative, but it can be slightly inconsistent with
    // the segment arithmetic; that must not surface as a negative connection time.
    const inconsistent = buildItinerary({ totalDurationMinutes: 10 });

    expect(waitingMinutes(inconsistent)).toBe(0);
  });
});

describe('carriersOn', () => {
  it('lists one carrier for a single-airline journey', () => {
    expect(carriersOn(buildItinerary())).toEqual(['6E']);
  });

  it('lists each carrier once, in order', () => {
    const mixed = buildItinerary({
      segments: [
        buildSegment({ marketingCarrier: 'IX', origin: 'DEL', destination: 'AMD' }),
        buildSegment({ marketingCarrier: '6E', flightNumber: '200', origin: 'AMD', destination: 'BOM' }),
      ],
    });

    expect(carriersOn(mixed)).toEqual(['IX', '6E']);
  });
});
