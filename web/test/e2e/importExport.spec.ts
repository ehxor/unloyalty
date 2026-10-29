import { readFile } from 'node:fs/promises';
import { addManualCard, expect, test } from './fixtures';

test('export, then import into empty storage, restores every card', async ({ page, browser, baseURL }) => {
  await addManualCard(page, { name: 'Corner Shop', value: '5901234123457', format: 'ean13', notes: 'since 2019' });
  await addManualCard(page, { name: 'Gym', value: 'member:9981', format: 'qr' });

  await page.goto('/settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export cards' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^unloyalty-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = await readFile((await download.path())!, 'utf8');
  expect(JSON.parse(exported).cards).toHaveLength(2);

  // A fresh context has no site data: the "wiped device" case.
  const fresh = await browser.newContext({ baseURL: baseURL! });
  const page2 = await fresh.newPage();
  await page2.goto('/');
  await expect(page2.getByText('No cards yet.')).toBeVisible();

  await page2.goto('/settings');
  await page2.getByLabel('Import cards').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await expect(page2.getByRole('status')).toHaveText('Import complete: 2 added, 0 updated, 0 unchanged.');

  await page2.goto('/');
  await page2.getByRole('link', { name: 'Corner Shop' }).click();
  await expect(page2.locator('.barcode-text')).toHaveText('5901234123457');
  await expect(page2.getByText('since 2019')).toBeVisible();

  // Importing the same file again changes nothing.
  await page2.goto('/settings');
  await page2.getByLabel('Import cards').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await expect(page2.getByRole('status')).toHaveText('Import complete: 0 added, 0 updated, 2 unchanged.');
  await fresh.close();
});

test('rejects a file that is not an export', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('Import cards').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByRole('status')).toHaveText('This isn’t an Unloyalty export file');
});
