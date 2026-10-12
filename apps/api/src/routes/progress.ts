import { type Database, userDays, userWords, words } from '@app/db';
import { type Progress, progressSchema } from '@app/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { validJson } from '../lib/validate';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

async function progressOf(db: Database, userId: string): Promise<Progress> {
  const [learned, days] = await Promise.all([
    db
      .select({ id: userWords.wordId, day: userWords.day })
      .from(userWords)
      .where(eq(userWords.userId, userId))
      .orderBy(asc(userWords.day)),
    db.select({ day: userDays.day }).from(userDays).where(eq(userDays.userId, userId)).orderBy(asc(userDays.day)),
  ]);
  return { words: learned, days: days.map((d) => d.day) };
}

// The browser keeps its own copy and sends what it learned, also what it
// learned before logging in. Merging keeps the first day of each word.
export const progressRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/', async (c) => c.json(await progressOf(c.get('db'), c.get('user').id)))
  .post('/', validJson(progressSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('user').id;
    const body = c.req.valid('json');

    const ids = [...new Set(body.words.map((w) => w.id))];
    const known = new Set(
      ids.length ? (await db.select({ id: words.id }).from(words).where(inArray(words.id, ids))).map((w) => w.id) : [],
    );
    const learned = body.words.filter((w) => known.has(w.id));
    if (learned.length) {
      await db
        .insert(userWords)
        .values(learned.map((w) => ({ userId, wordId: w.id, day: w.day })))
        .onConflictDoNothing();
    }
    if (body.days.length) {
      await db
        .insert(userDays)
        .values(body.days.map((day) => ({ userId, day })))
        .onConflictDoNothing();
    }
    return c.json(await progressOf(db, userId));
  });
