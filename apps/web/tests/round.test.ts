import { expect, type Page, test } from '@playwright/test';
import postgres from 'postgres';
import { createUserWithMagicLink, holdProgress } from './helpers';

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

test('a new round waits for account progress before choosing fresh words', async ({ page }) => {
  const { email, token } = await createUserWithMagicLink(sql);
  const fresh = await sql`select id from words order by id limit 5`;
  await sql`insert into user_words (user_id, word_id, day)
    select u.id, w.id, '2026-10-01' from users u cross join words w
    where u.email = ${email} and w.id not in ${sql(fresh.map((word) => word.id))}`;

  const { pending, release } = await holdProgress(page);
  await page.goto(`/auth/verify?token=${token}`);
  await pending;
  await expect(page.locator('.opt')).toHaveCount(0);
  release();
  await expect(page.locator('.opt')).toHaveCount(4);
  const questions = await page.evaluate(() => JSON.parse(localStorage.getItem('round')!).questions);
  expect(questions.map((question: { id: string }) => question.id).sort()).toEqual(fresh.map((word) => word.id).sort());
});

test('a delayed progress response cannot restore account data after logout', async ({ page }) => {
  const { token } = await createUserWithMagicLink(sql);
  await page.addInitScript(() => {
    const json = Response.prototype.json;
    Response.prototype.json = async function () {
      const value = await json.call(this);
      if (this.url.endsWith('/api/v1/progress')) {
        // This task runs after the parsed JSON has reached the app's continuations.
        setTimeout(() => {
          const root = document.documentElement;
          root.dataset.progressResponses = String(Number(root.dataset.progressResponses ?? 0) + 1);
        }, 0);
      }
      return value;
    };
  });
  await page.goto(`/auth/verify?token=${token}`);
  await expect(page.locator('.opt')).toHaveCount(4);
  await expect(page.locator('html')).toHaveAttribute('data-progress-responses', '1');

  const { pending, release } = await holdProgress(page);
  await page.locator('.opt').first().click();
  await pending;
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page.getByRole('link', { name: 'Einloggen', exact: true })).toBeVisible();
  release();
  await expect(page.locator('html')).toHaveAttribute('data-progress-responses', '2');
  const saved = await page.evaluate(() => localStorage.getItem('progress'));
  expect(saved === null ? {} : JSON.parse(saved).learned).toEqual({});
});

test('a saved daily round is playable while account sync is pending', async ({ page }) => {
  const { token } = await createUserWithMagicLink(sql);
  await page.goto('/');
  await expect(page.locator('.opt')).toHaveCount(4);
  const saved = await page.evaluate(() => localStorage.getItem('round'));
  const { pending, release } = await holdProgress(page);
  await page.goto(`/auth/verify?token=${token}`);
  await pending;
  await expect(page.locator('.opt')).toHaveCount(4);
  expect(await page.evaluate(() => localStorage.getItem('round'))).toBe(saved);
  const completed = page.waitForResponse('**/api/v1/progress');
  release();
  await (await completed).finished();
});

test('an unresponsive account sync falls back to local play', async ({ page }) => {
  const { token } = await createUserWithMagicLink(sql);
  await page.route('**/api/v1/progress', () => {});
  await page.goto(`/auth/verify?token=${token}`);
  await expect(page.locator('.opt')).toHaveCount(4, { timeout: 10_000 });
  // Chromium reports the intentionally aborted fetch; other errors still fail.
  errors = errors.filter((error) => !error.includes('net::ERR_ABORTED'));
});

test('a failed account sync still allows a local round', async ({ page }) => {
  const { token } = await createUserWithMagicLink(sql);
  await page.route('**/api/v1/progress', (route) => route.fulfill({ status: 503, json: { error: 'Offline' } }));
  // The expected HTTP failure is handled by the app and reported by Chromium.
  await page.goto(`/auth/verify?token=${token}`);
  await expect(page.locator('.opt')).toHaveCount(4);
  await page.locator('.opt').first().click();
  await expect(page.getByText(/^\+1 in \d+ Sprachen$/)).toBeVisible();
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('progress')!).learned))).toHaveLength(1);
  errors = errors.filter((error) => !error.includes('503 (Service Unavailable)'));
});
