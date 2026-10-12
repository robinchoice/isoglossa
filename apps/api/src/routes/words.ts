import { words } from '@app/db';
import { asc } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../types';

// All words at once, a few dozen kilobytes. The web picks the rounds itself,
// so the round works without login.
export const wordRoutes = new Hono<AppEnv>().get('/', async (c) => {
  const rows = await c.get('db').select({ data: words.data }).from(words).orderBy(asc(words.id));
  c.header('cache-control', 'public, max-age=300');
  return c.json({ words: rows.map((row) => row.data) });
});
