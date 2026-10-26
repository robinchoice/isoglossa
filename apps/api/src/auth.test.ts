import { afterAll, beforeAll, expect, setSystemTime, spyOn, test } from 'bun:test';
import { createDb, loginCodes, magicLinks, migrateDb, rateLimits, sessions, users } from '@app/db';
import { messages } from '@app/shared';
import { eq } from 'drizzle-orm';
import { createApp } from './app';
import { generateToken, hashToken } from './middleware/auth';
import { altchaPayload } from './testing';

const db = createDb(process.env.DATABASE_URL!);
const app = createApp(db);
const log = spyOn(console, 'log');

beforeAll(() => {
  delete process.env.SIGNUP_OPEN;
  delete process.env.SIGNUP_ALLOWLIST;
  return migrateDb(process.env.DATABASE_URL!);
});
afterAll(() => db.$client.end());

const freshEmail = () => {
  const email = `test-${crypto.randomUUID()}@example.com`;
  process.env.SIGNUP_ALLOWLIST = `${process.env.SIGNUP_ALLOWLIST ?? ''},${email}`;
  return email;
};

// Rate limits live in the database, so each run counts against its own address
const ip = crypto.randomUUID();

// Login mails need a solved ALTCHA like the login form sends it, the ALTCHA tests post without
const ALTCHA_PATHS = ['/auth/magic-link', '/auth/code'];

async function post(path: string, body: object, headers: Record<string, string> = {}) {
  const altcha = ALTCHA_PATHS.includes(path) ? { altcha: await altchaPayload(app) } : {};
  return send(path, { ...body, ...altcha }, headers);
}

function send(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: JSON.stringify(body),
  });
}

// biome-ignore lint/suspicious/noExplicitAny: the tests check the shape with expect
async function body(res: Response | Promise<Response>): Promise<any> {
  return (await res).json();
}

// Without SMTP_HOST the login mail lands in the log
function lastMail() {
  return log.mock.calls.map((args) => String(args[0])).findLast((line) => line.startsWith('[mail]'));
}

const mailCount = () => log.mock.calls.filter((args) => String(args[0]).startsWith('[mail]')).length;

function lastMailedToken() {
  return lastMail()?.match(/token=([0-9a-f]+)/)?.[1];
}

function lastMailedCode() {
  return lastMail()?.match(/Dein Code: (\d{6})/)?.[1];
}

const otherCode = (code: string) => (code === '000000' ? '000001' : '000000');

test('health checks the database', async () => {
  const res = await app.request('/api/health');
  expect(res.status).toBe(200);
  expect(await body(res)).toMatchObject({ status: 'ok', revision: expect.any(String) });
});

test('magic link logs in, creates the account and logs out', async () => {
  const email = freshEmail();
  expect((await post('/auth/magic-link', { email: ` ${email.toUpperCase()} ` })).status).toBe(200);
  const token = lastMailedToken()!;

  const verify = await post('/auth/verify', { token });
  expect(verify.status).toBe(200);
  expect((await body(verify)).user).toMatchObject({ email, name: email.split('@')[0] });
  const session = verify.headers.get('set-cookie')!.match(/session=([0-9a-f]+)/)![1]!;

  const me = await app.request('/api/v1/auth/me', { headers: { cookie: `session=${session}` } });
  expect((await body(me)).user.email).toBe(email);

  // Native clients send the same token as a bearer token
  const rename = await app.request('/api/v1/auth/me', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Robin' }),
  });
  expect((await body(rename)).user.name).toBe('Robin');

  expect((await post('/auth/verify', { token })).status).toBe(400);

  await post('/auth/logout', {}, { cookie: `session=${session}` });
  const after = await app.request('/api/v1/auth/me', { headers: { cookie: `session=${session}` } });
  expect((await body(after)).user).toBeNull();
});

test('login mails need an ALTCHA solution that is valid and unused', async () => {
  const email = freshEmail();
  const mails = mailCount();
  const missing = await send('/auth/magic-link', { email }, { 'accept-language': 'en' });
  expect(missing.status).toBe(403);
  expect(await body(missing)).toEqual({ error: messages.en.altchaFailed });
  expect((await send('/auth/code', { email, altcha: btoa('nonsense') })).status).toBe(403);

  const altcha = await altchaPayload(app);
  const { challenge, solution } = JSON.parse(atob(altcha));
  const easier = { ...challenge, parameters: { ...challenge.parameters, cost: 1 } };
  const wrong = { ...solution, counter: solution.counter + 1 };
  for (const forged of [
    { challenge: easier, solution },
    { challenge, solution: wrong },
  ])
    expect((await send('/auth/code', { email, altcha: btoa(JSON.stringify(forged)) })).status).toBe(403);
  expect(mailCount()).toBe(mails);

  expect((await send('/auth/code', { email, altcha })).status).toBe(200);
  expect((await send('/auth/magic-link', { email, altcha })).status).toBe(403);
  expect(mailCount()).toBe(mails + 1);
});

test('an ALTCHA solution expires after ten minutes', async () => {
  const altcha = await altchaPayload(app);
  setSystemTime(new Date(Date.now() + 11 * 60 * 1000));
  try {
    expect((await send('/auth/magic-link', { email: freshEmail(), altcha })).status).toBe(403);
  } finally {
    setSystemTime();
  }
});

test('requests without ALTCHA leave the rate limits of an address alone', async () => {
  const email = freshEmail();
  for (let i = 0; i < 10; i++) await send('/auth/magic-link', { email });
  expect((await post('/auth/magic-link', { email })).status).toBe(200);
});

test('a second login reuses the account', async () => {
  const email = freshEmail();
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    await post('/auth/magic-link', { email });
    ids.push((await body(post('/auth/verify', { token: lastMailedToken() }))).user.id);
  }
  expect(ids[0]).toBe(ids[1]);
});

test('magic link checks allow 60 attempts per IP and leave blocked links usable', async () => {
  // Its own address, so the other tests keep their budget
  const own = { 'x-forwarded-for': crypto.randomUUID() };
  const email = freshEmail();
  expect((await post('/auth/magic-link', { email }, own)).status).toBe(200);
  const token = lastMailedToken()!;

  const attempts = await Promise.all(Array.from({ length: 60 }, () => post('/auth/verify', { token: 'invalid' }, own)));
  expect(attempts.map((res) => res.status)).toEqual(Array(60).fill(400));
  const blocked = await post('/auth/verify', { token }, { ...own, 'accept-language': 'en' });
  expect(blocked.status).toBe(429);
  expect(await body(blocked)).toEqual({ error: messages.en.tooManyRequests });
  expect(blocked.headers.get('set-cookie')).toBeNull();

  expect((await post('/auth/verify', { token }, { 'x-forwarded-for': crypto.randomUUID() })).status).toBe(200);

  expect((await post('/auth/magic-link', { email }, own)).status).toBe(200);
  const nextToken = lastMailedToken()!;
  expect((await post('/auth/verify', { token: nextToken }, own)).status).toBe(429);
  await db
    .update(rateLimits)
    .set({ resetAt: new Date(Date.now() - 1) })
    .where(eq(rateLimits.key, `link-checks-per-ip:${own['x-forwarded-for']}`));
  expect((await post('/auth/verify', { token: nextToken }, own)).status).toBe(200);
});

test('protected routes need a session', async () => {
  const res = await app.request('/api/v1/auth/me', { method: 'PATCH', body: '{}' });
  expect(res.status).toBe(401);
});

test('login mails per address are rate limited', async () => {
  const email = freshEmail();
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await post('/auth/magic-link', { email })).status);
  expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
});

test('invalid input answers with an error message', async () => {
  const res = await post('/auth/magic-link', { email: 'no-address' });
  expect(res.status).toBe(400);
  expect(typeof (await body(res)).error).toBe('string');
});

test('errors and mails follow Accept-Language, German by default', async () => {
  const english = { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' };
  expect((await body(post('/auth/magic-link', { email: 'no-address' }, english))).error).toBe(
    'The email address is invalid.',
  );
  expect((await body(post('/auth/magic-link', { email: 'no-address' }))).error).toBe(
    'Die E-Mail-Adresse ist ungültig.',
  );

  await post('/auth/code', { email: freshEmail() }, english);
  expect(lastMail()).toContain('is your login code');
});

test('apps log in with a code and get a bearer token', async () => {
  const email = freshEmail();
  expect((await post('/auth/code', { email })).status).toBe(200);
  const code = lastMailedCode()!;

  expect((await post('/auth/code/verify', { email, code: otherCode(code) })).status).toBe(400);
  const verify = await post('/auth/code/verify', { email, code });
  expect(verify.status).toBe(200);
  expect(verify.headers.get('set-cookie')).toBeNull();
  const { user, token } = await body(verify);
  expect(user.email).toBe(email);

  const me = await app.request('/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } });
  expect((await body(me)).user.id).toBe(user.id);

  expect((await post('/auth/code/verify', { email, code })).status).toBe(400);
});

test('a code stops working after five wrong tries', async () => {
  const email = freshEmail();
  await post('/auth/code', { email });
  const code = lastMailedCode()!;
  for (let i = 0; i < 5; i++) await post('/auth/code/verify', { email, code: otherCode(code) });
  expect((await post('/auth/code/verify', { email, code })).status).toBe(400);
});

test('login-link prints a magic link that logs in', async () => {
  const email = freshEmail();
  const run = Bun.spawnSync(['bun', 'src/login-link.ts', email], {
    env: { ...process.env, APP_URL: 'https://app.test' },
  });
  const link = new URL(run.stdout.toString().trim());
  expect(link.origin + link.pathname).toBe('https://app.test/auth/verify');

  const verify = await post('/auth/verify', { token: link.searchParams.get('token') });
  expect((await body(verify)).user.email).toBe(email);
});

test('a session in use is renewed', async () => {
  const [user] = await db.insert(users).values({ email: freshEmail(), name: 'Lena' }).returning({ id: users.id });
  const token = generateToken();
  const [session] = await db
    .insert(sessions)
    .values({ userId: user!.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) })
    .returning({ id: sessions.id });

  const me = await app.request('/api/v1/auth/me', { headers: { cookie: `session=${token}` } });
  expect(me.headers.get('set-cookie')).toContain(`session=${token}`);
  const [renewed] = await db.select().from(sessions).where(eq(sessions.id, session!.id));
  expect(renewed!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);

  // Renewed sessions are left alone for a day
  const again = await app.request('/api/v1/auth/me', { headers: { cookie: `session=${token}` } });
  expect(again.headers.get('set-cookie')).toBeNull();
});

test('closed signup sends no mail or credential and creates no account for strangers', async () => {
  const email = `blocked-${crypto.randomUUID()}@example.com`;
  const mailsBefore = log.mock.calls.filter(([line]) => String(line).startsWith('[mail]')).length;
  for (const path of ['/auth/magic-link', '/auth/code']) {
    const response = await post(path, { email }, { 'accept-language': 'en' });
    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({ error: 'Registration is currently closed.' });
  }
  expect(log.mock.calls.filter(([line]) => String(line).startsWith('[mail]')).length).toBe(mailsBefore);
  expect(await db.select().from(magicLinks).where(eq(magicLinks.email, email))).toHaveLength(0);
  expect(await db.select().from(loginCodes).where(eq(loginCodes.email, email))).toHaveLength(0);
  expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
});

test('existing accounts can still log in without an allowlist entry', async () => {
  const email = `existing-${crypto.randomUUID()}@example.com`;
  await db.insert(users).values({ email, name: 'Tester' });
  expect((await post('/auth/magic-link', { email })).status).toBe(200);
  expect((await post('/auth/verify', { token: lastMailedToken() })).status).toBe(200);
  expect((await post('/auth/code', { email })).status).toBe(200);
  expect((await post('/auth/code/verify', { email, code: lastMailedCode() })).status).toBe(200);
});

test('allowlist accepts normalized addresses and blocks credentials after removal', async () => {
  const email = `revoked-${crypto.randomUUID()}@example.com`;
  const previous = process.env.SIGNUP_ALLOWLIST;
  process.env.SIGNUP_ALLOWLIST = ` ${email.toUpperCase()} , ${previous ?? ''}`;
  try {
    expect((await post('/auth/magic-link', { email })).status).toBe(200);
    const token = lastMailedToken();
    expect((await post('/auth/code', { email })).status).toBe(200);
    const code = lastMailedCode();
    process.env.SIGNUP_ALLOWLIST = previous;
    expect((await post('/auth/verify', { token })).status).toBe(403);
    expect((await post('/auth/code/verify', { email, code })).status).toBe(403);
    expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
  } finally {
    if (previous === undefined) delete process.env.SIGNUP_ALLOWLIST;
    else process.env.SIGNUP_ALLOWLIST = previous;
  }
});
