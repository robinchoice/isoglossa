import { type Database, userDays, userWords, words } from '@app/db';
import { type Progress, progressSchema } from '@app/shared';
import { asc, eq, inArray, sql } from 'drizzle-orm';
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
    const earliest = new Map<string, string>();
    for (const { id, day } of body.words) {
      const prev = earliest.get(id);
      if (known.has(id) && (!prev || day < prev)) earliest.set(id, day);
    }
    // A stable lock order also keeps overlapping batches from deadlocking.
    const learned = [...earliest].sort(([a], [b]) => a.localeCompare(b));
    if (learned.length) {
      await db
        .insert(userWords)
        .values(learned.map(([wordId, day]) => ({ userId, wordId, day })))
        .onConflictDoUpdate({
          target: [userWords.userId, userWords.wordId],
          set: { day: sql`least(${userWords.day}, excluded.day)` },
        });
    }
    if (body.days.length) {
      await db
        .insert(userDays)
        .values(body.days.map((day) => ({ userId, day })))
        .onConflictDoNothing();
    }
    return c.json(await progressOf(db, userId));
  });
