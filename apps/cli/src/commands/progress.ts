import { LANGS } from '@app/shared';
import { z } from 'zod';
import { type Command, EXIT, Failure } from '../command';

const progressSchema = z.object({
  words: z.array(z.object({ id: z.string(), day: z.string() })),
  days: z.array(z.string()),
});
const wordsSchema = z.object({
  words: z.array(z.object({ id: z.string(), forms: z.record(z.enum(LANGS), z.object({ cognate: z.boolean() })) })),
});

// What /map shows in the web: the learned words, counted in every language
// where they are the same word. The progress of an account, so it needs the login.
export const progress: Command = {
  help: (m) => [['progress', m.cliProgressHelp]],
  async run({ api, session, m }) {
    if (!session) throw new Failure(m.notLoggedIn, EXIT.loggedOut);
    const [mine, all] = await Promise.all([api.get('/progress', progressSchema), api.get('/words', wordsSchema)]);

    const learned = new Set(mine.words.map((w) => w.id));
    const langs = LANGS.map((lang) => {
      const words = all.words.filter((w) => w.forms[lang].cognate);
      return { lang, known: words.filter((w) => learned.has(w.id)).length, all: words.length };
    });
    const total = langs.reduce((sum, row) => sum + row.known, 0);

    const width = Math.max(...LANGS.map((lang) => m.langs[lang].length)) + 2;
    return {
      data: { total, words: mine.words, days: mine.days, langs },
      text: [
        `${m.youKnow} ${total} ${m.wordsInLangs(LANGS.length)}`,
        m.cliProgressSummary(learned.size, mine.days.length),
        '',
        ...langs.map((row) => `  ${m.langs[row.lang].padEnd(width)}${row.known}/${row.all}`),
      ].join('\n'),
    };
  },
};
