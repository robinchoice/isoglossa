import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createDb, migrateDb, seedWords, sessions, users } from '@app/db';
import type { Progress, WordData } from '@app/shared';
import { createApp } from './app';
import { generateToken, hashToken } from './middleware/auth';

// Runs against DATABASE_URL with a fresh user, like auth.test.ts
const db = createDb(process.env.DATABASE_URL!);
const app = createApp(db);

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  await seedWords(db);
});
afterAll(() => db.$client.end());

async function logIn() {
  const [user] = await db
    .insert(users)
    .values({ email: `test-${crypto.randomUUID()}@example.com`, name: 'Lena' })
    .returning({ id: users.id });
  const token = generateToken();
  await db
    .insert(sessions)
    .values({ userId: user!.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) });
  return { authorization: `Bearer ${token}` };
}

test('words come with a form in every language', async () => {
  const res = await app.request('/api/v1/words');
  const { words } = (await res.json()) as { words: WordData[] };
  expect(words.length).toBeGreaterThanOrEqual(50);
  const coffee = words.find((w) => w.id === 'coffee')!;
  expect(coffee.de).toBe('Kaffee');
  expect(Object.keys(coffee.forms)).toHaveLength(14);
  expect(coffee.forms.ja).toMatchObject({ form: 'コーヒー', cognate: true });
});

test('progress needs a login', async () => {
  expect((await app.request('/api/v1/progress')).status).toBe(401);
});

test('progress merges and keeps the first day of a word', async () => {
  const headers = { ...(await logIn()), 'content-type': 'application/json' };
  const send = (progress: Progress) =>
    app.request('/api/v1/progress', { method: 'POST', headers, body: JSON.stringify(progress) });

  await send({ words: [{ id: 'coffee', day: '2026-10-01' }], days: ['2026-10-01'] });
  const res = await send({
    words: [
      { id: 'coffee', day: '2026-10-02' },
      { id: 'taxi', day: '2026-10-02' },
      { id: 'no-such-word', day: '2026-10-02' },
    ],
    days: ['2026-10-02'],
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    words: [
      { id: 'coffee', day: '2026-10-01' },
      { id: 'taxi', day: '2026-10-02' },
    ],
    days: ['2026-10-01', '2026-10-02'],
  });

  const again = await app.request('/api/v1/progress', { headers });
  expect(((await again.json()) as Progress).words).toHaveLength(2);
});

test('progress rejects malformed days', async () => {
  const headers = { ...(await logIn()), 'content-type': 'application/json' };
  const res = await app.request('/api/v1/progress', {
    method: 'POST',
    headers,
    body: JSON.stringify({ words: [{ id: 'coffee', day: 'yesterday' }], days: [] }),
  });
  expect(res.status).toBe(400);
});
