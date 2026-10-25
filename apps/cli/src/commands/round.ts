import { cognateLangs, localDay, makeRound, meaning, streak } from '@app/shared';
import { type Command, EXIT, Failure } from '../command';
import { SLUG } from '../config';
import { progressSchema, wordsAndProgress } from './words';

// Today's round of the web (/), in the terminal: the riddles and options go to
// stderr, the answers come by number from stdin, so `--json` still prints one
// value. Logged in, every answer and the finished round go to the account like
// in the web. The round follows the local day and what the account has learned.
export const round: Command = {
  help: (m) => [['round', m.cliRoundHelp]],
  async run(ctx) {
    const { api, session, m, locale, io } = ctx;
    const { words, learned } = await wordsAndProgress(ctx);
    const byId = new Map(words.map((w) => [w.id, w]));
    const day = localDay();
    const questions = makeRound(words, new Set(learned.keys()), day, locale);

    const results = [];
    for (const [i, question] of questions.entries()) {
      const word = byId.get(question.id)!;
      const form = word.forms[question.lang];
      io.err(
        [
          '',
          `${m.question(i + 1, questions.length)} · ${m.whatIsThis(m.langs[question.lang])}`,
          `  ${form.form}`,
          ...question.options.map((id, n) => `  ${n + 1}  ${meaning(byId.get(id)!, locale)}`),
        ].join('\n'),
      );
      const choice = Number((await io.ask(m.cliAskAnswer(question.options.length))).trim());
      const answer = question.options[choice - 1];
      if (!Number.isInteger(choice) || !answer) throw new Failure(m.cliBadChoice(question.options.length), EXIT.usage);

      // Right or wrong, the word was seen and read: it counts as learned
      if (session) await api.post('/progress', progressSchema, { words: [{ id: word.id, day }], days: [] });
      const correct = answer === word.id;
      const langs = cognateLangs(word);
      io.err(
        [
          `${correct ? m.correct : m.almost} ${form.form}${form.roman ? ` (${form.roman})` : ''} = ${meaning(word, locale)}`,
          [...new Set(langs.map((lang) => word.forms[lang].form))].join(' · '),
          m.plusIn(langs.length),
          word.fact[locale],
        ].join('\n'),
      );
      results.push({ id: word.id, lang: question.lang, form: form.form, options: question.options, answer, correct });
    }

    const finished = session && (await api.post('/progress', progressSchema, { words: [], days: [day] }));
    const days = finished ? streak(new Set(finished.days)) : null;
    const pairs = results.reduce((sum, q) => sum + cognateLangs(byId.get(q.id)!).length, 0);
    return {
      data: { day, questions: results, pairs, saved: !!finished, streak: days },
      text: [
        '',
        m.roundDone,
        `${m.roundWords(results.length)} ${m.roundPairs(pairs)}`,
        days === null ? m.cliRoundNotSaved(SLUG) : m.streak(days),
      ].join('\n'),
    };
  },
};
