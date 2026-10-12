import type { Locale, Progress, WordData } from '@app/shared';
import { api } from './api';
import { auth, logout } from './auth.svelte';
import { localDay, makeRound, type Question } from './words';

const PROGRESS_KEY = 'progress';
const ROUND_KEY = 'round';

export type Round = {
  // The day, with #2, #3 … for extra rounds
  key: string;
  questions: Question[];
  index: number;
  // The option picked per question, null until answered
  answers: (string | null)[];
};

// Kept in localStorage, so the round works without login. Logged in, every
// change also goes to the API, which merges it into the account.
export const progress = $state({
  ready: false,
  learned: {} as Record<string, string>,
  days: [] as string[],
  round: null as Round | null,
});

function save() {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify({ learned: progress.learned, days: progress.days }));
  localStorage.setItem(ROUND_KEY, JSON.stringify(progress.round));
}

// A word counts from the first day it was learned
function merge(server: Progress) {
  for (const { id, day } of server.words) {
    const known = progress.learned[id];
    if (!known || day < known) progress.learned[id] = day;
  }
  progress.days = [...new Set([...progress.days, ...server.days])].sort();
}

async function sync(part: Progress) {
  if (!auth.user) return;
  merge(await api.post<Progress>('/progress', part));
  save();
}

// Call after checkAuth. Sends what this browser learned before the login.
export async function loadProgress() {
  const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? 'null');
  progress.learned = saved?.learned ?? {};
  progress.days = saved?.days ?? [];
  progress.round = JSON.parse(localStorage.getItem(ROUND_KEY) ?? 'null');
  progress.ready = true;
  await sync({
    words: Object.entries(progress.learned).map(([id, day]) => ({ id, day })),
    days: progress.days,
  }).catch(() => {});
}

// Logging out leaves nothing behind for the next person on this browser
export async function logOut() {
  await logout();
  clearProgress();
}

function clearProgress() {
  localStorage.removeItem(PROGRESS_KEY);
  localStorage.removeItem(ROUND_KEY);
  progress.learned = {};
  progress.days = [];
  progress.round = null;
}

function startRound(words: WordData[], locale: Locale, key: string) {
  const questions = makeRound(words, new Set(Object.keys(progress.learned)), key, locale);
  progress.round = { key, questions, index: 0, answers: questions.map(() => null) };
  save();
}

// Today's round, kept across reloads until the day changes
export function ensureRound(words: WordData[], locale: Locale) {
  const today = localDay();
  if (progress.round?.key.split('#')[0] !== today) startRound(words, locale, today);
}

export function extraRound(words: WordData[], locale: Locale) {
  const today = localDay();
  const n = Number(progress.round?.key.split('#')[1] ?? 1);
  startRound(words, locale, `${today}#${n + 1}`);
}

// Right or wrong, the word was seen and read: it counts as learned
export function answer(option: string) {
  const round = progress.round!;
  const { id } = round.questions[round.index]!;
  round.answers[round.index] = option;
  const day = localDay();
  if (!progress.learned[id]) progress.learned[id] = day;
  save();
  sync({ words: [{ id, day }], days: [] }).catch(() => {});
}

export function nextQuestion() {
  const round = progress.round!;
  round.index++;
  if (round.index < round.questions.length) return save();
  const day = localDay();
  if (!progress.days.includes(day)) progress.days.push(day);
  save();
  sync({ words: [], days: [day] }).catch(() => {});
}
