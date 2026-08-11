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

  // ── 4. The point of the product: one flight, several sellers ──────────
  const multiSeller = page
    .getByRole('article')
    .filter({ hasText: /Compare \d+ providers/ })
    .first();
  if (await multiSeller.count()) {
    await multiSeller.scrollIntoViewIfNeeded();
    await capture(6);
  }

  // ── 5. Filtering ──────────────────────────────────────────────────────
  const nonStop = page.getByRole('checkbox', { name: /Non-stop only/ });
  if (await nonStop.count()) {
    await nonStop.check();
    await capture(5);
  }

  // ── 6. Sorting ────────────────────────────────────────────────────────
  await page.getByLabel(/Sort by/).selectOption('price');
  await expect(page.getByRole('article').first()).toBeVisible();
  await page.mouse.wheel(0, -400);
  await capture(5);

  // ── 7. Why a flight ranks where it does ───────────────────────────────
  const scoreButton = page.getByRole('button', { name: /Value 0\./ }).first();
  if (await scoreButton.count()) {
    await scoreButton.click();
    await expect(page.getByText(/How this score is calculated/)).toBeVisible();
    await capture(7);
    await page.keyboard.press('Escape');
  }

  expect(frameIndex).toBeGreaterThan(10);
});
