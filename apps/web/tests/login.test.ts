import { expect, type Page, test } from '@playwright/test';
import postgres from 'postgres';
import { createUserWithMagicLink } from './helpers';

const sql = postgres(process.env.DATABASE_URL!, { connection: { timezone: 'UTC' }, onnotice: () => {} });
test.afterAll(() => sql.end());

const freshEmail = () => `e2e-${crypto.randomUUID()}@example.com`;

// Console errors fail the test, CSP violations included
let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
});
test.afterEach(() => expect(errors).toEqual([]));

// The form only works once hydrated. That is when onMount asks for the login state.
async function openHydrated(page: Page, path: string) {
  await Promise.all([page.waitForResponse('**/api/v1/auth/me'), page.goto(path)]);
}

test('the login form sends a magic link', async ({ page }) => {
  await openHydrated(page, '/login');
  const email = freshEmail();
  await sql`insert into users (email, name) values (${email}, 'Tester')`;
  await page.getByLabel('E-Mail').fill(email);
  await page.getByRole('button', { name: 'Login-Link senden' }).click();
  await expect(page.getByText('Check deine E-Mails')).toBeVisible();
});

test('the language button switches to English and keeps it', async ({ page }) => {
  await openHydrated(page, '/login');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await Promise.all([page.waitForResponse('**/api/v1/auth/me'), page.reload()]);
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await page.getByRole('button', { name: 'Deutsch' }).click();
  await expect(page.getByRole('heading', { name: 'Einloggen' })).toBeVisible();
});

test('a magic link logs in until logout', async ({ page }) => {
  // Stored like the API does it: only the hash of the token
  const { email, token } = await createUserWithMagicLink(sql);

  await page.goto(`/auth/verify?token=${token}`);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(`Angemeldet als ${email}`)).toBeVisible();

  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page.getByRole('link', { name: 'Einloggen' })).toBeVisible();
});
