import { createHash, randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { Sql } from 'postgres';

export const freshEmail = () => `e2e-${crypto.randomUUID()}@example.com`;

export async function createUserWithMagicLink(sql: Sql) {
  const email = freshEmail();
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await sql`insert into users (email, name) values (${email}, 'Tester')`;
  await sql`insert into magic_links (email, token_hash, expires_at)
    values (${email}, ${tokenHash}, ${new Date(Date.now() + 15 * 60_000)})`;
  return { email, token };
}

export async function holdProgress(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/v1/progress', async (route) => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  });
  return { pending, release };
}
