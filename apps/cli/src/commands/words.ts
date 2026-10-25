import { cognateLangs, LANGS, type Lang, meaning, type WordData } from '@app/shared';
import { z } from 'zod';
import { type Command, type Context, EXIT, Failure } from '../command';
import { SLUG } from '../config';

const text = z.object({ de: z.string(), en: z.string() });
const wordSchema: z.ZodType<WordData> = z.object({
  id: z.string(),
  de: z.string(),
  en: z.string(),
  forms: z.record(
    z.enum(LANGS),
    z.object({ form: z.string(), roman: z.string().optional(), cognate: z.boolean(), group: z.string().optional() }),
  ),
  etymology: z.array(z.object({ form: z.string(), roman: z.string().optional(), lang: text })),
  fact: text,
  groups: z.record(z.string(), text).optional(),
});
const wordsSchema = z.object({ words: z.array(wordSchema) });
export const progressSchema = z.object({
  words: z.array(z.object({ id: z.string(), day: z.string() })),
  days: z.array(z.string()),
});

// All words, and when logged in the day each one was collected. Without login
// nothing is collected, the progress then lives only in the browser.
export async function wordsAndProgress({ api, session }: Context) {
  const [all, mine] = await Promise.all([
    api.get('/words', wordsSchema),
    session ? api.get('/progress', progressSchema) : null,
  ]);
  const learned = new Map(mine?.words.map((w) => [w.id, w.day]));
  return { words: all.words, learned, days: mine?.days ?? [] };
}

// Collected first, newest first, then the rest by meaning
function byCollected(list: WordData[], learned: Map<string, string>, locale: Context['locale']) {
  return [...list].sort(
    (a, b) =>
      (learned.get(b.id) ?? '').localeCompare(learned.get(a.id) ?? '') ||
      meaning(a, locale).localeCompare(meaning(b, locale)),
  );
}

const mark = (learned: boolean) => (learned ? '✓' : ' ');
const roman = (form: { roman?: string }) => (form.roman ? ` (${form.roman})` : '');

// Like /words in the web, but with every word, so agents find the ids for `word`
export const words: Command = {
  help: (m) => [['words', m.cliWordsHelp]],
  async run(ctx) {
    const { m, locale } = ctx;
    const { words: all, learned } = await wordsAndProgress(ctx);
    const rows = byCollected(all, learned, locale).map((word) => ({
      id: word.id,
      meaning: meaning(word, locale),
      langs: cognateLangs(word).length,
      learned: learned.get(word.id) ?? null,
    }));
    const idWidth = Math.max(...rows.map((row) => row.id.length)) + 2;
    const meaningWidth = Math.max(...rows.map((row) => row.meaning.length)) + 2;
    return {
      data: { words: rows },
      text: [
        m.cliWordsSummary(learned.size, all.length),
        '',
        ...rows.map(
          (row) =>
            `  ${mark(!!row.learned)} ${row.id.padEnd(idWidth)}${row.meaning.padEnd(meaningWidth)}${row.langs}/${LANGS.length}`,
        ),
      ].join('\n'),
    };
  },
};

// The word detail of the web (?word=<id>): every language, origin and fact
export const word: Command = {
  help: (m) => [['word <id>', m.cliWordHelp]],
  args: ['id'],
  async run(ctx) {
    const { m, locale, args } = ctx;
    const { words: all, learned } = await wordsAndProgress(ctx);
    const found = all.find((w) => w.id === args[0]);
    if (!found) throw new Failure(m.cliUnknownWord(args[0]!, SLUG), EXIT.error);
    const day = learned.get(found.id) ?? null;

    const width = Math.max(...LANGS.map((lang) => m.langs[lang].length)) + 2;
    const forms = LANGS.map((lang) => {
      const form = found.forms[lang];
      const group = form.group && found.groups?.[form.group]?.[locale];
      const note = form.cognate ? (group ? ` · ${group}` : '') : ` – ${m.otherWordLegend}`;
      return `  ${m.langs[lang].padEnd(width)}${form.form}${roman(form)}${note}`;
    });
    const origin = found.etymology.map((step) => `${step.form}${roman(step)} ${step.lang[locale]}`).join(' → ');
    return {
      data: { word: found, learned: day },
      text: [
        `${meaning(found, locale)} (${found.id})`,
        `${m.sameIn(cognateLangs(found).length)}${day ? ` · ${m.collected}` : ''}`,
        '',
        ...forms,
        '',
        `${m.origin}: ${origin}`,
        found.fact[locale],
      ].join('\n'),
    };
  },
};

// /map/<lang>: the words that count in one language, collected ones marked
export const lang: Command = {
  help: (m) => [['lang <code>', m.cliLanguageHelp]],
  args: ['code'],
  async run(ctx) {
    const { m, locale, args } = ctx;
    const code = args[0] as Lang;
    if (!LANGS.includes(code)) throw new Failure(m.cliUnknownLang(args[0]!, LANGS.join(', ')), EXIT.usage);
    const { words: all, learned } = await wordsAndProgress(ctx);
    const rows = byCollected(
      all.filter((w) => w.forms[code].cognate),
      learned,
      locale,
    ).map((w) => ({
      id: w.id,
      meaning: meaning(w, locale),
      form: w.forms[code].form,
      roman: w.forms[code].roman ?? null,
      learned: learned.get(w.id) ?? null,
    }));
    const known = rows.filter((row) => row.learned).length;
    const width = Math.max(...rows.map((row) => row.meaning.length)) + 2;
    return {
      data: { lang: code, known, open: rows.length - known, words: rows },
      text: [
        m.langs[code],
        m.langSummary(known, rows.length - known),
        '',
        ...rows.map(
          (row) =>
            `  ${mark(!!row.learned)} ${row.meaning.padEnd(width)}${row.form}${row.roman ? ` (${row.roman})` : ''}`,
        ),
      ].join('\n'),
    };
  },
};
