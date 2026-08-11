import { expect, test } from '@playwright/test';

/**
 * The one thing jsdom cannot tell us: does this work in a real browser?
 *
 * Deliberately a single test covering the whole happy path rather than several granular
 * ones. Its job is to catch the failures that only appear in a browser, hydration
 * mismatches, a stylesheet that never loads, a client-only crash, not to re-test
 * behaviour the component suite already pins.
 */
test('a user can search and compare fares', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/');

  // The page heading, not the brand in the header. The brand is a span on purpose: an h1
  // belongs to the page's subject, and a site name repeated on every route is not that.
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Compare the same flight/);
  await expect(page.getByRole('banner').getByText('Polaris')).toBeVisible();

  // The airport list loads client-side, so the form appears once it arrives.
  const from = page.getByRole('combobox', { name: /^From/ });
  await expect(from).toBeEnabled();

  await from.click();
  await page.getByRole('option', { name: /Delhi/ }).click();

  await page.getByRole('combobox', { name: /^To/ }).click();
  await page
    .getByRole('option', { name: /Mumbai/ })
    .first()
    .click();

  await page.getByRole('button', { name: /Search flights/ }).click();

  // A real flight card, with a real price, from a real API response.
  const firstCard = page.getByRole('article').first();
  await expect(firstCard).toBeVisible({ timeout: 30_000 });
  await expect(firstCard).toContainText('₹');

  // Provider status is always reported, whether every provider answered or not.
  await expect(page.getByText(/providers responded|Showing results from/)).toBeVisible();

  // Filtering narrows without a round trip. Asserted unconditionally: an `if (visible)`
  // guard here would let the whole check disappear the day the control is renamed, and
  // report success for having tested nothing.
  const nonStop = page.getByRole('checkbox', { name: /Non-stop only/ });
  await expect(nonStop).toBeVisible();

  const before = await page.getByRole('article').count();
  await nonStop.check();
  await expect(nonStop).toBeChecked();
  expect(await page.getByRole('article').count()).toBeLessThanOrEqual(before);

  // Sorting re-orders the list.
  await page.getByLabel(/Sort by/).selectOption('price');
  await expect(page.getByRole('article').first()).toBeVisible();

  // Hydration mismatches and client crashes surface here and nowhere else.
  expect(consoleErrors).toEqual([]);
});
