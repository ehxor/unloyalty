import { CAMERA_BARCODE } from './camera';
import { addManualCard, expect, test } from './fixtures';

declare global {
  interface Window {
    /** Every camera track handed to the app, recorded by the blank-camera init script. */
    cameraTracks: MediaStreamTrack[];
    setHidden(hidden: boolean): void;
  }
}

test.describe('with camera permission', () => {
  test.use({ permissions: ['camera'] });

  test('live scan detects the barcode and goes to the name form', async ({ page }) => {
    await page.goto('/add');
    await page.getByRole('link', { name: /Scan with camera/ }).click();
    await expect(page).toHaveURL(/\/add\/confirm$/, { timeout: 15_000 });
    await expect(page.locator('.detected')).toContainText('Code 128');
    await expect(page.locator('.detected')).toContainText(CAMERA_BARCODE);

    await page.getByLabel('Name').fill('Scanned');
    await page.getByRole('button', { name: 'Save card' }).click();
    await expect(page.locator('.barcode-text')).toHaveText(CAMERA_BARCODE);
  });

  test('the camera is released when the page is hidden or the screen is left', async ({ page }) => {
    // A blank camera (no barcode, so nothing navigates away) that records the tracks it hands out,
    // plus a switch for document.visibilityState.
    await page.addInitScript(() => {
      window.cameraTracks = [];
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, 320, 240);
        const stream = canvas.captureStream(10);
        window.cameraTracks.push(...stream.getTracks());
        return stream;
      };
      let hidden = false;
      Object.defineProperty(document, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible') });
      window.setHidden = (h: boolean) => {
        hidden = h;
        document.dispatchEvent(new Event('visibilitychange'));
      };
    });
    const live = () => page.evaluate(() => window.cameraTracks.filter((t) => t.readyState === 'live').length);

    await page.goto('/add/scan');
    await expect(page.getByRole('status')).toHaveText('Point the camera at the barcode');
    await expect.poll(live).toBe(1);

    await page.evaluate(() => window.setHidden(true));
    await expect.poll(live).toBe(0);
    await page.evaluate(() => window.setHidden(false));
    await expect.poll(live).toBe(1);
    expect(await page.evaluate(() => window.cameraTracks.length)).toBe(2);

    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/add$/);
    await expect.poll(live).toBe(0);
  });

  test('re-scan replaces the barcode only after saving', async ({ page }) => {
    await addManualCard(page, { name: 'Library', value: 'OLD-1', format: 'code39' });
    const cardUrl = page.url();
    await page.getByRole('link', { name: 'Edit card' }).click();
    await page.getByRole('link', { name: 'Re-scan barcode' }).click();

    await expect(page).toHaveURL(/\/edit$/, { timeout: 15_000 });
    await expect(page.getByRole('status')).toHaveText('New barcode scanned. Save changes to keep it.');
    await expect(page.getByLabel('Card number')).toHaveValue(CAMERA_BARCODE);
    await expect(page.getByLabel('Barcode type')).toHaveValue('code128');

    // Leaving without saving keeps the old barcode.
    await page.goto(cardUrl);
    await expect(page.locator('.barcode-text')).toHaveText('OLD-1');

    await page.getByRole('link', { name: 'Edit card' }).click();
    await expect(page.getByLabel('Card number')).toHaveValue('OLD-1');
    await page.getByRole('link', { name: 'Re-scan barcode' }).click();
    await expect(page).toHaveURL(/\/edit$/, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.barcode-text')).toHaveText(CAMERA_BARCODE);
  });
});

test('camera denied: explains, and photo and manual entry still work', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await page.goto('/add/scan');
  await expect(page.getByRole('alert')).toContainText('Camera access is blocked');
  await expect(page.getByLabel('Scan from photo')).toBeAttached();

  await page.getByRole('link', { name: /Type it in/ }).click();
  await page.getByLabel('Card number').fill('LIB-42');
  await page.getByLabel('Name').fill('Library');
  await page.getByRole('button', { name: 'Save card' }).click();
  await expect(page.locator('.barcode-text')).toHaveText('LIB-42');
});
