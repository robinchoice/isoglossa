import { messages } from '@app/shared';
import { expect, type Page, test } from '@playwright/test';
import postgres from 'postgres';
import { createUserWithMagicLink, freshEmail } from './helpers';

const sql = postgres(process.env.DATABASE_URL!, { connection: { timezone: 'UTC' }, onnotice: () => {} });
test.afterAll(() => sql.end());

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

  // Another address needs a new bot check, the first solution is used up
  await page.getByRole('button', { name: 'Andere Adresse' }).click();
  await page.getByRole('button', { name: 'Login-Link senden' }).click();
  await expect(page.getByText('Check deine E-Mails')).toBeVisible();
});

// The widget solves on submit and needs a new solution after each request
test('the bot check runs before every login mail', async ({ page }) => {
  await openHydrated(page, '/login');
  await page.getByLabel('E-Mail').fill(freshEmail());
  for (let i = 0; i < 2; i++) {
    const [response] = await Promise.all([
      page.waitForResponse('**/api/v1/auth/magic-link'),
      page.getByRole('button', { name: 'Login-Link senden' }).click(),
    ]);
    expect(response.request().postDataJSON().altcha).toEqual(expect.any(String));
    expect(await response.json()).toEqual({ error: messages.de.signupClosed });
  }
  errors = errors.filter((error) => !error.includes('status of 403'));
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
