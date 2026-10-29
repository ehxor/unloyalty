import { devices, type Page } from '@playwright/test';
import { addManualCard, expect, test } from './fixtures';

async function walletOrder(page: Page): Promise<string[]> {
  return page.getByRole('list', { name: 'Cards' }).getByRole('link').allTextContents();
}

async function addCards(page: Page, ...names: string[]) {
  for (const name of names) await addManualCard(page, { name, value: name.toUpperCase() });
  await page.goto('/');
}

test('reorder by dragging and with the arrow buttons; the order sticks', async ({ page }) => {
  await addCards(page, 'Alpha', 'Bravo', 'Charlie');
  expect(await walletOrder(page)).toEqual(['Alpha', 'Bravo', 'Charlie']);

  await page.getByRole('button', { name: 'Reorder' }).click();
  // Drag Charlie's handle up two rows.
  const handle = page.locator('[data-handle="Charlie"]');
  const from = (await handle.boundingBox())!;
  const to = (await page.locator('[data-handle="Alpha"]').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('list', { name: 'Card order' }).getByRole('listitem')).toHaveText([/Charlie/, /Alpha/, /Bravo/]);

  await page.getByRole('button', { name: 'Move Alpha down' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  expect(await walletOrder(page)).toEqual(['Charlie', 'Bravo', 'Alpha']);

  await page.reload();
  await expect(page.getByRole('list', { name: 'Cards' }).getByRole('link')).toHaveText(['Charlie', 'Bravo', 'Alpha']);
});

test('"Recently used" puts the last opened card first, and the choice is remembered', async ({ page }) => {
  // Saving a card opens it, so all three start out "used" in the order they were added.
  await addCards(page, 'Alpha', 'Bravo', 'Charlie');
  await page.getByRole('link', { name: 'Alpha' }).click();
  await expect(page.getByRole('heading', { name: 'Alpha' })).toBeVisible();
  await page.getByRole('link', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Recently used' }).click();
  await expect(page.getByRole('list', { name: 'Cards' }).getByRole('link')).toHaveText(['Alpha', 'Charlie', 'Bravo']);
  await expect(page.getByRole('button', { name: 'Reorder' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Recently used' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('list', { name: 'Cards' }).getByRole('link')).toHaveText(['Alpha', 'Charlie', 'Bravo']);
});

test('no install hint outside iOS', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No cards yet.')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Install the app' })).toHaveCount(0);
});

test.describe('in iOS Safari (browser tab)', () => {
  test.use({ userAgent: devices['iPhone 15'].userAgent });

  test('shows how to add to the Home Screen until dismissed', async ({ page }) => {
    await page.goto('/');
    const hint = page.getByRole('complementary', { name: 'Install the app' });
    await expect(hint).toContainText('Add to Home Screen');
    await hint.getByRole('button', { name: 'Dismiss' }).click();
    await expect(hint).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('No cards yet.')).toBeVisible();
    await expect(hint).toHaveCount(0);
  });
});
