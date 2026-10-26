import { expect, test } from 'bun:test';

// Isolated processes keep module mocks and OS signals out of the other tests.
// Generous timeouts: each child boots, migrates and seeds on its own.
function start(setup: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `import { mock } from 'bun:test';
       ${setup}
       await import(${JSON.stringify(`${import.meta.dir}/index.ts`)});`,
    ],
    {
      env: { ...process.env, APP_URL: 'http://localhost', PORT: '0', SMTP_HOST: '', SENTRY_DSN: '', NODE_ENV: 'test' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const lines = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let output = '';
  async function until(marker: string) {
    while (!output.includes(marker)) {
      const { value, done } = await lines.read();
      if (done) throw new Error(`Child exited before ${marker}: ${output}\n${await child.stderr.text()}`);
      output += value;
    }
    return output;
  }
  return { child, until };
}

const appModule = JSON.stringify(`${import.meta.dir}/app.ts`);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  test(`API drains an active database request on ${signal}`, async () => {
    const { child, until } = start(
      `mock.module(${appModule}, () => ({
         createApp: (db) => ({ fetch: async () => {
           console.log('request-started');
           await db.execute('select pg_sleep(0.3)');
           return new Response('complete');
         } })
       }));`,
    );
    try {
      const output = await until('API listening on port ');
      const port = output.match(/API listening on port (\d+)/)![1];
      const response = fetch(`http://localhost:${port}`).then((res) => res.text());
      await until('request-started');
      child.kill(signal);
      expect(await response).toBe('complete');
      expect(await child.exited).toBe(0);
    } finally {
      child.kill('SIGKILL');
      await child.exited;
    }
  }, 30_000);

  test(`API finishes startup before closing on ${signal}`, async () => {
    const { child, until } = start(
      `const db = await import('@app/db');
       mock.module('@app/db', () => ({ ...db, seedWords: async (client) => {
         console.log('seed-started');
         await client.execute('select pg_sleep(0.3)');
         console.log('seed-finished');
       } }));`,
    );
    try {
      await until('seed-started');
      child.kill(signal);
      await until('seed-finished');
      expect(await child.exited).toBe(0);
    } finally {
      child.kill('SIGKILL');
      await child.exited;
    }
  }, 30_000);
}
