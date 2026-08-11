import { describe, expect, it } from 'vitest';
import {
  canonicalKeyForItinerary,
  canonicalKeyForOffer,
  canonicalKeyForSegment,
} from './canonical-key';
import { buildItinerary, buildOffer, buildSegment, istTime } from './testing/builders';

describe('canonicalKeyForSegment', () => {
  it('identifies a flight by carrier, number, local date and route', () => {
    const key = canonicalKeyForSegment(buildSegment());

    expect(key).toBe('6E-2134-2026-08-20-DEL-BOM');
  });

  it('gives the same key regardless of which provider supplied the segment', () => {
    // The whole point: identity belongs to the flight, not the seller.
    const a = buildSegment();
    const b = buildSegment();

    expect(canonicalKeyForSegment(a)).toBe(canonicalKeyForSegment(b));
  });

  it('separates the same flight number on different dates', () => {
    const monday = buildSegment({ departure: istTime('2026-08-20T06:15') });
    const tuesday = buildSegment({ departure: istTime('2026-08-21T06:15') });

    expect(canonicalKeyForSegment(monday)).not.toBe(canonicalKeyForSegment(tuesday));
  });

  it('separates different flight numbers on the same route and date', () => {
    const a = buildSegment({ flightNumber: '2134' });
    const b = buildSegment({ flightNumber: '5217' });

    expect(canonicalKeyForSegment(a)).not.toBe(canonicalKeyForSegment(b));
  });

  it('separates the same flight number operated by different carriers', () => {
    const indigo = buildSegment({ marketingCarrier: '6E' });
    const airIndiaExpress = buildSegment({ marketingCarrier: 'IX' });

    expect(canonicalKeyForSegment(indigo)).not.toBe(canonicalKeyForSegment(airIndiaExpress));
  });

  /**
   * The regression this design exists to prevent.
   *
   * A 00:45 IST departure is 19:15Z the PREVIOUS day. If the key were built from the UTC
   * date, this single flight would key as 2026-08-19 and split into a separate group from
   * any provider that reported it in local time — silently, and only on red-eye flights.
   */
  it('keys an after-midnight departure to its local date, not the UTC date', () => {
    const redEye = buildSegment({
      departure: istTime('2026-08-20T00:45'),
      arrival: istTime('2026-08-20T02:55'),
    });

    expect(redEye.departure.utc.startsWith('2026-08-19')).toBe(true);
    expect(canonicalKeyForSegment(redEye)).toBe('6E-2134-2026-08-20-DEL-BOM');
  });

  it('does not shift the date based on the machine timezone', () => {
    // String slicing rather than Date parsing — a server in UTC and a laptop in IST
    // must produce byte-identical keys.
    const midnight = buildSegment({ departure: istTime('2026-08-20T00:00') });

    expect(canonicalKeyForSegment(midnight)).toContain('2026-08-20');
  });
});

describe('canonicalKeyForItinerary', () => {
  it('uses the bare segment key for a non-stop, keeping keys readable', () => {
    expect(canonicalKeyForItinerary(buildItinerary())).toBe('6E-2134-2026-08-20-DEL-BOM');
  });

  it('joins every leg for a connecting itinerary', () => {
    const connecting = buildItinerary({
      segments: [
        buildSegment({ origin: 'DEL', destination: 'BOM' }),
        buildSegment({
          flightNumber: '778',
          origin: 'BOM',
          destination: 'GOI',
          departure: istTime('2026-08-20T10:00'),
          arrival: istTime('2026-08-20T11:15'),
        }),
      ],
    });

    expect(canonicalKeyForItinerary(connecting)).toBe(
      '6E-2134-2026-08-20-DEL-BOM|6E-778-2026-08-20-BOM-GOI',
    );
  });

  it('separates journeys that share endpoints but connect differently', () => {
    const viaBom = buildItinerary({
      segments: [
        buildSegment({ origin: 'DEL', destination: 'BOM' }),
        buildSegment({ flightNumber: '778', origin: 'BOM', destination: 'GOI' }),
      ],
    });
    const viaHyd = buildItinerary({
      segments: [
        buildSegment({ flightNumber: '445', origin: 'DEL', destination: 'HYD' }),
        buildSegment({ flightNumber: '901', origin: 'HYD', destination: 'GOI' }),
      ],
    });

    expect(canonicalKeyForItinerary(viaBom)).not.toBe(canonicalKeyForItinerary(viaHyd));
  });

  it('separates a non-stop from a connecting flight on the same route', () => {
    const nonStop = buildItinerary();
    const connecting = buildItinerary({
      segments: [
        buildSegment({ origin: 'DEL', destination: 'HYD' }),
        buildSegment({ flightNumber: '901', origin: 'HYD', destination: 'BOM' }),
      ],
    });

    expect(canonicalKeyForItinerary(nonStop)).not.toBe(canonicalKeyForItinerary(connecting));
  });
});

describe('canonicalKeyForOffer', () => {
  it('matches offers from different providers selling one flight', () => {
    const itinerary = buildItinerary();
    const viaMakeMyTrip = buildOffer({ providerId: 'makemytrip', itinerary, priceInr: 5499 });
    const viaGoibibo = buildOffer({ providerId: 'goibibo', itinerary, priceInr: 5299 });
    const direct = buildOffer({ providerId: 'indigo', itinerary, priceInr: 5199 });

    const keys = new Set([viaMakeMyTrip, viaGoibibo, direct].map(canonicalKeyForOffer));

    expect(keys.size).toBe(1);
  });

  it('matches different fare families of the same flight', () => {
    // SAVER and FLEXI are distinct offers, but they are the same marketed flight and
    // belong in one group so the user sees the full price range for that departure.
    const itinerary = buildItinerary();
    const saver = buildOffer({ itinerary, fareFamily: 'SAVER', priceInr: 5199 });
    const flexi = buildOffer({ itinerary, fareFamily: 'FLEXI', priceInr: 7499 });

    expect(canonicalKeyForOffer(saver)).toBe(canonicalKeyForOffer(flexi));
  });
});
