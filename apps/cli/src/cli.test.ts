import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, magicLinks, migrateDb, seedWords, users } from '@app/db';
import { LANGS, localDay, makeRound, messages, type WordData } from '@app/shared';
import { z } from 'zod';
import { createApp } from '../../api/src/app';
import { generateToken, hashToken } from '../../api/src/middleware/auth';
import { run } from './cli';
import { SLUG, sessionFile } from './config';

// The CLI runs in-process against the real API on a free port, with
// the test database of `bun run test` like the API tests.
const db = createDb(process.env.DATABASE_URL!);
// Request log and mails stay out of the test output
const log = spyOn(console, 'log').mockImplementation(() => {});
let server: ReturnType<typeof Bun.serve>;
let url = '';

// Rate limits live in the database, so each run counts against its own address
const ip = crypto.randomUUID();

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  await seedWords(db);
  const app = createApp(db);
  server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const forwarded = new Request(req);
      forwarded.headers.set('x-forwarded-for', ip);
      return app.fetch(forwarded);
    },
  });
  url = server.url.origin;
});
afterAll(async () => {
  await server.stop(true);
  await db.$client.end();
});

process.env.SIGNUP_OPEN = 'true';
const de = messages.de;
const storedSchema = z.object({ token: z.string() });
const freshEmail = () => `cli-${crypto.randomUUID()}@example.com`;

// A login link as login-link.ts prints it
async function issueMagicLink(email: string) {
  const token = generateToken();
  await db.insert(magicLinks).values({ email, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) });
  return `${url}/auth/verify?token=${token}`;
}

// Without SMTP_HOST the login mail lands in the log
const mails = () => log.mock.calls.map((args) => String(args[0])).filter((line) => line.startsWith('[mail]'));
const lastCode = () =>
  mails()
    .at(-1)
    ?.match(/Dein Code: (\d{6})/)?.[1] ?? '';

// One device: its own config folder, so its own token. Answers the code
// question from the last mail, the round with `answers`, others with `email`.
async function device(env: Record<string, string> = { LANG: 'de_DE.UTF-8' }) {
  const deviceEnv = { XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), 'cli-')), ...env };
  // Adds --url of the test API unless raw or the call names one
  const cli = async (args: string[], { email = '', stdin = '', raw = false, answers = [] as string[] } = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(raw || args.length === 0 || args.includes('--url') ? args : [...args, '--url', url], {
      env: deviceEnv,
      out: (text) => out.push(text),
      err: (text) => err.push(text),
      ask: async (question) => (question === de.cliAskCode ? lastCode() : (answers.shift() ?? email)),
      stdin: async () => stdin,
    });
    return { code, out: out.join('\n'), err: err.join('\n'), json: () => JSON.parse(out.join('\n')) };
  };
  const token = async () => storedSchema.parse(JSON.parse(await readFile(sessionFile(deviceEnv), 'utf8'))).token;
  return { cli, token, env: deviceEnv };
}

const sessionCount = async (token: string) =>
  (await db.$client`select count(*)::int as n from sessions where token_hash = ${hashToken(token)}`)[0]!.n;

const me = (token: string) =>
  fetch(`${url}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } }).then((res) => res.json());

test('login with the mailed code stores a token only the user can read', async () => {
  const email = freshEmail();
  const { cli, token, env } = await device();

  const login = await cli(['login', '--json'], { email });
  expect(login.code).toBe(0);
  expect(login.json()).toMatchObject({ user: { email } });
  expect(login.err).toContain(de.cliCodeSent(email));
  expect((await stat(sessionFile(env))).mode & 0o777).toBe(0o600);
  expect(await sessionCount(await token())).toBe(1);

  expect(await cli(['whoami'])).toMatchObject({ code: 0, out: `${email.split('@')[0]} <${email}>` });
  expect((await cli(['whoami', '--json'])).json()).toMatchObject({ user: { email } });
});

test('progress shows the words of the account in every language', async () => {
  const { cli, token } = await device();
  expect(await cli(['progress'])).toMatchObject({ code: 3, err: de.notLoggedIn });
  await cli(['login'], { email: freshEmail() });

  const empty = await cli(['progress', '--json']);
  expect(empty.code).toBe(0);
  expect(empty.json()).toMatchObject({ total: 0, words: [], days: [] });
  expect(empty.json().langs).toHaveLength(LANGS.length);

  // What the web sends after a round
  await fetch(`${url}/api/v1/progress`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ words: [{ id: 'coffee', day: '2026-10-01' }], days: ['2026-10-01'] }),
  });
  const data = (await cli(['progress', '--json'])).json();
  expect(data).toMatchObject({ words: [{ id: 'coffee', day: '2026-10-01' }], days: ['2026-10-01'] });
  // Coffee counts in Japanese, コーヒー, and in every other language where it is the same word
  expect(data.langs.find((row: { lang: string }) => row.lang === 'ja')).toMatchObject({ known: 1 });
  expect(data.total).toBeGreaterThan(5);

  const text = await cli(['progress']);
  expect(text.out).toContain(`${de.youKnow} ${data.total} ${de.wordsInLangs(LANGS.length)}`);
  expect(text.out).toContain(de.cliProgressSummary(1, 1));
  expect(text.out).toContain(de.langs.ja);
});

const allWords = async () =>
  ((await fetch(`${url}/api/v1/words`).then((res) => res.json())) as { words: WordData[] }).words;

// The number of the right option per question, from the same round the CLI makes
const rightAnswers = (words: WordData[], learned: string[]) =>
  makeRound(words, new Set(learned), localDay(), 'de').map((q) => String(q.options.indexOf(q.id) + 1));

test('round plays the daily round, logged in it counts for the account', async () => {
  const words = await allWords();
  const { cli } = await device();

  const guest = await cli(['round', '--json'], { answers: rightAnswers(words, []) });
  expect(guest.code).toBe(0);
  expect(guest.json()).toMatchObject({ day: localDay(), saved: false, streak: null });
  expect(guest.json().questions).toHaveLength(5);
  expect(guest.json().questions.every((q: { correct: boolean }) => q.correct)).toBe(true);
  expect(guest.err).toContain(de.question(1, 5));
  expect(guest.err).toContain(de.correct);
  expect((await cli(['round'], { answers: ['1', '1', '1', '1', '1'] })).out).toContain(de.cliRoundNotSaved(SLUG));

  await cli(['login'], { email: freshEmail() });
  const first = await cli(['round'], { answers: rightAnswers(words, []) });
  expect(first.code).toBe(0);
  expect(first.out).toContain(de.roundDone);
  expect(first.out).toContain(de.streak(1));
  const learned = (await cli(['progress', '--json'])).json();
  expect(learned.words).toHaveLength(5);
  expect(learned.days).toEqual([localDay()]);

  // The next round brings new words, like the extra round in the web
  const ids = learned.words.map((w: { id: string }) => w.id);
  const next = (await cli(['round', '--json'], { answers: rightAnswers(words, ids) })).json();
  expect(next).toMatchObject({ saved: true, streak: 1 });
  expect(next.questions.some((q: { id: string }) => ids.includes(q.id))).toBe(false);

  // A wrong number ends the round before anything is saved
  const before = (await cli(['progress', '--json'])).json().words.length;
  const wrong = await cli(['round'], { answers: ['9'] });
  expect(wrong.code).toBe(2);
  expect(wrong.err).toEndWith(de.cliBadChoice(4));
  expect((await cli(['progress', '--json'])).json().words).toHaveLength(before);
});

test('words, word and lang show the words, the collected ones marked', async () => {
  const words = await allWords();
  const { cli, token } = await device();

  const guest = (await cli(['words', '--json'])).json();
  expect(guest.words).toHaveLength(words.length);
  expect(guest.words.every((w: { learned: string | null }) => w.learned === null)).toBe(true);

  await cli(['login'], { email: freshEmail() });
  await fetch(`${url}/api/v1/progress`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ words: [{ id: 'coffee', day: '2026-10-01' }], days: [] }),
  });
  const list = await cli(['words']);
  expect(list.out).toContain(de.cliWordsSummary(1, words.length));
  expect(list.out).toMatch(/✓ coffee +Kaffee/);
  expect((await cli(['words', '--json'])).json().words[0]).toMatchObject({ id: 'coffee', learned: '2026-10-01' });

  const coffee = words.find((w) => w.id === 'coffee')!;
  const same = LANGS.filter((lang) => coffee.forms[lang].cognate).length;
  const detail = await cli(['word', 'coffee']);
  expect(detail.out).toContain(`${de.sameIn(same)} · ${de.collected}`);
  expect(detail.out).toMatch(new RegExp(`${de.langs.ja} +コーヒー`));
  expect(detail.out).toContain(`${de.origin}: `);
  expect(detail.out).toContain(coffee.fact.de);
  expect((await cli(['word', 'coffee', '--json'])).json()).toMatchObject({ word: coffee, learned: '2026-10-01' });

  const ja = (await cli(['lang', 'ja', '--json'])).json();
  expect(ja).toMatchObject({ lang: 'ja', known: 1 });
  expect(ja.words[0]).toMatchObject({ id: 'coffee', form: 'コーヒー', learned: '2026-10-01' });
  expect(ja.known + ja.open).toBe(words.filter((w) => w.forms.ja.cognate).length);
  expect((await cli(['lang', 'ja'])).out).toContain(de.langSummary(1, ja.open));

  expect(await cli(['word', 'nope'])).toMatchObject({ code: 1, err: de.cliUnknownWord('nope', SLUG) });
  expect(await cli(['word'])).toMatchObject({ code: 2, err: de.cliWrongArgs('word <id>', SLUG) });
  expect((await cli(['words', 'coffee'])).code).toBe(2);
  expect(await cli(['lang', 'xx'])).toMatchObject({ code: 2, err: de.cliUnknownLang('xx', LANGS.join(', ')) });
});

test('every device has its own token, logout revokes only that one', async () => {
  const email = freshEmail();
  const laptop = await device();
  const server = await device();
  await laptop.cli(['login'], { email });
  await server.cli(['login'], { email });
  const laptopToken = await laptop.token();
  expect(laptopToken).not.toBe(await server.token());

  expect(await laptop.cli(['logout'])).toMatchObject({ code: 0, out: de.cliLoggedOut });
  expect(await sessionCount(laptopToken)).toBe(0);
  expect(await me(laptopToken)).toEqual({ user: null });
  expect(await laptop.cli(['whoami'])).toMatchObject({ code: 3, err: de.notLoggedIn });
  expect((await laptop.cli(['whoami', '--json'])).json()).toEqual({ error: de.notLoggedIn });

  expect((await server.cli(['whoami'])).code).toBe(0);

  // Logging in again replaces the token of the device and revokes the old one
  const oldToken = await server.token();
  await server.cli(['login'], { email });
  expect(await sessionCount(oldToken)).toBe(0);
  expect(await sessionCount(await server.token())).toBe(1);
});

test('logging in at another address revokes the old token at its own address', async () => {
  const app = createApp(db);
  const seen: (string | null)[] = [];
  const other = Bun.serve({
    port: 0,
    fetch: (req) => {
      seen.push(req.headers.get('authorization'));
      return app.fetch(req);
    },
  });
  try {
    const email = freshEmail();
    const { cli, token } = await device();
    expect((await cli(['login', '--link', await issueMagicLink(email)])).code).toBe(0);
    const oldToken = await token();

    const login = await cli(['login', '--url', other.url.origin, '--link', await issueMagicLink(email)]);
    expect(login.code).toBe(0);
    expect(await sessionCount(oldToken)).toBe(0);
    expect(await sessionCount(await token())).toBe(1);
    expect(seen).toEqual([null]);
    expect((await cli(['whoami', '--json'], { raw: true })).json()).toMatchObject({ user: { email } });
  } finally {
    await other.stop(true);
  }
});

test('a session revoked on the server logs the CLI out', async () => {
  const { cli, token } = await device();
  await cli(['login'], { email: freshEmail() });
  await db.$client`delete from sessions where token_hash = ${hashToken(await token())}`;
  expect((await cli(['whoami'])).code).toBe(3);
  expect((await cli(['progress'])).code).toBe(3);
});

test('agents log in with a login link from stdin', async () => {
  const email = freshEmail();
  await db.insert(users).values({ email, name: 'Agent' });
  const link = await issueMagicLink(email);
  const { cli } = await device();

  expect((await cli(['login', '--link', '-'], { stdin: `${link}\n` })).code).toBe(0);
  expect((await cli(['whoami', '--json'])).json()).toMatchObject({ user: { email } });

  const again = await device();
  expect(await again.cli(['login', '--link', link])).toMatchObject({ code: 1, err: de.linkExpired });
  expect(await again.cli(['login', '--link', 'https://example.com/'])).toMatchObject({ code: 2 });
});

test('the CLI creates no account past the closed sign-up', async () => {
  process.env.SIGNUP_OPEN = 'false';
  try {
    const email = freshEmail();
    const { cli } = await device();
    const before = mails().length;

    const login = await cli(['login', '--json'], { email });
    expect(login.code).toBe(1);
    expect(login.json()).toEqual({ error: de.signupClosed });
    expect(mails().length).toBe(before);

    // A link issued for an unknown address doesn't get past it either
    const link = await issueMagicLink(email);
    expect(await cli(['login', '--link', link])).toMatchObject({ code: 1, err: de.signupClosed });
    expect(await db.$client`select id from users where email = ${email}`).toHaveLength(0);

    // The allowlist lets the address in, as in the web
    process.env.SIGNUP_ALLOWLIST = email;
    expect((await cli(['login'], { email })).code).toBe(0);
  } finally {
    process.env.SIGNUP_OPEN = 'true';
    delete process.env.SIGNUP_ALLOWLIST;
  }
});

test('the token only goes to the address it was issued for', async () => {
  const seen: (string | null)[] = [];
  const other = Bun.serve({
    port: 0,
    fetch: (req) => {
      seen.push(req.headers.get('authorization'));
      return Response.json({ error: 'nope' }, { status: 401 });
    },
  });
  try {
    const { cli } = await device();
    await cli(['login'], { email: freshEmail() });
    expect((await cli(['whoami', '--url', other.url.origin])).code).toBe(3);
    expect((await cli(['progress', '--url', other.url.origin])).code).toBe(3);
    expect(seen).toEqual([]);
    // The stored session stays for its own address, which later calls take without --url
    expect((await cli(['logout', '--url', other.url.origin])).code).toBe(0);
    expect((await cli(['whoami'])).code).toBe(0);
    expect((await cli(['whoami', '--json'], { raw: true })).json()).toMatchObject({
      user: { email: expect.any(String) },
    });
  } finally {
    await other.stop(true);
  }
});

test('help, wrong usage and an unreachable app', async () => {
  const { cli } = await device();
  const helpText = await cli([]);
  expect(helpText.code).toBe(0);
  expect(helpText.out).toContain(`${de.cliCommands}:`);
  expect(helpText.out).toContain(de.cliProgressHelp);

  const english = await device({ LANG: 'en_US.UTF-8' });
  expect((await english.cli(['--help'])).out).toContain(`${messages.en.cliCommands}:`);
  expect((await cli(['--help', '--lang', 'en'])).out).toContain(`${messages.en.cliCommands}:`);

  expect((await cli(['whoami', '--help', '--json'])).json()).toMatchObject({
    commands: expect.arrayContaining([{ usage: 'whoami', text: de.cliWhoamiHelp }]),
    exitCodes: { loggedOut: 3 },
  });

  expect(await cli(['frobnicate'])).toMatchObject({ code: 2, err: de.cliUnknownCommand('frobnicate', SLUG) });
  expect((await cli(['frobnicate', '--json'])).json()).toEqual({ error: de.cliUnknownCommand('frobnicate', SLUG) });
  expect((await cli(['whoami', '--nope'])).code).toBe(2);
  expect(await cli(['login', '--email', 'a@example.com', '--url', 'http://127.0.0.1:1'])).toMatchObject({
    code: 1,
    err: de.cliUnreachable('http://127.0.0.1:1'),
  });
});

test('an unwritable config folder ends with an error and revokes the new token', async () => {
  const blocked = join(await mkdtemp(join(tmpdir(), 'cli-')), 'file');
  await Bun.write(blocked, '');
  const { cli } = await device({ LANG: 'de_DE.UTF-8', XDG_CONFIG_HOME: blocked });
  const email = freshEmail();
  const login = await cli(['login', '--json'], { email });
  expect(login.code).toBe(1);
  expect(login.json()).toEqual({ error: expect.any(String) });
  expect(await db.$client`select id from users where email = ${email}`).toHaveLength(1);
  expect(
    await db.$client`select id from sessions where user_id = (select id from users where email = ${email})`,
  ).toHaveLength(0);
});

test('the entry point passes the exit code to the shell', async () => {
  const env = { ...process.env, LANG: 'en_US.UTF-8', XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), 'cli-')) };
  const main = join(import.meta.dir, 'main.ts');
  // Async, so the API in this process keeps answering
  const whoami = Bun.spawn(['bun', main, 'whoami', '--json', '--url', url], { env, stdout: 'pipe' });
  expect(await whoami.exited).toBe(3);
  expect(JSON.parse(await new Response(whoami.stdout).text())).toEqual({ error: messages.en.notLoggedIn });
  expect(await Bun.spawn(['bun', main, '--help'], { env, stdout: 'ignore' }).exited).toBe(0);
});
