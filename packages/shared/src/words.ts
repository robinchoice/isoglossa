import { z } from 'zod';

// The languages a word can count in, in the order of the map
export const LANGS = ['en', 'fr', 'es', 'it', 'pl', 'ru', 'el', 'tr', 'ar', 'he', 'hi', 'ja', 'ko', 'sw'] as const;
export type Lang = (typeof LANGS)[number];

// A few letters that show the script on the map tiles
export const LANG_SAMPLE: Record<Lang, string> = {
  en: 'Aa',
  fr: 'Àé',
  es: 'Ññ',
  it: 'Èè',
  pl: 'Łł',
  ru: 'Жж',
  el: 'Ωω',
  tr: 'Şş',
  ar: 'ع',
  he: 'א',
  hi: 'अ',
  ja: 'カ',
  ko: '한',
  sw: 'Ng',
};

// Written right to left
export const RTL: Lang[] = ['ar', 'he'];

type Text = { de: string; en: string };

// One word of the seed in packages/db/src/seed/words.json. cognate is false
// where a language uses another word, e.g. Hebrew מונית for taxi. group splits
// the cognates into branches with a name in groups, like te and cha for tea.
export type WordData = {
  id: string;
  de: string;
  en: string;
  forms: Record<Lang, { form: string; roman?: string; cognate: boolean; group?: string }>;
  // Oldest first, ends with the English word
  etymology: { form: string; roman?: string; lang: Text }[];
  fact: Text;
  groups?: Record<string, Text>;
};

// A learned word and the day of a finished round, both as the browser's local date
const day = z.iso.date();

export const progressSchema = z.object({
  words: z.array(z.object({ id: z.string().max(100), day })).max(1000),
  days: z.array(day).max(1000),
});

export type Progress = z.infer<typeof progressSchema>;
