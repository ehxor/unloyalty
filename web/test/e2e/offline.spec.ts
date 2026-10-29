import { addManualCard, expect, test } from './fixtures';

test('saved cards open and render with no network', async ({ page, context }) => {
  await page.goto('/');
  // Wait until the service worker has installed and controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await addManualCard(page, { name: 'Library', value: 'LIB-42', format: 'code39' });
  const cardUrl = page.url();
  await addManualCard(page, { name: 'Gym', value: 'member:9981', format: 'qr' });

  await context.setOffline(true);

  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Library' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Gym' })).toBeVisible();

  // Deep link straight to a card: served by the SW navigation fallback.
  await page.goto(cardUrl);
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  const img = page.locator('.barcode img');
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

  await page.getByRole('link', { name: 'Close' }).click();
  await page.getByRole('link', { name: 'Gym' }).click();
  await expect(page.locator('.barcode-2d img')).toBeVisible();
});
