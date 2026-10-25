<script lang="ts">
  import { cognateLangs, LANGS, type Lang, meaning } from '@app/shared';
  import { auth } from '$lib/auth.svelte';
  import { openFeedback } from '$lib/feedback.svelte';
  import { t } from '$lib/i18n';
  import { logOut, progress } from '$lib/progress.svelte';

  let { data } = $props();

  // A taste of three scripts per word
  const SAMPLE: Lang[] = ['he', 'ja', 'ru'];

  // Newest first
  const known = $derived(
    data.words
      .filter((w) => progress.learned[w.id])
      .sort((a, b) => progress.learned[b.id]!.localeCompare(progress.learned[a.id]!)),
  );
</script>

<h1>{t().yourWords}</h1>
<p class="muted small">{t().wordsSummary(known.length)}</p>

{#if progress.ready && !auth.user}
  <p class="note">
    {t().localOnly}
    <a href="/login?next=%2Fwords">{t().keepProgress}</a>
  </p>
{/if}

{#if progress.ready && !known.length}
  <p class="muted">{t().noWords}</p>
  <a class="btn" href="/">{t().startRound}</a>
{/if}

<div class="list">
  {#each known as word}
    <a href="?word={word.id}">
      <span class="w">{meaning(word, data.locale)}</span>
      <span class="cov">{cognateLangs(word).length}/{LANGS.length}</span>
      <span class="sample">
        {SAMPLE.filter((l) => word.forms[l].cognate)
          .map((l) => word.forms[l].form)
          .join(' · ') || '–'}
      </span>
    </a>
  {/each}
</div>

{#if progress.ready && known.length}
  <p class="muted small more">{t().notCollected(data.words.length - known.length)}</p>
{/if}

{#if auth.user}
  <div class="account" data-feedback-ignore>
    <span class="muted">{t().loggedInAs(auth.user.email)}</span>
    <button type="button" onclick={() => openFeedback('idea')}>{t().giveFeedback}</button>
    <button type="button" onclick={logOut}>{t().logOut}</button>
  </div>
{/if}

<p class="muted small source">
  {t().sourceFrom}
  <a href="https://www.wiktionary.org/">Wiktionary</a>
  (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>) {t().sourceVia}
  <a href="https://kaikki.org/">kaikki.org</a>
</p>

<style>
  h1 {
    margin: 4px 0;
    font-size: 2rem;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    margin: 0 0 10px;
    font-size: 0.85rem;
  }
  .note {
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--paper2);
    font-size: 0.9rem;
  }
  .btn {
    display: inline-block;
    padding: 13px 18px;
    border-radius: 14px;
    background: var(--gradient);
    color: var(--ink);
    font-weight: 600;
    text-decoration: none;
  }
  .list {
    display: flex;
    flex-direction: column;
  }
  .list a {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 10px;
    padding: 12px 0;
    border-bottom: 1px dashed var(--border);
    text-decoration: none;
  }
  .w {
    font-family: var(--script);
    font-size: 1.25rem;
  }
  .cov {
    align-self: center;
    color: var(--muted);
    font-size: 0.8rem;
  }
  .sample {
    grid-column: 1 / -1;
    color: var(--muted);
    font-family: var(--script);
    font-size: 0.85rem;
  }
  .more {
    margin-top: 14px;
  }
  .source {
    margin-top: 28px;
  }
  .account {
    display: none;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-top: 28px;
    font-size: 0.85rem;
  }
  .account button {
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }
  /* On the desktop the side bar has these */
  @media (max-width: 900px) {
    .account {
      display: flex;
    }
  }
</style>
