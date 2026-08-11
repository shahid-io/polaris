import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Records SerpApi responses to `fixtures/` for offline replay.
 *
 * Fixtures are what let a demonstration survive a dropped network or an exhausted quota,
 * and what make the adapter's tests deterministic. Because a recording is only ever used
 * for the exact date it was captured for, the date you record has to be the date you
 * intend to search — hence this script rather than a one-off command.
 *
 * **Each route costs one SerpApi credit** against a free tier of 250 a month, so it
 * reports what it is about to spend and skips anything already recorded.
 *
 * Usage:
 *   node scripts/record-fixtures.mjs --date 2026-08-27
 *   node scripts/record-fixtures.mjs --date 2026-08-27 --routes DEL-BOM,DEL-BLR
 *   node scripts/record-fixtures.mjs --date 2026-08-27 --force
 */

const FIXTURE_DIR = new URL('../fixtures/', import.meta.url).pathname;

/** Routes worth having offline: the demo route plus the ones a viewer is likely to try. */
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

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('Usage: node scripts/record-fixtures.mjs --date YYYY-MM-DD [--routes DEL-BOM,...] [--force]');
  process.exit(1);
}

// Read the key from the root .env without pulling in a dependency.
process.loadEnvFile(new URL('../.env', import.meta.url).pathname);
const apiKey = process.env.SERPAPI_KEY;

if (!apiKey) {
  console.error('SERPAPI_KEY is not set in .env — nothing to record against.');
  process.exit(1);
}

await mkdir(FIXTURE_DIR, { recursive: true });
const existing = new Set(await readdir(FIXTURE_DIR));

const fileNameFor = (origin, destination) =>
  `serpapi-${origin.toLowerCase()}-${destination.toLowerCase()}-${date}.json`;

const planned = routes.filter((route) => {
  const [origin, destination] = route.split('-');
  return force || !existing.has(fileNameFor(origin, destination));
});

const skipped = routes.length - planned.length;
console.log(`Recording ${planned.length} route(s) for ${date}${skipped ? ` (${skipped} already recorded)` : ''}`);
console.log(`This will spend ${planned.length} of your 250 monthly SerpApi credits.\n`);

let recorded = 0;

for (const route of planned) {
  const [origin, destination] = route.split('-');

  const query = new URLSearchParams({
    engine: 'google_flights',
    departure_id: origin,
    arrival_id: destination,
    outbound_date: date,
    adults: '1',
    travel_class: '1',
    type: '2',
    currency: 'INR',
    hl: 'en',
    gl: 'in',
    api_key: apiKey,
  });

  try {
    const response = await fetch(`https://serpapi.com/search.json?${query}`);
    const body = await response.json();

    // SerpApi reports quota exhaustion and bad parameters as a 200 with an error field,
    // so a successful status is not enough to know the recording is usable.
    if (body.error) throw new Error(body.error);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const flights = [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
    if (flights.length === 0) {
      console.log(`  ${route}  no flights returned — not recorded`);
      continue;
    }

    await writeFile(
      join(FIXTURE_DIR, fileNameFor(origin, destination)),
      `${JSON.stringify(body, null, 2)}\n`,
    );

    const carriers = new Set(flights.map((f) => f.flights[0]?.flight_number?.split(' ')[0]));
    console.log(`  ${route}  ${flights.length} itineraries · carriers ${[...carriers].join(' ')}`);
    recorded += 1;
  } catch (error) {
    console.error(`  ${route}  FAILED — ${error.message}`);
  }
}

console.log(`\nRecorded ${recorded} fixture(s). Credits spent: ${recorded}.`);
