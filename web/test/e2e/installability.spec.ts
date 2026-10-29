import { expect, test } from './fixtures';

/** Width and height from a PNG's IHDR chunk. */
function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test('Chrome reports the app installable once the service worker controls it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // Chrome's own installability checks (the ones Lighthouse's removed PWA audit used). Playwright contexts are
  // incognito-like, which Chrome always reports; anything else is a real problem with the app.
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: { errorId: string }[] };
  expect(installabilityErrors.filter((e) => e.errorId !== 'in-incognito')).toEqual([]);
});

test('manifest and icons are complete for Android and iOS', async ({ page, request }) => {
  await page.goto('/');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(manifestHref!)).json();
  expect(manifest).toMatchObject({ name: 'Unloyalty', short_name: 'Unloyalty', display: 'standalone', start_url: '/', scope: '/' });
  expect(manifest.theme_color).toMatch(/^#/);
  expect(manifest.background_color).toMatch(/^#/);

  const icons = manifest.icons as { src: string; sizes: string; type: string; purpose?: string }[];
  expect(icons.some((i) => i.sizes === '192x192')).toBe(true);
  expect(icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
  for (const icon of icons) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    const { width, height } = pngSize(await res.body());
    expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
  }

  // iOS ignores manifest icons for the Home Screen in some versions: it needs apple-touch-icon and the meta tags.
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(pngSize(await (await request.get(touchIcon!)).body())).toEqual({ width: 180, height: 180 });
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
});
