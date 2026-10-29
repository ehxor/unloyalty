import bwipjs from 'bwip-js/node';
import { expect, test } from './fixtures';

async function barcodePng(bcid: string, text: string): Promise<Buffer> {
  return bwipjs.toBuffer({ bcid, text, scale: 3, height: 15, paddingwidth: 20, paddingheight: 20, backgroundcolor: 'FFFFFF' });
}

test('scan from photo detects format and value, then saves', async ({ page }) => {
  await page.goto('/add');
  await page.getByLabel('Scan from photo').setInputFiles({ name: 'card.png', mimeType: 'image/png', buffer: await barcodePng('upca', '036000291452') });

  await expect(page).toHaveURL(/\/add\/confirm$/);
  await expect(page.locator('.detected')).toContainText('UPC-A');
  await expect(page.locator('.detected')).toContainText('036000291452');
  await page.getByLabel('Name').fill('Grocer');
  await page.getByRole('button', { name: 'Save card' }).click();
  await expect(page.getByRole('heading', { name: 'Grocer' })).toBeVisible();
  await expect(page.locator('.barcode-text')).toHaveText('036000291452');
});

test('a photo without a barcode explains what to do', async ({ page }) => {
  const blank = await bwipjs.toBuffer({ bcid: 'code128', text: 'x', scale: 1, height: 1, paddingwidth: 200, paddingheight: 200, backgroundcolor: 'FFFFFF', barcolor: 'FFFFFF' });
  await page.goto('/add');
  await page.getByLabel('Scan from photo').setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: blank });
  await expect(page.getByRole('alert')).toContainText('No barcode found');
});
