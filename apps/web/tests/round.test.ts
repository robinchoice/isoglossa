import { expect, type Page, test } from '@playwright/test';
import postgres from 'postgres';
import { createUserWithMagicLink } from './helpers';

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

// Picks the first option, right or wrong, then moves on
async function playRound(page: Page) {
  for (let i = 0; i < 5; i++) {
    await page.locator('.opt').first().click();
    await expect(page.getByText(/^\+1 in \d+ Sprachen$/)).toBeVisible();
    await page.getByRole('button', { name: i < 4 ? 'Weiter' : 'Runde abschließen' }).click();
  }
  await expect(page.getByText('Runde geschafft')).toBeVisible();
}

test('the daily round works without login and fills the map', async ({ page }) => {
  await page.goto('/');
  await playRound(page);
  await expect(page.getByText('Dein Fortschritt liegt nur in diesem Browser.')).toBeVisible();

  // A reload keeps the finished round
  await page.reload();
  await expect(page.getByText('Runde geschafft')).toBeVisible();

  await page.getByRole('link', { name: 'Auf der Karte ansehen' }).click();
  await expect(page).toHaveURL(/\/map$/);
  const won = page.locator('.tile.hit');
  await expect(won.first()).toBeVisible();
  await expect(won.first().locator('.plus')).toHaveText(/^\+[1-5]$/);

  // Language → collected words → word detail
  await won.first().click();
  await expect(page.getByText(/^\d+ gesammelt · noch \d+ zu entdecken$/)).toBeVisible();
  await page.locator('.row').first().click();
  await expect(page).toHaveURL(/\?word=/);
  await expect(page.getByText('Herkunft')).toBeVisible();
  await page.getByRole('button', { name: 'Japanisch' }).click();
  await expect(page.getByText(/gehört zum Netz|anderes Wort, keine Brücke/)).toBeVisible();

  await page.getByRole('link', { name: 'Wörter' }).first().click();
  await expect(page.getByText('5 gesammelt · tippen für Netz und Herkunft')).toBeVisible();
  await expect(page.locator('.cov')).toHaveCount(5);
});

test('logged in, the progress lands in the account', async ({ page }) => {
  const { email, token } = await createUserWithMagicLink(sql);

  await page.goto(`/auth/verify?token=${token}`);
  await expect(page.getByText(`Angemeldet als ${email}`)).toBeVisible();
  await Promise.all([page.waitForResponse('**/api/v1/progress'), page.locator('.opt').first().click()]);

  const rows = await sql`select w.word_id from user_words w join users u on u.id = w.user_id where u.email = ${email}`;
  expect(rows).toHaveLength(1);
});
