<script lang="ts">
  import { LANGS, RTL } from '@app/shared';
  import { page } from '$app/state';
  import { auth } from '$lib/auth.svelte';
  import { t } from '$lib/i18n';
  import { answer, ensureRound, extraRound, nextQuestion, progress } from '$lib/progress.svelte';
  import { cognateLangs, localDay, meaning } from '$lib/words';

  let { data } = $props();

  const locale = $derived(page.data.locale);
  const byId = $derived(new Map(data.words.map((w) => [w.id, w])));

  $effect(() => {
    if (progress.ready) ensureRound(data.words, locale);
  });

  const round = $derived(progress.ready ? progress.round : null);
  const question = $derived(round?.questions[round.index]);
  const word = $derived(question && byId.get(question.id));
  const picked = $derived(round?.answers[round.index] ?? null);
  const done = $derived(!!round && round.index >= round.questions.length);

  // What the round won: every word counts once per language it is the same in
  const pairs = $derived(
    round?.questions.reduce((sum, q) => {
      const w = byId.get(q.id);
      return sum + (w ? cognateLangs(w).length : 0);
    }, 0) ?? 0,
  );

  // The last seven days, today at the end
  const week = $derived.by(() => {
    const played = new Set(progress.days);
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date();
      day.setDate(day.getDate() - 6 + i);
      return { label: t().weekdays[day.getDay()]!, on: played.has(localDay(day)) };
    });
  });
</script>

<div class="today">
  {#if !round}
    <p class="muted">{t().loading}</p>
  {:else if done}
    <div class="done">
      <span class="tag">{t().roundDone}</span>
      <h1>{t().roundWords(round.questions.length)}<br />{t().roundPairs(pairs)}</h1>
      <p class="muted small">{t().roundHint}</p>
      <div class="streak">
        {#each week as day}
          <i class:on={day.on}>{day.label}</i>
        {/each}
      </div>
      <a class="btn primary full" href="/map">{t().showOnMap}</a>
      <button type="button" class="btn ghost full" onclick={() => extraRound(data.words, locale)}>
        {t().anotherRound}
      </button>
      {#if !auth.user}
        <p class="hint">
          {t().localOnly}
          <a href="/login?next=%2Fmap">{t().keepProgress}</a>
        </p>
      {/if}
    </div>
  {:else if question && word}
    {@const form = word.forms[question.lang]}
    <div class="steps" role="progressbar" aria-label={t().question(round.index + 1, round.questions.length)} aria-valuenow={round.index + 1} aria-valuemin={1} aria-valuemax={round.questions.length}>
      {#each round.questions as _, i}
        <i class:done={i < round.index} class:cur={i === round.index}></i>
      {/each}
    </div>
    <div class="q">
      <div class="tag">{t().whatIsThis(t().langs[question.lang])}</div>
      {#key round.key + round.index}
        <div class="script fade" lang={question.lang}>
          <bdi dir={RTL.includes(question.lang) ? 'rtl' : 'ltr'}>{form.form}</bdi>
        </div>
      {/key}
      <div class="muted small roman">{picked && form.roman ? form.roman : ''}&nbsp;</div>
    </div>
    <div class="opts">
      {#each question.options as option}
        <button
          type="button"
          class="opt"
          class:right={picked && option === question.id}
          class:wrong={picked === option && option !== question.id}
          disabled={!!picked}
          onclick={() => answer(option)}
        >
          {meaning(byId.get(option)!, locale)}
        </button>
      {/each}
    </div>
    {#if picked}
      <div class="reveal fade" aria-live="polite">
        <b>{picked === question.id ? t().correct : t().almost}</b>
        <bdi>{form.form}</bdi> = {meaning(word, locale)}
        {#if form.roman}<span class="soft">({form.roman})</span>{/if}
        <div class="forms">
          {#each LANGS.filter((l) => word.forms[l].cognate) as lang}
            <span title={t().langs[lang]}><bdi>{word.forms[lang].form}</bdi></span>
          {/each}
        </div>
        <div class="plus">{t().plusIn(cognateLangs(word).length)}</div>
        <p class="fact">{word.fact[locale]}</p>
        <div class="actions">
          <a class="btn ghost light" href="?word={word.id}">{t().viewWord}</a>
          <button type="button" class="btn primary grow" onclick={nextQuestion}>
            {round.index === round.questions.length - 1 ? t().finishRound : t().next}
          </button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .today {
    max-width: 560px;
    margin: 0 auto;
  }
  .muted {
    margin: 0;
    color: var(--muted);
  }
  .small {
    font-size: 0.85rem;
  }
  .tag {
    color: var(--muted);
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .steps {
    display: flex;
    gap: 6px;
    margin: 4px 0 22px;
  }
  .steps i {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--paper2);
  }
  .steps i.done {
    background: var(--gradient);
  }
  .steps i.cur {
    background: var(--gold-bg);
  }
  .q {
    padding: 22px 0 16px;
    text-align: center;
  }
  .script {
    font-family: var(--script);
    font-size: clamp(2.8rem, 12vw, 4rem);
    line-height: 1.2;
  }
  .roman {
    min-height: 1.3em;
  }
  .opts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .opt {
    padding: 16px 10px;
    border: 1.5px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 1.05rem;
    font-weight: 500;
    cursor: pointer;
  }
  .opt:disabled {
    cursor: default;
  }
  .opt.right {
    border-color: var(--new);
    background: #e3f3e8;
    color: var(--new);
  }
  .opt.wrong {
    border-color: var(--error);
    background: #fbe3e3;
    color: var(--error);
  }
  .reveal {
    margin-top: 16px;
    padding: 16px;
    border-radius: 18px;
    background: var(--ink);
    color: #f2f0ea;
  }
  .soft {
    color: #9a98a3;
  }
  .forms {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 10px 0;
  }
  .forms span {
    padding: 5px 9px;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.08);
    font-family: var(--script);
    font-size: 0.95rem;
  }
  .plus {
    color: var(--gold-bg);
    font-weight: 700;
  }
  .fact {
    margin: 6px 0 0;
    color: #cfcdc6;
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }
  .grow {
    flex: 1;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 13px 18px;
    border: 1.5px solid transparent;
    border-radius: 14px;
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    background: var(--gradient);
    color: var(--ink);
  }
  .ghost {
    border-color: var(--border);
    background: transparent;
    color: var(--text);
  }
  .ghost.light {
    border-color: rgb(255 255 255 / 0.2);
    color: #f2f0ea;
  }
  .full {
    width: 100%;
    margin-top: 10px;
  }
  h1 {
    margin: 6px 0;
    font-size: clamp(2rem, 7vw, 2.6rem);
  }
  .streak {
    display: flex;
    gap: 6px;
    margin: 14px 0 20px;
  }
  .streak i {
    display: grid;
    flex: 1;
    place-items: center;
    aspect-ratio: 1;
    border-radius: 10px;
    background: var(--paper2);
    color: var(--muted);
    font-size: 0.7rem;
    font-style: normal;
  }
  .streak i.on {
    background: var(--gold-bg);
    color: var(--ink);
    font-weight: 700;
  }
  .hint {
    margin: 16px 0 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .fade {
    animation: fade 0.35s ease both;
  }
  @keyframes fade {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
