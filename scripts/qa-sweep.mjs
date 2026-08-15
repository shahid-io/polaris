import {
  WebSessionProvider,
  cleartripSite,
  closeBrowser,
  easeMyTripSite,
  ixigoSite,
} from '../packages/providers/dist/index.js';
import {
  findOutliers,
  gradeOf,
  lowestQuotedFares,
  readDisplayedFares,
  readRenderedPage,
  rupees,
} from './lib/verification.mjs';

/**
 * Runs the price check across a matrix of routes and dates, and cross-references sellers.
 *
 * `verify:prices` answers "is this route right, now". This answers the question a reviewer
 * actually asks, which is whether the thing is right in general, and it looks for a class
 * of error the single-route check structurally cannot find.
 *
 * ### Why cross-referencing sellers matters
 * Per-seller verification proves Polaris reports what a seller's page says. It cannot
 * prove the seller was read *correctly* in a deeper sense: if a mapper consistently picks
 * the wrong field, it will match the page every time and still produce a wrong comparison.
 *
 * Three independent sellers pricing the same flight is the check on that. When two agree
 * and one is far away, either that seller is genuinely cheaper, which is the entire point
 * of the product, or a mapper is wrong. The sweep cannot tell those apart and does not
 * pretend to: it surfaces the outlier for a human, and only a disagreement with a seller's
 * own page is treated as a failure.
 *
 * Usage:
 *   pnpm qa:sweep
 *   pnpm qa:sweep --routes DEL-BOM,PAT-BLR --dates 2026-08-22,2026-09-05
 *   pnpm qa:sweep --outlier 30
 */

const SITES = [
  ['cleartrip', cleartripSite],
  ['easemytrip', easeMyTripSite],
  ['ixigo', ixigoSite],
];

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg?.startsWith('--')) {
    const next = process.argv[i + 1];
    args.set(arg.slice(2), next && !next.startsWith('--') ? next : 'true');
  }
}

/** Busy domestic routes, chosen to vary in traffic and in how many sellers cover them. */
const DEFAULT_ROUTES = ['DEL-BOM', 'DEL-BLR', 'BOM-BLR', 'PAT-BLR'];

const routes = (args.get('routes') ?? DEFAULT_ROUTES.join(',')).split(',').map((r) => r.trim());
const dates = (args.get('dates') ?? '').split(',').map((d) => d.trim()).filter(Boolean);

/**
 * How far from its peers a seller's price must sit to be worth a human's attention.
 *
 * Calibrated against a real case rather than guessed. EaseMyTrip was observed selling
 * IX-1584 PAT-BLR at ₹8,216 while Cleartrip and Ixigo both had ₹10,736, which is -23.5%.
 * The first default was 25%, and it would have stayed silent through exactly the finding
 * this check exists to surface.
 *
 * 20% keeps that case and still sits well above the ordinary spread between agencies, so
 * genuine findings are not buried under the product working as intended.
 */
const outlierThreshold = Number(args.get('outlier') ?? 20) / 100;

if (dates.length === 0) {
  console.error(
    'Usage: pnpm qa:sweep --dates 2026-08-22,2026-09-05 [--routes DEL-BOM,...] [--outlier 20]',
  );
  process.exit(1);
}

/**
 * Checks one route and date across every seller.
 *
 * @param route - e.g. `DEL-BOM`.
 * @param date - `YYYY-MM-DD`.
 * @returns Per-seller results and cross-seller outliers.
 */
async function sweepOne(route, date) {
  const [origin, destination] = route.split('-');
  const query = { origin, destination, departureDate: date, passengers: 1, cabinClass: 'economy' };
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 180_000);
  const ctx = { signal: controller.signal, searchId: 'qa', now: new Date() };

  /** Lowest quoted fare per flight, per seller, for the cross-reference. */
  const bySeller = new Map();
  const sellerResults = [];

  try {
    // Sellers are independent, and the browser queue is per host, so there is nothing to
    // gain by walking them one at a time.
    await Promise.all(
      SITES.map(async ([id, site]) => {
        try {
          const result = await new WebSessionProvider(site, 'live').search(query, ctx);
          const quoted = lowestQuotedFares(result.offers);
          bySeller.set(id, quoted);

          const text = await readRenderedPage(site.buildUrl({ ...query, adults: 1 }), ctx.signal);
          const { fares: displayed, ambiguous } = readDisplayedFares(text);

          const comparable = [...quoted.keys()].filter((key) => displayed.has(key));
          const mismatches = comparable.filter(
            (key) => quoted.get(key) !== displayed.get(key),
          );
          const flagged = [...quoted.keys()].filter((key) => ambiguous.has(key));
          const coverage = quoted.size === 0 ? 0 : comparable.length / quoted.size;

          sellerResults.push({
            id,
            checked: comparable.length,
            quoted: quoted.size,
            mismatches: mismatches.map((key) => ({
              key,
              polaris: quoted.get(key),
              page: displayed.get(key),
            })),
            ambiguous: flagged.length,
            // A mapper that starts rejecting its own provider's payload is schema drift,
            // and it shows up here long before anyone notices missing flights.
            dropped: result.droppedOfferCount,
            coverage,
            status: gradeOf(mismatches.length, flagged.length, coverage),
          });
        } catch (error) {
          sellerResults.push({ id, error: error.message, status: 'ERROR' });
        }
      }),
    );
  } finally {
    clearTimeout(deadline);
  }

  return { route, date, sellers: sellerResults, outliers: findOutliers(bySeller, outlierThreshold) };
}

// ---------------------------------------------------------------------------

const combinations = routes.flatMap((route) => dates.map((date) => ({ route, date })));

console.log(`\nQA sweep: ${routes.length} routes × ${dates.length} dates × ${SITES.length} sellers`);
console.log('Scope: non-stop itineraries only, compared against each seller’s rendered page.\n');

const all = [];
for (const [index, { route, date }] of combinations.entries()) {
  process.stdout.write(`[${index + 1}/${combinations.length}] ${route} ${date} ... `);
  const result = await sweepOne(route, date);
  all.push(result);

  const failed = result.sellers.filter((s) => s.status === 'FAIL' || s.status === 'ERROR');
  const checked = result.sellers.reduce((sum, s) => sum + (s.checked ?? 0), 0);
  const quoted = result.sellers.reduce((sum, s) => sum + (s.quoted ?? 0), 0);
  console.log(
    `${checked}/${quoted} verified, ${failed.length} seller(s) failing, ${result.outliers.length} outlier(s)`,
  );
}

await closeBrowser();

// --- report -----------------------------------------------------------------

console.log('\n================ MISMATCHES (a real defect) ================');
const mismatched = all.flatMap((r) =>
  r.sellers.flatMap((s) => (s.mismatches ?? []).map((m) => ({ ...m, seller: s.id, ...r }))),
);
if (mismatched.length === 0) console.log('None. Every compared fare matched the seller’s page.');
for (const m of mismatched) {
  console.log(
    `  ${m.route} ${m.date}  ${m.seller.padEnd(11)} ${m.key.padEnd(9)} ` +
      `Polaris ${rupees(m.polaris)} vs page ${rupees(m.page)}`,
  );
}

console.log('\n================ ERRORS ================');
const errors = all.flatMap((r) =>
  r.sellers.filter((s) => s.error).map((s) => ({ ...s, route: r.route, date: r.date })),
);
if (errors.length === 0) console.log('None.');
for (const e of errors) console.log(`  ${e.route} ${e.date}  ${e.id.padEnd(11)} ${e.error}`);

console.log('\n================ SCHEMA DRIFT (offers a mapper rejected) ================');
const drift = all.flatMap((r) =>
  r.sellers.filter((s) => s.dropped > 0).map((s) => ({ ...s, route: r.route, date: r.date })),
);
if (drift.length === 0) console.log('None. Every payload mapped cleanly.');
for (const d of drift) console.log(`  ${d.route} ${d.date}  ${d.id.padEnd(11)} ${d.dropped} dropped`);

console.log('\n================ CROSS-SELLER OUTLIERS (for a human) ================');
console.log('Not failures. Either a genuine bargain, which is the point of the product,');
console.log('or a mapper reading the wrong field. Only a human can tell which.\n');
const outliers = all.flatMap((r) => r.outliers.map((o) => ({ ...o, route: r.route, date: r.date })));
if (outliers.length === 0) console.log('  None.');
for (const o of outliers.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift)).slice(0, 25)) {
  const sign = o.drift > 0 ? '+' : '';
  console.log(
    `  ${o.route} ${o.date}  ${o.seller.padEnd(11)} ${o.flight.padEnd(9)} ` +
      `${rupees(o.price).padEnd(10)} vs peers ${rupees(o.median).padEnd(10)} ${sign}${Math.round(o.drift * 100)}%`,
  );
}

console.log('\n================ PER-SELLER COVERAGE ================');
for (const [id] of SITES) {
  const runs = all.flatMap((r) => r.sellers.filter((s) => s.id === id && !s.error));
  const checked = runs.reduce((sum, s) => sum + s.checked, 0);
  const quoted = runs.reduce((sum, s) => sum + s.quoted, 0);
  const amb = runs.reduce((sum, s) => sum + s.ambiguous, 0);
  console.log(
    `  ${id.padEnd(11)} ${checked}/${quoted} verified ` +
      `(${quoted ? Math.round((checked / quoted) * 100) : 0}%), ${amb} ambiguous, ` +
      `${all.length - runs.length} run(s) failed`,
  );
}

const totalChecked = all.flatMap((r) => r.sellers).reduce((sum, s) => sum + (s.checked ?? 0), 0);
console.log(
  `\n${totalChecked} fares verified across ${combinations.length} route/date combinations. ` +
    `${mismatched.length} mismatched, ${errors.length} errored, ${outliers.length} flagged for review.\n`,
);

// Outliers deliberately do not fail the run: they are a prompt to look, not a verdict.
process.exit(mismatched.length > 0 || errors.length > 0 ? 1 : 0);
