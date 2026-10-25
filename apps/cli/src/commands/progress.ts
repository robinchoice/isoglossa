import { LANGS } from '@app/shared';
import { type Command, EXIT, Failure } from '../command';
import { wordsAndProgress } from './words';

// What /map shows in the web: the learned words, counted in every language
// where they are the same word. The progress of an account, so it needs the login.
export const progress: Command = {
  help: (m) => [['progress', m.cliProgressHelp]],
  async run(ctx) {
    const { m } = ctx;
    if (!ctx.session) throw new Failure(m.notLoggedIn, EXIT.loggedOut);
    const { words: all, learned, days } = await wordsAndProgress(ctx);

    const langs = LANGS.map((lang) => {
      const words = all.filter((w) => w.forms[lang].cognate);
      return { lang, known: words.filter((w) => learned.has(w.id)).length, all: words.length };
    });
    const total = langs.reduce((sum, row) => sum + row.known, 0);

    const width = Math.max(...LANGS.map((lang) => m.langs[lang].length)) + 2;
    return {
      data: { total, words: [...learned].map(([id, day]) => ({ id, day })), days, langs },
      text: [
        `${m.youKnow} ${total} ${m.wordsInLangs(LANGS.length)}`,
        m.cliProgressSummary(learned.size, days.length),
        '',
        ...langs.map((row) => `  ${m.langs[row.lang].padEnd(width)}${row.known}/${row.all}`),
      ].join('\n'),
    };
  },
};
