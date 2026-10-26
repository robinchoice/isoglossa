import { type Database, users } from '@app/db';
import { eq } from 'drizzle-orm';

// Env lists of addresses, read on every call, so the tests can switch them
const envList = (name: string) => (process.env[name] ?? '').split(',').map((entry) => entry.trim().toLowerCase());

export async function mayLogIn(db: Database, email: string) {
  if (process.env.SIGNUP_OPEN === 'true') return true;
  if (envList('SIGNUP_ALLOWLIST').includes(email)) return true;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return !!user;
}

// Savor's test account stays out of ADMIN_EMAILS, so agents see no tester data.
export function isAdmin(email: string) {
  return envList('ADMIN_EMAILS').includes(email);
}
