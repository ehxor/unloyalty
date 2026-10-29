import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, signIn, syncBadge, test, type NewCard } from '../test/e2e/fixtures';

/** README screenshots: a populated, signed-in wallet in a phone viewport. Not part of the test suite. */

const OUT = fileURLToPath(new URL('../../docs/screenshots/', import.meta.url));

const CARDS: (NewCard & { color: string })[] = [
  { name: 'Corner Shop', value: '5901234123457', format: 'ean13', color: '#c0392b', notes: 'Member since 2019' },
  { name: 'City Library', value: 'LIB-204817', format: 'code39', color: '#1f6fb2' },
  { name: 'Gym', value: 'member:99812-A', format: 'qr', color: '#2e8b57', notes: 'Locker PIN hint: first flat' },
  { name: 'Coffee Club', value: 'CC-0042-7781', format: 'code128', color: '#6d4c41' },
  { name: 'Bookshop', value: '036000291452', format: 'upca', color: '#7b3fb5' },
  { name: 'Pharmacy', value: 'RX 5521 0098 1123', format: 'pdf417', color: '#16807a' },
];

async function addCard(page: Page, card: (typeof CARDS)[number]) {
  await page.goto('/add/manual');
  await page.getByLabel('Card number').fill(card.value);
  await page.getByLabel('Barcode type').selectOption(card.format!);
  await page.getByLabel('Name').fill(card.name);
  await page.getByRole('radio', { name: card.color }).click();
  if (card.notes) await page.getByLabel('Notes').fill(card.notes);
  await page.getByRole('button', { name: 'Save card' }).click();
  await expect(page.getByRole('heading', { name: card.name })).toBeVisible();
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}${name}.png`, animations: 'disabled', caret: 'hide' });
}

test.use({ colorScheme: 'light', permissions: ['camera'] });

test('screenshots', async ({ page, account }) => {
  test.setTimeout(120_000);
  await signIn(page, account);
  for (const card of CARDS) await addCard(page, card);

  await page.goto('/');
  await expect(syncBadge(page)).toHaveText('Synced', { timeout: 15_000 });
  await shot(page, 'wallet');

  await page.getByRole('link', { name: 'Corner Shop' }).click();
  await expect(page.locator('.barcode img')).toBeVisible();
  await shot(page, 'card-ean13');

  await page.goto('/');
  await page.getByRole('link', { name: 'Gym' }).click();
  await expect(page.locator('.barcode img')).toBeVisible();
  await shot(page, 'card-qr');

  // Live scan with the fake camera, landing on the confirmation form.
  await page.goto('/add');
  await page.getByRole('link', { name: /Scan with camera/ }).click();
  await expect(page).toHaveURL(/\/add\/confirm$/, { timeout: 15_000 });
  await page.getByLabel('Name').fill('Hardware Store');
  await shot(page, 'scanned');

  await page.goto('/settings');
  await expect(page.locator('.sync-state')).toContainText('All cards are synced');
  await shot(page, 'settings');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Reorder' }).click();
  await shot(page, 'reorder-dark');
  await page.getByRole('button', { name: 'Done' }).click();
  await shot(page, 'wallet-dark');
});
