import { LANGS, type Lang, type Locale, type WordData } from '@app/shared';

export const meaning = (word: WordData, locale: Locale) => (locale === 'de' ? word.de : word.en);

export const cognateLangs = (word: WordData) => LANGS.filter((lang) => word.forms[lang].cognate);

// The browser's date as YYYY-MM-DD. Rounds and streaks follow the user's day, not UTC.
export function localDay(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Scripts other than Latin make the better riddles
const OTHER_SCRIPT: Lang[] = ['ru', 'el', 'ar', 'he', 'hi', 'ja', 'ko'];

export type Question = { id: string; lang: Lang; options: string[] };

// Small seeded generator, so a day's round stays the same on reload
function random(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rnd: () => number) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// Five new words, each shown in a language where it is the same word, preferably
// in another script and not twice in the same language. Old words fill up once
// everything is learned. The UI language is never asked, its word is the answer.
export function makeRound(words: WordData[], learned: Set<string>, seed: string, locale: Locale): Question[] {
  const rnd = random(seed);
  const fresh = shuffle(
    words.filter((w) => !learned.has(w.id)),
    rnd,
  );
  const old = shuffle(
    words.filter((w) => learned.has(w.id)),
    rnd,
  );
  const used = new Set<Lang>();
  return [...fresh, ...old].slice(0, 5).map((word) => {
    const langs = cognateLangs(word).filter((lang) => lang !== locale);
    const pick = (list: Lang[]) => list[Math.floor(rnd() * list.length)];
    const lang =
      pick(langs.filter((l) => OTHER_SCRIPT.includes(l) && !used.has(l))) ??
      pick(langs.filter((l) => OTHER_SCRIPT.includes(l))) ??
      pick(langs.filter((l) => !used.has(l))) ??
      langs[0]!;
    used.add(lang);
    const others = shuffle(
      words.filter((w) => w.id !== word.id),
      rnd,
    ).slice(0, 3);
    return { id: word.id, lang, options: shuffle([word.id, ...others.map((w) => w.id)], rnd) };
  });
}

// Days in a row with a finished round, up to today. A streak survives until
// the end of the day after the last round.
export function streak(days: Set<string>, today = new Date()) {
  const day = new Date(today);
  if (!days.has(localDay(day))) day.setDate(day.getDate() - 1);
  let count = 0;
  while (days.has(localDay(day))) {
    count++;
    day.setDate(day.getDate() - 1);
  }
  return count;
}
