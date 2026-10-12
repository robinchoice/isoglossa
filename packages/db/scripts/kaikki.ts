// Drafts new words for src/seed/words.json from the English Wiktionary via
// kaikki.org (wiktextract, CC BY-SA). Takes English lemmas, adds the ones the
// file doesn't hold yet and prints how alike the forms are. Review the draft by
// hand: cognate flags, German meaning, etymology names and the fact sentences.
// Run: bun scripts/kaikki.ts coffee tea chocolate
import { readFileSync, writeFileSync } from 'node:fs';
import { LANGS, type WordData } from '@app/shared';

const FILE = new URL('../src/seed/words.json', import.meta.url);

// Etymology languages we name in German, the rest keep their English name until reviewed
const LANG_DE: Record<string, string> = {
  Arabic: 'Arabisch',
  'Ottoman Turkish': 'Osmanisch',
  Turkish: 'Türkisch',
  Persian: 'Persisch',
  'Middle Persian': 'Mittelpersisch',
  Sanskrit: 'Sanskrit',
  Hindi: 'Hindi',
  Italian: 'Italienisch',
  French: 'Französisch',
  'Middle French': 'Mittelfranzösisch',
  'Old French': 'Altfranzösisch',
  Spanish: 'Spanisch',
  Portuguese: 'Portugiesisch',
  Dutch: 'Niederländisch',
  'Middle Dutch': 'Mittelniederländisch',
  German: 'Deutsch',
  English: 'Englisch',
  'Middle English': 'Mittelenglisch',
  'Old English': 'Altenglisch',
  Latin: 'Latein',
  'Late Latin': 'Spätlatein',
  'Medieval Latin': 'Mittellatein',
  'New Latin': 'Neulatein',
  'Ancient Greek': 'Altgriechisch',
  Greek: 'Griechisch',
  Japanese: 'Japanisch',
  Chinese: 'Chinesisch',
  Korean: 'Koreanisch',
  Russian: 'Russisch',
  Hungarian: 'Ungarisch',
  'Serbo-Croatian': 'Serbokroatisch',
  'Classical Nahuatl': 'Nahuatl',
  Nahuatl: 'Nahuatl',
  Swahili: 'Swahili',
  Hebrew: 'Hebräisch',
  Malay: 'Malaiisch',
  Tamil: 'Tamil',
  Finnish: 'Finnisch',
};

const CHAIN = new Set(['bor', 'bor+', 'der', 'der+', 'inh', 'inh+', 'lbor', 'slbor', 'uder', 'ubor']);

type Entry = {
  pos: string;
  word: string;
  translations?: { code?: string; word?: string; roman?: string; sense?: string }[];
  etymology_templates?: { name: string; args: Record<string, string>; expansion: string }[];
};

// Vowel points, Arabic short vowels and Russian stress marks are reading aids, not spelling
function clean(code: string, word: string) {
  // Spelling variants come as "a \ b"
  word = word.split(' \\ ')[0]!;
  if (code === 'he') return word.replace(/[֑-ׇ]/g, '');
  if (code === 'ar') return word.replace(/[ً-ٰٟ]/g, '');
  if (code === 'ru') return word.replace(/́/g, '');
  return word;
}

// Rough sound shape, so that café, kahve and kofe come out close
function shape(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/ı/g, 'i')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/[cq]/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/[yj]/g, 'i')
    .replace(/w/g, 'v')
    .replace(/z/g, 's')
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1/g, '$1');
}

function similarity(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return 1 - d[b.length]! / Math.max(a.length, b.length, 1);
}

async function draft(lemma: string): Promise<WordData | null> {
  const url = `https://kaikki.org/dictionary/English/meaning/${lemma[0]}/${lemma.slice(0, 2)}/${lemma}.jsonl`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`${lemma}: ${res.status} from kaikki`);
    return null;
  }
  const entries: Entry[] = (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const noun = entries.find((e) => e.pos === 'noun' && e.translations?.length);
  if (!noun) {
    console.error(`${lemma}: no noun with translations`);
    return null;
  }

  // The sense with the most of our languages is the main one
  const codes = new Set<string>(['de', ...LANGS]);
  const bySense = Map.groupBy(
    noun.translations!.filter((t) => t.code && codes.has(t.code) && t.word),
    (t) => t.sense ?? '',
  );
  const best =
    [...bySense.values()].sort((a, b) => new Set(b.map((t) => t.code)).size - new Set(a.map((t) => t.code)).size)[0] ??
    [];
  const first = (code: string) => best.find((t) => t.code === code);

  const de = first('de')?.word;
  const missing = LANGS.filter((code) => code !== 'en' && !first(code));
  if (!de || missing.length) {
    console.error(`${lemma}: missing ${[!de && 'de', ...missing].filter(Boolean).join(', ')}`);
    return null;
  }

  const raw = LANGS.map((code) => {
    if (code === 'en') return { code, form: lemma, roman: undefined };
    const t = first(code)!;
    return { code, form: clean(code, t.word!), roman: t.roman };
  });
  const shapes = raw.map((f) => shape(f.roman ?? f.form));
  // Median likeness to all other forms. Below 0.4 it is usually another word.
  const scores = shapes.map((s, i) => {
    const sims = shapes.filter((_, j) => j !== i).map((o) => similarity(s, o));
    return sims.sort((a, b) => a - b)[Math.floor(sims.length / 2)]!;
  });
  console.error(
    `${lemma} (${de}): ${raw.map((f, i) => `${f.code} ${f.roman ?? f.form} ${scores[i]!.toFixed(2)}`).join(' · ')}`,
  );

  const etymology: WordData['etymology'] = [];
  for (const t of noun.etymology_templates ?? []) {
    if (t.name === 'etymon' || t.name === 'root') continue;
    if (!CHAIN.has(t.name)) break;
    const term = t.args['3'];
    const at = term ? t.expansion.indexOf(term) : -1;
    if (!term || at < 0) continue;
    // "Borrowed from Dutch koffie" → Dutch
    const en = t.expansion
      .slice(0, at)
      .replace(/^.*\bfrom\s+/i, '')
      .trim();
    etymology.unshift({
      form: clean(t.args['2'] ?? '', term),
      ...(t.args.tr ? { roman: t.args.tr } : {}),
      lang: { de: LANG_DE[en] ?? en, en },
    });
  }
  etymology.push({ form: lemma, lang: { de: 'Englisch', en: 'English' } });

  return {
    id: lemma,
    de,
    en: lemma,
    forms: Object.fromEntries(
      raw.map((f, i) => [f.code, { form: f.form, ...(f.roman ? { roman: f.roman } : {}), cognate: scores[i]! >= 0.4 }]),
    ) as WordData['forms'],
    etymology: etymology.slice(-5),
    fact: { de: '', en: '' },
  };
}

const words: WordData[] = JSON.parse(readFileSync(FILE, 'utf8'));
for (const lemma of process.argv.slice(2)) {
  if (words.some((w) => w.id === lemma)) continue;
  const word = await draft(lemma);
  if (word) words.push(word);
}
writeFileSync(FILE, `${JSON.stringify(words, null, 2)}\n`);
