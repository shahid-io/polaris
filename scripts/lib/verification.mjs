import { withPage } from '../../packages/providers/dist/index.js';

/**
 * @packageDocumentation
 * Reading fares off a seller's rendered results page, and comparing them to what Polaris
 * quoted.
 *
 * Shared by the single-route check and the sweep so the two cannot drift into disagreeing
 * about what "verified" means. A sweep that graded more leniently than the focused check
 * would be worse than no sweep: it would report health across a matrix while the one
 * command anyone actually runs said otherwise.
 */

/** Matches a line that is nothing but a price, with or without the currency symbol. */
const PRICE_LINE = /^₹?\s*([\d,]{3,})$/;

/** Matches a line that is nothing but a flight designator, however the site punctuates it. */
const FLIGHT_LINE = /^\(?([A-Z0-9]{2})[\s-]?(\d{2,4})\)?$/;

/**
 * Bounds on a believable domestic fare, in paise.
 *
 * A number outside this range is far more likely to be something else the window happened
 * to catch, a passenger count, a loyalty balance, a distance, than a price. Refusing it is
 * cheaper than explaining a phantom mismatch.
 */
const PLAUSIBLE_FARE_MIN = 50_000;
const PLAUSIBLE_FARE_MAX = 50_000_000;

/** A journey the page itself describes as having no stops. */
const NON_STOP_LINE = /^non[-\s]?stop$/i;

/**
 * How far below a flight number to look for its fare.
 *
 * Every one of these sites renders the same way: airline, flight number, times, duration,
 * then price. Ten lines covers that with room to spare, and stops well short of the next
 * card, so a flight cannot inherit its neighbour's fare.
 */
const PRICE_WINDOW = 10;

/**
 * Reads the fares a person would see on a seller's results page.
 *
 * Takes the *first* price following each flight number, which is the fare. Promotional
 * lines ("Extra ₹350 Off", "Lock Price @₹239") always follow it, so first-wins is what
 * separates the fare from the marketing around it.
 *
 * @param text - The page's rendered innerText.
 * @returns Lowest displayed fare per flight, in paise, keyed `6E-2134`.
 */
export function readDisplayedFares(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  /** Every distinct price this parse associated with a flight, across all scroll passes. */
  const candidates = new Map();
  /** Flights seen as non-stop rows where no price could be read at all. */
  const unreadable = new Set();

  for (const [index, line] of lines.entries()) {
    const flight = FLIGHT_LINE.exec(line);
    if (!flight) continue;

    const key = `${flight[1]}-${Number(flight[2])}`;
    let nonStop = false;
    let read = false;

    for (let ahead = index + 1; ahead < Math.min(lines.length, index + PRICE_WINDOW); ahead += 1) {
      if (NON_STOP_LINE.test(lines[ahead])) {
        nonStop = true;
        continue;
      }

      const price = PRICE_LINE.exec(lines[ahead]);
      if (!price) continue;

      // Every one of these sites prints the stop count between the flight number and the
      // fare, so by the time a price appears it is known whether this row is a connection.
      // A connection is out of scope, not a parse failure.
      if (!nonStop) {
        read = true;
        break;
      }

      const minor = Number(price[1].replace(/,/g, '')) * 100;
      // Outside any plausible domestic fare. Far more likely a stray number captured by the
      // window than a real price, so it is not allowed to stand in for one.
      if (minor < PLAUSIBLE_FARE_MIN || minor > PLAUSIBLE_FARE_MAX) break;

      if (!candidates.has(key)) candidates.set(key, new Set());
      candidates.get(key).add(minor);
      read = true;
      break;
    }

    // A non-stop row whose price could not be read is a parse failure, and saying nothing
    // about it would quietly shrink the denominator until the check verified almost
    // nothing while still reporting a pass.
    if (nonStop && !read) unreadable.add(key);
  }

  const fares = new Map();
  const ambiguous = new Set(unreadable);

  for (const [key, prices] of candidates) {
    // The page is read repeatedly as it scrolls, so a flight is normally seen several
    // times and must show the same fare every time. Disagreement means the association
    // between a flight and a price is not reliable, and the honest response is to refuse
    // to score it rather than pick one and hope.
    if (prices.size === 1) fares.set(key, [...prices][0]);
    else ambiguous.add(key);
  }

  return { fares, ambiguous };
}

/**
 * Lowest price Polaris holds per flight for one provider.
 *
 * @param offers - That provider's normalised offers.
 * @returns Lowest total in paise, keyed the same way as {@link readDisplayedFares}.
 */
export function lowestQuotedFares(offers) {
  const fares = new Map();

  for (const offer of offers) {
    // Only non-stop journeys, matching what the page side can identify unambiguously.
    if (offer.itinerary.stops !== 0) continue;

    const segment = offer.itinerary.segments[0];
    const key = `${segment.marketingCarrier}-${Number(segment.flightNumber)}`;
    const minor = offer.price.total.amountMinor;
    if (!fares.has(key) || minor < fares.get(key)) fares.set(key, minor);
  }

  return fares;
}


/**
 * Loads a seller's results page and returns everything it rendered.
 *
 * These lists load lazily, and at least one is virtualised inside an inner scroll
 * container, so the window scrolls nothing and rows are discarded as they leave the
 * viewport. Whichever element actually overflows is scrolled, and the text is accumulated
 * at every step rather than read once at the bottom.
 *
 * @param url - The seller's results URL.
 * @param signal - Cancellation.
 * @returns Rendered text from every scroll position, concatenated.
 */
export async function readRenderedPage(url, signal) {
  return withPage(
    async ({ page }) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(20_000);

      const SCROLL_STEP = `
        (() => {
          const panes = Array.from(document.querySelectorAll('*')).filter(
            (el) => el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 300,
          );
          if (panes.length === 0) {
            window.scrollBy(0, 2000);
            return document.body.scrollHeight;
          }
          panes.forEach((el) => { el.scrollTop += 2000; });
          return panes.reduce((most, el) => Math.max(most, el.scrollTop), 0);
        })()
      `;

      const seen = [];
      let previousPosition = -1;
      for (let pass = 0; pass < 40; pass += 1) {
        seen.push(await page.locator('body').innerText({ timeout: 15_000 }));

        const position = await page.evaluate(SCROLL_STEP);
        if (position === previousPosition && pass > 3) break;
        previousPosition = position;
        await page.waitForTimeout(1_000);
      }

      return seen.join('\n');
    },
    signal,
    // Per host, so different sellers are read concurrently while each is asked one thing
    // at a time.
    new URL(url).host,
  );
}

/** Formats paise for display. */
export const rupees = (minor) => `₹${(minor / 100).toLocaleString('en-IN')}`;

/**
 * Coverage below which a run is not evidence of anything.
 *
 * Verifying eight flights out of a hundred and reporting a pass would be worse than
 * reporting nothing: it turns an unanswered question into a false answer.
 */
export const MIN_COVERAGE = 0.6;

/** Coverage below which a pass is real but worth qualifying out loud. */
export const GOOD_COVERAGE = 0.9;

/**
 * Grades one seller's run.
 *
 * @param mismatches - Flights where the two prices disagreed.
 * @param ambiguous - Flights on the page the parser could not read confidently.
 * @param coverage - Fraction of quoted flights actually compared.
 * @returns One of PASS, WARN, INCONCLUSIVE, FAIL.
 */
export function gradeOf(mismatches, ambiguous, coverage) {
  if (mismatches > 0) return 'FAIL';
  if (coverage < MIN_COVERAGE) return 'INCONCLUSIVE';
  if (coverage < GOOD_COVERAGE || ambiguous > 0) return 'WARN';
  return 'PASS';
}

/**
 * Finds flights where one seller's price sits far from its peers.
 *
 * Needs at least three sellers on a flight: with two, "far apart" says nothing about which
 * one is unusual, and flagging both would be noise.
 *
 * @param bySeller - Lowest fare per flight, keyed by seller.
 * @returns One entry per flight worth a human look.
 */
export function findOutliers(bySeller, threshold) {
  const flights = new Map();

  for (const [seller, fares] of bySeller) {
    for (const [flight, minor] of fares) {
      if (!flights.has(flight)) flights.set(flight, []);
      flights.get(flight).push({ seller, minor });
    }
  }

  const found = [];
  for (const [flight, quotes] of flights) {
    if (quotes.length < 3) continue;

    for (const quote of quotes) {
      const peers = quotes.filter((other) => other.seller !== quote.seller);
      // Compared against the peers' median rather than their mean, so one wild value
      // cannot drag the baseline towards itself and hide the very thing being looked for.
      const median = medianOf(peers.map((peer) => peer.minor));
      if (median === 0) continue;

      const drift = (quote.minor - median) / median;
      if (Math.abs(drift) >= threshold) {
        found.push({ flight, seller: quote.seller, price: quote.minor, median, drift });
      }
    }
  }

  return found;
}

/** Middle value, averaging the two middles on an even count. */
function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

