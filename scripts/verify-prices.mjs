import {
  WEB_SESSION_SITE_IDS,
  WebSessionProvider,
  cleartripSite,
  closeBrowser,
  easeMyTripSite,
  ixigoSite,
  withPage,
} from '../packages/providers/dist/index.js';

/**
 * Checks Polaris's prices against what each seller's own page displays.
 *
 * This is the answer to "can you prove these prices are correct?" as a command rather than
 * an argument. It runs a real search, then independently opens each seller's results page,
 * reads the fares a human would see, and reports every flight where the two disagree.
 *
 * ### Why it reads the rendered page and not the JSON
 * The adapters work by capturing the JSON a site's own front end receives. If this harness
 * did the same it would be comparing the pipeline against itself and would pass even if
 * every mapping were wrong. Reading the rendered text is the only check with teeth: it
 * verifies the whole chain, capture through normalisation, against what the seller actually
 * shows a customer.
 *
 * That makes this script deliberately fragile in a way the product is not. It depends on
 * page layout, and it is supposed to: when a seller redesigns, this should start failing
 * and tell you to go and look.
 *
 * ### What "agree" means
 * A results page lists the cheapest fare per flight, while Polaris holds every fare family.
 * So the comparison is the lowest Polaris price for a flight against the one price the page
 * shows for it. Flights the page does not show, because the list is paginated or lazily
 * rendered, are reported as unchecked rather than counted either way.
 *
 * ### Non-stop itineraries only
 * A flight number identifies a journey only when that journey is non-stop. A connection
 * renders both of its leg numbers, so keying on either one pairs a price with something
 * that may not be the same journey at all, and the harness would report disagreements that
 * are its own fault. This is the same reason the canonical key treats marketed flights
 * rather than legs as the unit of identity.
 *
 * Usage:
 *   pnpm verify:prices --route DEL-BOM --date 2026-08-27
 *   pnpm verify:prices --route DEL-BOM --date 2026-08-27 --sites cleartrip
 *   pnpm verify:prices --route DEL-BOM --date 2026-08-27 --tolerance 0
 */

const SITES = { cleartrip: cleartripSite, easemytrip: easeMyTripSite, ixigo: ixigoSite };

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg?.startsWith('--')) {
    const next = process.argv[i + 1];
    args.set(arg.slice(2), next && !next.startsWith('--') ? next : 'true');
  }
}

const route = args.get('route') ?? 'DEL-BOM';
const date = args.get('date');
const sites = (args.get('sites') ?? WEB_SESSION_SITE_IDS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter((s) => SITES[s]);

/**
 * Rupees of disagreement tolerated before a flight counts as a mismatch.
 *
 * Defaults to zero. A fare is an exact number, and "close enough" is precisely the
 * standard this harness exists to refuse. It is configurable only so a genuine rounding
 * question can be investigated without editing the script.
 */
const tolerance = Number(args.get('tolerance') ?? 0);

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(
    'Usage: pnpm verify:prices --date YYYY-MM-DD [--route DEL-BOM] [--sites cleartrip,...] [--tolerance 0]',
  );
  process.exit(1);
}

const [origin, destination] = route.split('-');
const query = {
  origin,
  destination,
  departureDate: date,
  passengers: 1,
  cabinClass: 'economy',
};

/** Matches a line that is nothing but a price, with or without the currency symbol. */
const PRICE_LINE = /^₹?\s*([\d,]{3,})$/;

/** Matches a line that is nothing but a flight designator, however the site punctuates it. */
const FLIGHT_LINE = /^\(?([A-Z0-9]{2})[\s-]?(\d{2,4})\)?$/;

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
function readDisplayedFares(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const fares = new Map();

  for (const [index, line] of lines.entries()) {
    const flight = FLIGHT_LINE.exec(line);
    if (!flight) continue;

    const key = `${flight[1]}-${Number(flight[2])}`;
    let nonStop = false;

    for (let ahead = index + 1; ahead < Math.min(lines.length, index + PRICE_WINDOW); ahead += 1) {
      if (NON_STOP_LINE.test(lines[ahead])) {
        nonStop = true;
        continue;
      }

      const price = PRICE_LINE.exec(lines[ahead]);
      if (!price) continue;

      // Every one of these sites prints the stop count between the flight number and the
      // fare, so by the time a price appears it is known whether this row is a connection.
      if (!nonStop) break;

      const minor = Number(price[1].replace(/,/g, '')) * 100;
      // A page can list one flight several times across fare tabs; keep the lowest, which
      // is what its own summary row shows.
      if (!fares.has(key) || minor < fares.get(key)) fares.set(key, minor);
      break;
    }
  }

  return fares;
}

/**
 * Lowest price Polaris holds per flight for one provider.
 *
 * @param offers - That provider's normalised offers.
 * @returns Lowest total in paise, keyed the same way as {@link readDisplayedFares}.
 */
function lowestQuotedFares(offers) {
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

const rupees = (minor) => `₹${(minor / 100).toLocaleString('en-IN')}`;

console.log(`\nVerifying ${route} on ${date} against each seller's own page\n`);

let totalChecked = 0;
let totalMismatched = 0;
const report = [];

for (const siteId of sites) {
  const site = SITES[siteId];
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 90_000);
  const ctx = { signal: controller.signal, searchId: 'verify', now: new Date() };

  try {
    // 1. What Polaris says, through the ordinary pipeline.
    const result = await new WebSessionProvider(site, 'live').search(query, ctx);
    const quoted = lowestQuotedFares(result.offers);

    // 2. What the seller's page shows, read independently of that pipeline.
    const url = site.buildUrl({
      origin,
      destination,
      departureDate: date,
      adults: 1,
      cabinClass: 'economy',
    });
    const text = await withPage(async ({ page }) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      // No response to await here: the point is what finished rendering, not what arrived.
      await page.waitForTimeout(20_000);

      // These lists render lazily, so a page left alone shows a handful of flights and the
      // check silently covers almost nothing. Scrolling to the bottom is what a person
      // comparing prices would do, and it is the difference between verifying six flights
      // and verifying a hundred.
      //
      // Two wrinkles, both learned by measuring rather than assuming. Ixigo scrolls an
      // inner container, not the window, so scrolling the page moves nothing: whichever
      // element actually overflows is scrolled instead. And its list is virtualised,
      // rendering only the rows near the viewport and discarding the rest, so the text is
      // accumulated at every step. Reading once at the bottom would see the last few
      // flights and nothing else.
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
        // Stopped moving: the end of the list, or nothing scrollable to begin with.
        if (position === previousPosition && pass > 3) break;
        previousPosition = position;
        await page.waitForTimeout(1_000);
      }

      return seen.join('\n');
    }, controller.signal);
    const displayed = readDisplayedFares(text);

    // 3. Compare, on flights both sides actually have.
    const comparable = [...quoted.keys()].filter((key) => displayed.has(key));
    const mismatches = comparable.filter(
      (key) => Math.abs(quoted.get(key) - displayed.get(key)) > tolerance * 100,
    );

    totalChecked += comparable.length;
    totalMismatched += mismatches.length;

    const status = mismatches.length === 0 ? 'PASS' : 'FAIL';
    console.log(
      `${status}  ${site.displayName.padEnd(11)} ${String(comparable.length).padStart(3)} flights checked, ` +
        `${mismatches.length} mismatched  (${quoted.size} quoted, ${displayed.size} on page)`,
    );

    for (const key of mismatches) {
      const delta = quoted.get(key) - displayed.get(key);
      console.log(
        `        ${key.padEnd(9)} Polaris ${rupees(quoted.get(key)).padEnd(9)} ` +
          `page ${rupees(displayed.get(key)).padEnd(9)} ${delta > 0 ? '+' : ''}${rupees(delta)}`,
      );
    }

    // Flights the page never rendered. Not a failure, but worth seeing: if this is most of
    // them, the check is thinner than the headline number suggests.
    const unchecked = quoted.size - comparable.length;
    if (unchecked > 0) {
      console.log(`        ${unchecked} flights not shown on the rendered page, unchecked`);
    }

    report.push({ site: siteId, checked: comparable.length, mismatched: mismatches.length });
  } catch (error) {
    console.log(`ERROR ${site.displayName.padEnd(11)} ${error.message}`);
    report.push({ site: siteId, error: error.message });
  } finally {
    clearTimeout(deadline);
  }
}

await closeBrowser();

const failed = report.some((entry) => entry.error || entry.mismatched > 0);
console.log(
  `\n${totalChecked} flights checked across ${report.length} sellers, ${totalMismatched} mismatched.`,
);
console.log(
  failed
    ? 'FAILED. Every price Polaris shows should be the price the seller shows.\n'
    : 'PASSED. Every checked price matches the seller’s own page.\n',
);

process.exit(failed ? 1 : 0);
