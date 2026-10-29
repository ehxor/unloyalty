import { addManualCard, expect, signIn, syncBadge, test } from './fixtures';

test('cards sync between devices: add, newer edit wins, delete propagates', async ({ page: phone, context: phoneContext, newDevice, account }) => {
  await signIn(phone, account);
  await addManualCard(phone, { name: 'Shop', value: 'SHOP-1' });
  await phone.goto('/');
  await expect(syncBadge(phone)).toHaveText('Synced');

  const tablet = await newDevice();
  await signIn(tablet, account);
  await tablet.goto('/');
  await expect(tablet.getByRole('link', { name: 'Shop' })).toBeVisible();

  // The phone edits offline (older); the tablet edits later and syncs first.
  await phoneContext.setOffline(true);
  await phone.getByRole('link', { name: 'Shop' }).click();
  await phone.getByRole('link', { name: 'Edit card' }).click();
  await phone.getByLabel('Name').fill('Shop (phone)');
  await phone.getByRole('button', { name: 'Save changes' }).click();
  await phone.getByRole('link', { name: 'Close' }).click();
  await expect(syncBadge(phone)).toHaveText('Offline · 1 waiting');

  await tablet.getByRole('link', { name: 'Shop' }).click();
  await tablet.getByRole('link', { name: 'Edit card' }).click();
  await tablet.getByLabel('Name').fill('Shop (tablet)');
  await tablet.getByRole('button', { name: 'Save changes' }).click();
  await tablet.getByRole('link', { name: 'Close' }).click();
  await expect(syncBadge(tablet)).toHaveText('Synced');

  // Back online: the phone syncs on its own; its older edit loses.
  await phoneContext.setOffline(false);
  await expect(phone.getByRole('link', { name: 'Shop (tablet)' })).toBeVisible();
  await expect(syncBadge(phone)).toHaveText('Synced');

  // Delete on the tablet; the phone drops the card next time the app opens.
  await tablet.getByRole('link', { name: 'Shop (tablet)' }).click();
  await tablet.getByRole('link', { name: 'Edit card' }).click();
  tablet.once('dialog', (d) => void d.accept());
  await tablet.getByRole('button', { name: 'Delete card' }).click();
  await expect(syncBadge(tablet)).toHaveText('Synced');
  await phone.reload();
  await expect(phone.getByText('No cards yet.')).toBeVisible();
});

test('a card added offline syncs when the connection returns', async ({ page, context, newDevice, account }) => {
  await signIn(page, account);
  await context.setOffline(true);
  await addManualCard(page, { name: 'Gym', value: 'GYM-7', format: 'code39' });
  await page.goto('/');
  await expect(syncBadge(page)).toHaveText('Offline · 1 waiting');
  await context.setOffline(false);
  await expect(syncBadge(page)).toHaveText('Synced');

  const other = await newDevice();
  await signIn(other, account);
  await other.goto('/');
  await other.getByRole('link', { name: 'Gym' }).click();
  await expect(other.locator('.barcode-text')).toHaveText('GYM-7');
});

test('cards made before signing in join the account', async ({ page, newDevice, account }) => {
  await addManualCard(page, { name: 'Library', value: 'LIB-42' });
  await page.goto('/');
  await expect(syncBadge(page)).toHaveText('Local only');
  await signIn(page, account);

  const other = await newDevice();
  await signIn(other, account);
  await other.goto('/');
  await expect(other.getByRole('link', { name: 'Library' })).toBeVisible();
});

test('signing out warns about unsynced changes, then wipes the device', async ({ page, context, account }) => {
  await signIn(page, account);
  await addManualCard(page, { name: 'Library', value: 'LIB-42' });
  await page.goto('/');
  await expect(syncBadge(page)).toHaveText('Synced');

  await context.setOffline(true);
  await addManualCard(page, { name: 'Unsynced', value: 'NEW-1' });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  const warning = page.getByRole('alertdialog', { name: 'Unsynced changes' });
  await expect(warning).toContainText('1 change hasn’t reached the server');
  await warning.getByRole('button', { name: 'Sign out anyway' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('No cards yet.')).toBeVisible();

  // The synced card is still on the server; the unsynced one is gone.
  await context.setOffline(false);
  await signIn(page, account);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Library' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Unsynced' })).toHaveCount(0);
});

test('create an account from the app; wrong password is explained', async ({ page }) => {
  const username = `new-${Date.now().toString(36)}`;
  await page.goto('/settings');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(`Signed in as ${username}.`)).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill('wrong password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong username or password');
});
