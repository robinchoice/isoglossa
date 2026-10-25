<script lang="ts">
  import { meaning, RTL } from '@app/shared';
  import { t } from '$lib/i18n';
  import { progress } from '$lib/progress.svelte';

  let { data } = $props();

  const words = $derived(data.words.filter((w) => w.forms[data.lang].cognate));
  const known = $derived(words.filter((w) => progress.learned[w.id]));
</script>

<a class="back" href="/map">{t().backToMap}</a>
<h1>{t().langs[data.lang]}</h1>
<p class="muted small">{t().langSummary(known.length, words.length - known.length)}</p>

{#if progress.ready && !known.length}
  <p class="muted">{t().emptyLang}</p>
{/if}
<div class="rows">
  {#each known as word}
    {@const form = word.forms[data.lang]}
    <a class="row" href="?word={word.id}">
      <span class="muted small">{meaning(word, data.locale)}</span>
      <span>
        <span class="form" lang={data.lang}><bdi dir={RTL.includes(data.lang) ? 'rtl' : 'ltr'}>{form.form}</bdi></span>
        {#if form.roman}<span class="roman">{form.roman}</span>{/if}
      </span>
      <span class="muted">›</span>
    </a>
  {/each}
</div>

<style>
  .back {
    color: var(--muted);
    font-size: 0.9rem;
    text-decoration: none;
  }
  h1 {
    margin: 6px 0 4px;
    font-size: 2rem;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    margin: 0;
    font-size: 0.85rem;
  }
  .rows {
    display: flex;
    flex-direction: column;
    margin-top: 14px;
  }
  .row {
    display: grid;
    grid-template-columns: 110px 1fr auto;
    gap: 10px;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px dashed var(--border);
    text-decoration: none;
  }
  .form {
    font-family: var(--script);
    font-size: 1.3rem;
  }
  .roman {
    margin-left: 6px;
    color: var(--muted);
    font-size: 0.8rem;
  }
</style>
