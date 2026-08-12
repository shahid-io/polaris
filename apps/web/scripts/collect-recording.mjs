import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Collects the artefacts left by `demo:video` into one folder.
 *
 * Playwright writes video into a per-test directory under `test-results/` and names it by
 * a hash, which is not something anyone wants to go hunting through. This moves the video
 * and the full-resolution stills somewhere predictable and prints the path.
 *
 * The output is deliberately not committed: it is a local artefact for screen-sharing or
 * slides. The README's GIF stays the version-controlled one.
 */

const RESULTS = join(process.cwd(), 'test-results');
const FRAMES = join(process.cwd(), '.demo-frames');
const OUT = join(process.cwd(), '..', '..', 'recordings');

await mkdir(OUT, { recursive: true });

/** @returns Every file under a directory, recursively. */
async function walk(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push(full);
  }
  return found;
}

// Local time rather than `toISOString`, which is UTC: the whole point of stamping the name
// is that you can match it against the clock you recorded at.
const now = new Date();
const stamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
  String(now.getHours()).padStart(2, '0'),
  String(now.getMinutes()).padStart(2, '0'),
].join('-');

const videos = (await walk(RESULTS)).filter((f) => f.endsWith('.webm'));

if (videos.length === 0) {
  console.error('No video found. Run `pnpm demo:video`, which sets DEMO_VIDEO=1.');
  process.exit(1);
}

const videoOut = join(OUT, `polaris-demo-${stamp}.webm`);
await rename(videos[0], videoOut);

// Full-resolution stills, before the GIF encoder downscales to 900px and 256 colours.
//
// Deduplicated. `capture(n)` writes n byte-identical copies of a frame so the GIF holds
// that state on screen, which is right for the encoder and pure noise in a folder you are
// picking slides out of: the last run wrote 37 files covering 9 distinct states. Keeps the
// first of each and renumbers, so the sequence still reads in walkthrough order.
const stillsOut = join(OUT, `polaris-stills-${stamp}`);
let stillCount = 0;
try {
  const stills = (await readdir(FRAMES)).filter((f) => f.endsWith('.png')).sort();
  const seen = new Set();
  for (const file of stills) {
    const buffer = await readFile(join(FRAMES, file));
    const digest = createHash('sha1').update(buffer).digest('hex');
    if (seen.has(digest)) continue;
    seen.add(digest);
    if (stillCount === 0) await mkdir(stillsOut, { recursive: true });
    await writeFile(join(stillsOut, `${String(stillCount).padStart(2, '0')}.png`), buffer);
    stillCount += 1;
  }
} catch {
  // Stills are a bonus; a missing frame directory is not a failure.
}

await rm(RESULTS, { recursive: true, force: true });
await rm(FRAMES, { recursive: true, force: true });

const { size } = await stat(videoOut);
// No resolution printed here on purpose: playwright.config.ts owns it, and repeating the
// number is how the previous version came to claim 1440x900 after the config had changed.
console.log(`Video  ${videoOut}  (${(size / 1024 / 1024).toFixed(2)} MB)`);
if (stillCount > 0) console.log(`Stills ${stillsOut}  (${stillCount} distinct frames)`);
