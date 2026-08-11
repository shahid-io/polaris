import { readdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
// gifenc ships CommonJS, so its exports arrive on the default binding rather than as
// named ESM exports.
import gifenc from 'gifenc';
import sharp from 'sharp';

const { GIFEncoder, quantize, applyPalette } = gifenc;

/**
 * Assembles the captured frames into an animated GIF.
 *
 * Deliberately no ffmpeg. Requiring a system install to produce a README asset means the
 * asset cannot be regenerated on a machine that lacks it, including CI. sharp is already
 * present as a Next.js dependency and gifenc is a few kilobytes, so this runs anywhere the
 * repository installs.
 *
 * Usage: node scripts/make-gif.mjs [--width 900] [--delay 700]
 */

const FRAME_DIR = new URL('../.demo-frames/', import.meta.url).pathname;
const OUTPUT = new URL('../../../docs/demo.gif', import.meta.url).pathname;

const args = new Map(
  process.argv.slice(2).reduce((pairs, arg, index, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);

// 900px keeps text legible at README width without tripling the file size.
const WIDTH = Number(args.get('width') ?? 900);
const DELAY_MS = Number(args.get('delay') ?? 700);

const files = (await readdir(FRAME_DIR)).filter((f) => f.endsWith('.png')).sort();

if (files.length === 0) {
  console.error('No frames found. Run `pnpm demo:capture` first.');
  process.exit(1);
}

console.log(`Encoding ${files.length} frames at ${WIDTH}px…`);

const encoder = GIFEncoder();
let palette;

for (const [index, file] of files.entries()) {
  const { data, info } = await sharp(join(FRAME_DIR, file))
    .resize({ width: WIDTH })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // One palette, derived from the first frame and reused. Re-quantising every frame would
  // make flat surfaces shimmer as the palette shifts between them, and a shared palette
  // also lets the encoder store far less per frame.
  palette ??= quantize(data, 256, { format: 'rgb565' });

  encoder.writeFrame(applyPalette(data, palette, 'rgb565'), info.width, info.height, {
    palette: index === 0 ? palette : undefined,
    delay: DELAY_MS,
    // Frames are full redraws, so each replaces the last rather than compositing.
    dispose: 2,
  });
}

encoder.finish();

const gif = Buffer.from(encoder.bytes());
await writeFile(OUTPUT, gif);
await rm(FRAME_DIR, { recursive: true, force: true });

const megabytes = (gif.length / 1024 / 1024).toFixed(2);
console.log(`Wrote docs/demo.gif: ${files.length} frames, ${megabytes} MB`);

if (gif.length > 10 * 1024 * 1024) {
  console.warn('Over 10 MB. Re-run with a smaller --width, or hold fewer frames.');
}
