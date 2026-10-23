import { createHash, randomBytes } from 'node:crypto';
import type { Sql } from 'postgres';

export async function createUserWithMagicLink(sql: Sql) {
  const email = `e2e-${crypto.randomUUID()}@example.com`;
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await sql`insert into users (email, name) values (${email}, 'Tester')`;
  await sql`insert into magic_links (email, token_hash, expires_at)
    values (${email}, ${tokenHash}, ${new Date(Date.now() + 15 * 60_000)})`;
  return { email, token };
}
