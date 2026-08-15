import {
  WEB_SESSION_SITE_IDS,
  WebSessionProvider,
  cleartripSite,
  closeBrowser,
  easeMyTripSite,
  ixigoSite,
} from '../packages/providers/dist/index.js';
import {
  gradeOf,
  lowestQuotedFares,
  readDisplayedFares,
  readRenderedPage,
  rupees,
} from './lib/verification.mjs';

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

const EXPLANATION = {
  PASS: 'PASSED. Every quoted fare was compared against the seller\u2019s page and matched.\n',
  WARN: 'PASSED WITH INCOMPLETE COVERAGE. Everything compared matched, but some fares could not be checked.\n',
  INCONCLUSIVE:
    'INCONCLUSIVE. Too little was actually compared for this run to be evidence of anything.\n',
  FAIL: 'FAILED. Every price Polaris shows should be the price the seller shows.\n',
};

let totalChecked = 0;
let totalMismatched = 0;
let totalQuoted = 0;
const report = [];

console.log(`\nVerifying ${route} on ${date} against each seller's own page`);
console.log('Scope: non-stop itineraries only. Connecting itineraries are not verified,');
console.log('because one flight number does not identify a multi-leg journey.\n');


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
    const text = await readRenderedPage(url, controller.signal);

    const { fares: displayed, ambiguous } = readDisplayedFares(text);

    // 3. Compare, on flights both sides have and the page could be read for confidently.
    const comparable = [...quoted.keys()].filter((key) => displayed.has(key));
    const mismatches = comparable.filter(
      (key) => Math.abs(quoted.get(key) - displayed.get(key)) > tolerance * 100,
    );
    const flagged = [...quoted.keys()].filter((key) => ambiguous.has(key));
    const unchecked = quoted.size - comparable.length - flagged.length;
    const coverage = quoted.size === 0 ? 0 : comparable.length / quoted.size;

    totalChecked += comparable.length;
    totalMismatched += mismatches.length;
    totalQuoted += quoted.size;

    const status = gradeOf(mismatches.length, flagged.length, coverage);
    console.log(
      `${status.padEnd(9)} ${site.displayName.padEnd(11)} ` +
        `${String(comparable.length).padStart(3)}/${String(quoted.size).padEnd(4)} verified ` +
        `(${Math.round(coverage * 100)}% coverage), ${mismatches.length} mismatched`,
    );

    for (const key of mismatches) {
      const delta = quoted.get(key) - displayed.get(key);
      console.log(
        `          ${key.padEnd(9)} Polaris ${rupees(quoted.get(key)).padEnd(9)} ` +
          `page ${rupees(displayed.get(key)).padEnd(9)} ${delta > 0 ? '+' : ''}${rupees(delta)}`,
      );
    }

    // Named separately from "not rendered": these are flights the page *did* show and the
    // parser could not read confidently, which is a signal the parser needs attention
    // rather than a signal about coverage.
    if (flagged.length > 0) {
      console.log(
        `          ${flagged.length} flights on the page could not be read confidently: ` +
          `${flagged.slice(0, 6).join(', ')}${flagged.length > 6 ? '…' : ''}`,
      );
    }
    if (unchecked > 0) {
      console.log(`          ${unchecked} flights never rendered, so never compared`);
    }

    report.push({
      site: siteId,
      checked: comparable.length,
      quoted: quoted.size,
      mismatched: mismatches.length,
      ambiguous: flagged.length,
      coverage,
      status,
    });
  } catch (error) {
    console.log(`ERROR     ${site.displayName.padEnd(11)} ${error.message}`);
    report.push({ site: siteId, error: error.message, status: 'ERROR' });
  } finally {
    clearTimeout(deadline);
  }
}

await closeBrowser();

const overall = report.some((entry) => entry.status === 'ERROR' || entry.status === 'FAIL')
  ? 'FAIL'
  : report.some((entry) => entry.status === 'INCONCLUSIVE')
    ? 'INCONCLUSIVE'
    : report.some((entry) => entry.status === 'WARN')
      ? 'WARN'
      : 'PASS';

const coverage = totalQuoted === 0 ? 0 : totalChecked / totalQuoted;

console.log(
  `\n${totalChecked} of ${totalQuoted} non-stop fares verified ` +
    `(${Math.round(coverage * 100)}% coverage), ${totalMismatched} mismatched.`,
);
console.log(EXPLANATION[overall]);

// INCONCLUSIVE exits non-zero deliberately. A run that verified almost nothing is not
// evidence of correctness, and a green tick on 5% coverage is worse than no check at all:
// it converts an unanswered question into a false answer.
process.exit(overall === 'PASS' || overall === 'WARN' ? 0 : 1);
