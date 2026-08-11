/**
 * Fails fast when the demo capture has nothing to record.
 *
 * The capture drives the real application, so both servers must already be running. Without
 * this check Playwright reports a selector timeout thirty seconds later, which reads as a
 * broken test rather than a missing server, and sends you looking in the wrong place.
 */
const TARGETS = [
  { name: 'API', url: 'http://localhost:4000/api/health' },
  { name: 'web', url: 'http://localhost:3000' },
];

const down = [];

for (const target of TARGETS) {
  try {
    const response = await fetch(target.url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) down.push(`${target.name} responded ${response.status}`);
  } catch {
    down.push(`${target.name} is not reachable at ${target.url}`);
  }
}

if (down.length > 0) {
  console.error('\nCannot record the demo:\n');
  for (const problem of down) console.error(`  · ${problem}`);
  console.error('\nStart both first, then run this again:\n\n  pnpm dev\n');
  process.exit(1);
}

console.log('Both servers are up, recording.');
