import { expect, test } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Captures the frames for the README demo.
 *
 * Not really a test, it asserts only enough to fail loudly if the flow breaks, so a broken
 * UI produces an error rather than a GIF of an error. Run via `pnpm demo`.
 *
 * Frames are discrete stills rather than a video recording. A GIF assembled from held
 * frames stays readable, each state sits on screen long enough to be understood, and the
 * file is a fraction of the size of a frame-by-frame capture of the same walkthrough.
 */

const FRAME_DIR = join(process.cwd(), '.demo-frames');

// Must match the `--delay` default in scripts/make-gif.mjs. The GIF holds each frame for
// this long, so it is also how long a state has to stay on screen for the video to be
// paced like the GIF.
const FRAME_DELAY_MS = 700;

test('capture the demo walkthrough', async ({ page }) => {
  await rm(FRAME_DIR, { recursive: true, force: true });
  await mkdir(FRAME_DIR, { recursive: true });

  let frameIndex = 0;

  /**
   * Writes one screenshot, repeated to hold it on screen.
   *
   * @param holdFrames - How many identical frames to emit. Longer holds for states a
   *   viewer needs to read; shorter for transitions.
   */
  const capture = async (holdFrames = 1) => {
    const buffer = await page.screenshot();
    for (let i = 0; i < holdFrames; i += 1) {
      await writeFile(join(FRAME_DIR, `${String(frameIndex++).padStart(3, '0')}.png`), buffer);
    }

    // Repeated frames are what pace the GIF, and video recording has no equivalent: it
    // captures wall-clock time, so without a real wait `pnpm demo:video` produces the whole
    // walkthrough at machine speed, every state flashing past unread. Waiting here holds the
    // state on screen for as long as the GIF would. Only under DEMO_VIDEO, so the GIF path
    // stays fast and nothing is added to a run whose output nobody watches.
    if (process.env.DEMO_VIDEO) await page.waitForTimeout(holdFrames * FRAME_DELAY_MS);
  };

  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto('/');

  // The capture runs against `pnpm dev`, so Next paints its dev indicator in the corner.
  // It is not part of the product and does not exist in a production build, but it was
  // being baked into the README's GIF. Hidden here rather than by turning the indicator
  // off globally, which would take it away while actually developing.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });

  // ── 1. Before a search ────────────────────────────────────────────────
  const from = page.getByRole('combobox', { name: /^From/ });
  await expect(from).toBeEnabled();
  await capture(3);

  // ── 2. Choosing a route ───────────────────────────────────────────────
  await from.click();
  await capture(3);
  await page.getByRole('option', { name: /Delhi/ }).click();

  await page.getByRole('combobox', { name: /^To/ }).click();
  await capture(3);
  await page
    .getByRole('option', { name: /Mumbai/ })
    .first()
    .click();
  await capture(2);

  // ── 3. Results ────────────────────────────────────────────────────────
  await page.getByRole('button', { name: /Search flights/ }).click();

  const firstCard = page.getByRole('article').first();
  await expect(firstCard).toBeVisible({ timeout: 30_000 });
  await expect(firstCard).toContainText('₹');
  await capture(6);

  // ── 4. Expanding one flight: the journey and every fare ───────────────
  // The feature the product is built around, and previously absent from the demo. The
  // step it replaces scrolled to a multi-seller card, which was a no-op because the top
  // card already is one, so it spent four seconds re-showing the previous frame.
  // Matches both states: the accessible name flips between "show" and "hide" once open,
  // so a `/show/` pattern finds nothing when it comes time to collapse again.
  const expand = firstCard.getByRole('button', { name: /full journey and all fares/ });
  await expand.click();
  await expect(page.getByText(/Journey/).first()).toBeVisible();
  await page.mouse.wheel(0, 320);
  await capture(6);

  await page.mouse.wheel(0, -320);
  await expand.click();

  // ── 5. Filtering ──────────────────────────────────────────────────────
  // Asserted rather than guarded. Every `if (await x.count())` below was hiding a
  // selector that no longer matched, which is how the score step vanished from the GIF
  // without the capture ever failing.
  const nonStop = page.getByRole('checkbox', { name: /Non-stop only/ });
  await nonStop.check();
  await expect(nonStop).toBeChecked();
  await capture(4);

  // ── 6. Sorting ────────────────────────────────────────────────────────
  await page.getByLabel(/Sort by/).selectOption('price');
  await expect(page.getByRole('article').first()).toBeVisible();
  await page.mouse.wheel(0, -400);
  await capture(4);

  // ── 7. Why a flight ranks where it does ───────────────────────────────
  // The accessible name is "Value score 0.91 of 1. How is this calculated?". The old
  // pattern `/Value 0\./` matched nothing, so this whole step was skipped silently.
  const scoreButton = page.getByRole('button', { name: /Value score/ }).first();
  await scoreButton.click();
  await expect(page.getByText(/How this score is calculated/)).toBeVisible();
  await capture(6);
  await page.keyboard.press('Escape');

  // Guards the flow itself: if a step above stops matching, the count drops and this
  // fails instead of quietly publishing a shorter demo.
  expect(frameIndex).toBeGreaterThanOrEqual(30);
});
