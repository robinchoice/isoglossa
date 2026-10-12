import type { WordData } from '@app/shared';
import type { LayoutLoad } from './$types';

// All words once per visit, server-rendered and then reused while navigating
export const load: LayoutLoad = async ({ fetch }) => {
  const res = await fetch('/api/v1/words');
  if (!res.ok) throw new Error(`GET /api/v1/words → ${res.status}`);
  const { words } = (await res.json()) as { words: WordData[] };
  return { words };
};
