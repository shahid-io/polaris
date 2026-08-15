import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  WEB_SESSION_SITE_IDS,
  WebSessionProvider,
  cleartripSite,
  closeBrowser,
  easeMyTripSite,
  ixigoSite,
  webSessionFixtureFileName,
} from '../packages/providers/dist/index.js';

const SITES = { cleartrip: cleartripSite, easemytrip: easeMyTripSite, ixigo: ixigoSite };

/**
 * Records travel-agency search responses to `fixtures/` for offline replay.
 *
 * A browser session is the most fragile thing in this system: it needs a working network,
 * an installed Chromium, and a third party's page to be unchanged since the last time
 * anyone looked. Recording is what lets the capability be demonstrated without the
 * demonstration depending on all three holding at once.
 *
 * Because a recording is only ever valid for the exact date it was captured for, the date
 * you record has to be the date you intend to search, hence a script rather than a one-off.
 *
 * It drives a real site, so it runs one route at a time and skips anything already recorded.
 *
 * Usage:
 *   node scripts/record-web-fixtures.mjs --date 2026-08-28
 *   node scripts/record-web-fixtures.mjs --date 2026-08-28 --sites cleartrip,ixigo
 *   node scripts/record-web-fixtures.mjs --date 2026-08-28 --routes DEL-BOM,DEL-BLR --force
 */

const FIXTURE_DIR = new URL('../fixtures/', import.meta.url).pathname;

/** The demo route plus the ones a viewer is most likely to try. */
const DEFAULT_ROUTES = ['DEL-BOM', 'DEL-BLR', 'BOM-GOI', 'DEL-HYD'];

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg?.startsWith('--')) {
    const next = process.argv[i + 1];
    args.set(arg.slice(2), next && !next.startsWith('--') ? next : 'true');
  }
}

const date = args.get('date');
const force = args.get('force') === 'true';
const routes = (args.get('routes') ?? DEFAULT_ROUTES.join(',')).split(',').map((r) => r.trim());
const sites = (args.get('sites') ?? WEB_SESSION_SITE_IDS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter((s) => SITES[s]);

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(
    'Usage: node scripts/record-web-fixtures.mjs --date YYYY-MM-DD [--sites cleartrip,...] [--routes DEL-BOM,...] [--force]',
  );
  process.exit(1);
}

await mkdir(FIXTURE_DIR, { recursive: true });
const existing = new Set(await readdir(FIXTURE_DIR));

const fileNameFor = (site, origin, destination) =>
  webSessionFixtureFileName(site, origin, destination, date);

let recorded = 0;
let attempted = 0;

for (const siteId of sites) {
  const site = SITES[siteId];
  console.log(`\n== ${site.displayName}`);

  for (const route of routes) {
    const [origin, destination] = route.split('-');
    if (!force && existing.has(fileNameFor(siteId, origin, destination))) {
      console.log(`  ${route}  already recorded`);
      continue;
    }

    attempted += 1;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 70_000);
    const query = {
      origin,
      destination,
      departureDate: date,
      passengers: 1,
      cabinClass: 'economy',
    };
    const ctx = { signal: controller.signal, searchId: 'record', now: new Date() };

    try {
      const body = await captureRaw(site, query, ctx);
      if (!body) {
        console.log(`  ${route}  no search response, not recorded`);
        continue;
      }

      await writeFile(join(FIXTURE_DIR, fileNameFor(siteId, origin, destination)), body);

      // Map it immediately, so a recording that cannot be normalised is caught here rather
      // than at demo time. A file that parses but yields no offers is not a usable fixture.
      const result = await new WebSessionProvider(site, 'fixture').search(query, ctx);
      const carriers = new Set(
        result.offers.map((o) => o.itinerary.segments[0]?.marketingCarrier),
      );
      console.log(
        `  ${route}  ${result.offers.length} offers · carriers ${[...carriers].sort().join(' ')}` +
          (result.droppedOfferCount ? ` · ${result.droppedOfferCount} dropped` : ''),
      );
      if (result.offers.length > 0) recorded += 1;
    } catch (error) {
      console.error(`  ${route}  FAILED: ${error.message}`);
    } finally {
      clearTimeout(deadline);
    }
  }
}

await closeBrowser();
console.log(`\nRecorded ${recorded} of ${attempted} attempted fixture(s).`);

/**
 * Captures a site's raw search response body.
 *
 * The raw text is stored rather than the parsed object, because Ixigo's payload is an
 * event stream and only the site's own parser knows how to read it back.
 */
async function captureRaw(site, query, ctx) {
  const { withPage } = await import('../packages/providers/dist/index.js');
  const url = site.buildUrl({
    origin: query.origin,
    destination: query.destination,
    departureDate: query.departureDate,
    adults: query.passengers,
    cabinClass: query.cabinClass,
  });

  return withPage(async ({ page }) => {
    const awaited = page.waitForResponse(
      (r) => r.status() === 200 && site.matchesSearchResponse(r.url(), r.request().method()),
      { timeout: 45_000 },
    );
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const response = await awaited.catch(() => undefined);
    return response ? response.text() : undefined;
  }, ctx.signal);
}
