import { addManualCard, expect, test } from './fixtures';

test('add, view, edit and delete a card', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No cards yet.')).toBeVisible();

  // 12 digits: the EAN-13 check digit is filled in.
  await addManualCard(page, { name: 'Corner Shop', value: '590123412345', format: 'ean13', notes: 'since 2019' });
  await expect(page.locator('.barcode img')).toBeVisible();
  await expect(page.locator('.barcode-text')).toHaveText('5901234123457');
  await expect(page.getByText('since 2019')).toBeVisible();

  await page.getByRole('link', { name: 'Edit card' }).click();
  await page.getByLabel('Name').fill('Corner Shop Plus');
  await page.getByLabel('Card number').fill('ABC-123');
  await page.getByLabel('Barcode type').selectOption('code128');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Corner Shop Plus' })).toBeVisible();
  await expect(page.locator('.barcode-text')).toHaveText('ABC-123');

  await page.getByRole('link', { name: 'Close' }).click();
  await expect(page.getByRole('link', { name: 'Corner Shop Plus' })).toBeVisible();

  await page.getByRole('link', { name: 'Corner Shop Plus' }).click();
  await page.getByRole('link', { name: 'Edit card' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete card' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('No cards yet.')).toBeVisible();
});

test('rejects an invalid number with a clear message', async ({ page }) => {
  await page.goto('/add/manual');
  await page.getByLabel('Barcode type').selectOption('ean13');
  await page.getByLabel('Card number').fill('5901234123458');
  await page.getByLabel('Name').fill('Typo');
  await page.getByRole('button', { name: 'Save card' }).click();
  await expect(page.getByRole('alert')).toContainText('check digit is wrong (expected 7)');
  await expect(page).toHaveURL(/\/add\/manual$/);
});

test('search filters the wallet by name, ignoring case and accents', async ({ page }) => {
  await addManualCard(page, { name: 'Café Rewards', value: 'CAFE1' });
  await addManualCard(page, { name: 'Library', value: 'LIB-42' });
  await page.goto('/');
  await page.getByLabel('Search cards').fill('cafe');
  await expect(page.getByRole('link', { name: 'Café Rewards' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Library' })).toHaveCount(0);
});
