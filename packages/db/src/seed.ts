import { wordSchema } from '@app/shared';
import { sql } from 'drizzle-orm';
import type { Database } from './index';
import { words } from './schema';
import seed from './seed/words.json';

// Brings the words table to the state of words.json. Words dropped from the
// file stay, so nobody loses progress.
export async function seedWords(db: Database) {
  await db
    .insert(words)
    .values(
      wordSchema
        .array()
        .parse(seed)
        .map((data) => ({ id: data.id, data })),
    )
    .onConflictDoUpdate({
      target: words.id,
      set: { data: sql`excluded.data`, updatedAt: sql`now()` },
      setWhere: sql`${words.data} is distinct from excluded.data`,
    });
}
