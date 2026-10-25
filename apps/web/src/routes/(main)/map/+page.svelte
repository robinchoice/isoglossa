<script lang="ts">
  import { LANG_SAMPLE, LANGS, localDay } from '@app/shared';
  import { t } from '$lib/i18n';
  import { progress } from '$lib/progress.svelte';

  let { data } = $props();

  const today = localDay();
  const tiles = $derived(
    LANGS.map((lang) => {
      const words = data.words.filter((w) => w.forms[lang].cognate);
      const known = words.filter((w) => progress.learned[w.id]);
      return {
        lang,
        known: known.length,
        all: words.length,
        // Won today, shown in gold
        gained: known.filter((w) => progress.learned[w.id] === today).length,
      };
    }),
  );
  const total = $derived(tiles.reduce((sum, tile) => sum + tile.known, 0));
  const roundOpen = $derived(progress.round?.key.split('#')[0] !== today || !progress.days.includes(today));
</script>

<div class="hero">
  <div>
    <div class="tag">{t().youKnow}</div>
    <div class="big">{progress.ready ? total.toLocaleString(data.locale) : '–'}</div>
    <div class="small">{t().wordsInLangs(LANGS.length)}</div>
  </div>
  {#if progress.ready && roundOpen}
    <a class="btn" href="/">{t().dailyRound}</a>
  {/if}
</div>

<div class="grid">
  {#each tiles as tile}
    <a class="tile" class:hit={tile.gained > 0} href="/map/{tile.lang}">
      {#if tile.gained}<span class="plus">+{tile.gained}</span>{/if}
      <div class="sample" lang={tile.lang}>{LANG_SAMPLE[tile.lang]}</div>
      <div class="name">{t().langs[tile.lang]}</div>
      <div class="n">{t().nWords(tile.known)}</div>
      <div class="bar"><i style:width="{(tile.known / tile.all) * 100}%"></i></div>
    </a>
  {/each}
</div>

<style>
  .hero {
    display: flex;
    gap: 14px;
    align-items: center;
    justify-content: space-between;
    margin: 6px 0 18px;
    padding: 20px;
    border-radius: 22px;
    background: var(--ink);
    color: #f2f0ea;
  }
  .tag {
    color: #9a98a3;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .big {
    font-family: var(--font-display);
    font-size: 3rem;
    font-weight: 800;
    font-stretch: 80%;
    line-height: 1;
  }
  .small {
    color: #9a98a3;
    font-size: 0.85rem;
  }
  .btn {
    padding: 13px 18px;
    border-radius: 14px;
    background: var(--gradient);
    color: var(--ink);
    font-weight: 600;
    text-decoration: none;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  .tile {
    position: relative;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface);
    text-decoration: none;
  }
  .tile.hit {
    border-color: var(--gold-bg);
    box-shadow: inset 0 0 0 1px var(--gold-bg);
  }
  .plus {
    position: absolute;
    top: 10px;
    right: 12px;
    color: var(--gold);
    font-size: 0.85rem;
    font-weight: 700;
  }
  .sample {
    height: 32px;
    font-family: var(--script);
    font-size: 1.5rem;
  }
  .name {
    margin-top: 4px;
    font-weight: 600;
  }
  .n {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .bar {
    height: 5px;
    margin-top: 8px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--paper2);
  }
  .bar i {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--gradient);
    transition: width 0.6s;
  }
  @media (max-width: 420px) {
    .grid {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
