import { test as base, devices, expect, type BrowserContext, type Page } from '@playwright/test';

let clientCounter = 0;
/**
 * A distinct client address per browser context. The e2e server trusts X-Forwarded-For, so login rate limiting
 * (5 attempts per IP) applies per simulated device instead of to the whole parallel test run.
 */
function clientIp(workerIndex: number): string {
  clientCounter++;
  return `10.${workerIndex % 256}.${(clientCounter >> 8) % 256}.${clientCounter % 256}`;
}

export interface Account {
  username: string;
  password: string;
}

/**
 * Every test also asserts, for whatever flow it exercised:
 * - no request went to any host but the app's own origin (no CDNs, analytics or fonts);
 * - nothing tripped the server's Content-Security-Policy.
 */
export const test = base.extend<{
  sameOriginOnly: void;
  noCspViolations: void;
  /** Open a second (third, …) device: a fresh browser context with its own storage and client address. */
  newDevice: () => Promise<Page>;
  /** A fresh account on the e2e server (registration is open there). */
  account: Account;
}>({
  extraHTTPHeaders: async ({}, use, testInfo) => {
    await use({ 'X-Forwarded-For': clientIp(testInfo.workerIndex) });
  },
  newDevice: async ({ browser, baseURL }, use, testInfo) => {
    const opened: BrowserContext[] = [];
    await use(async () => {
      const { defaultBrowserType: _, ...phone } = devices['Pixel 7'];
      const context = await browser.newContext({ ...phone, baseURL: baseURL!, extraHTTPHeaders: { 'X-Forwarded-For': clientIp(testInfo.workerIndex) } });
      opened.push(context);
      return context.newPage();
    });
    await Promise.all(opened.map((c) => c.close()));
  },
  account: async ({ page }, use) => {
    const account = { username: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, password: 'correct horse battery' };
    const res = await page.request.post('/api/auth/register', { data: account });
    expect(res.status(), await res.text()).toBe(201);
    await use(account);
  },
  sameOriginOnly: [
    async ({ context, baseURL }, use) => {
      const origin = new URL(baseURL!).origin;
      const foreign: string[] = [];
      context.on('request', (req) => {
        const url = new URL(req.url());
        if (url.protocol === 'data:' || url.protocol === 'blob:') return;
        if (url.origin !== origin) foreign.push(req.url());
      });
      await use();
      expect(foreign, 'requests to other origins').toEqual([]);
    },
    { auto: true },
  ],
  noCspViolations: [
    async ({ context }, use) => {
      const violations: string[] = [];
      context.on('console', (msg) => {
        if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
      });
      await use();
      expect(violations, 'CSP violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export interface NewCard {
  name: string;
  value: string;
  format?: string;
  notes?: string;
}

/** Add a card through the manual-entry form; leaves the page on the card view. */
export async function addManualCard(page: Page, card: NewCard): Promise<void> {
  await page.goto('/add/manual');
  await page.getByLabel('Card number').fill(card.value);
  if (card.format) await page.getByLabel('Barcode type').selectOption(card.format);
  await page.getByLabel('Name').fill(card.name);
  if (card.notes) await page.getByLabel('Notes').fill(card.notes);
  await page.getByRole('button', { name: 'Save card' }).click();
  await expect(page).toHaveURL(/\/card\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: card.name })).toBeVisible();
}

/** Sign in from Settings and wait for the first sync to finish. */
export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto('/settings');
  await page.getByLabel('Username').fill(account.username);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(`Signed in as ${account.username}.`)).toBeVisible();
  await expect(page.locator('.sync-state')).toContainText('All cards are synced');
}

/** The wallet header's sync chip. */
export function syncBadge(page: Page) {
  return page.locator('.sync-badge');
}
