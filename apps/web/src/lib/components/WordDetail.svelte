<script lang="ts">
  import { cognateLangs, DEEP, LANGS, type Lang, meaning, RTL, type WordData } from '@app/shared';
  import { page } from '$app/state';
  import { t } from '$lib/i18n';
  import { progress } from '$lib/progress.svelte';

  let { word, close }: { word: WordData; close: string } = $props();

  let selected = $state<Lang | null>(null);

  const locale = $derived(page.data.locale);
  const name = $derived(meaning(word, locale));
  const learned = $derived(!!progress.learned[word.id]);
  const same = $derived(cognateLangs(word).length);
  const groups = $derived(word.groups ? Object.keys(word.groups) : []);

  // Radial network: the word in the middle, the 14 languages around it
  const S = 420;
  const C = S / 2;
  const R = 125;
  const nodes = $derived(
    LANGS.map((lang, i) => {
      const a = (i / LANGS.length) * 2 * Math.PI - Math.PI / 2;
      const form = word.forms[lang];
      const cos = Math.cos(a);
      return {
        lang,
        form,
        x: C + R * Math.cos(a),
        y: C + R * Math.sin(a),
        lx: C + (R + 46) * cos,
        ly: C + (R + 46) * Math.sin(a) + 4,
        anchor: Math.abs(cos) < 0.3 ? 'middle' : cos > 0 ? 'start' : 'end',
        dx: Math.abs(cos) < 0.3 ? 0 : cos > 0 ? -14 : 14,
      };
    }),
  );

  // Branches like te and cha get their own colour, all else the product colour
  function color(lang: Lang) {
    const form = word.forms[lang];
    if (!form.cognate) return '#9a98a3';
    if (form.group && groups.indexOf(form.group) === 1) return DEEP[1]!;
    return 'var(--accent)';
  }

  // Node labels by visual width: CJK and Hangul count double
  const width = (text: string) => [...text].reduce((sum, c) => sum + (/[\u1100-\uffdc]/.test(c) ? 2 : 1), 0);
  function label(text: string) {
    const w = width(text);
    if (w <= 4) return { text, size: 13 };
    if (w <= 7) return { text, size: w <= 6 ? 11 : 10 };
    let cut = '';
    for (const c of text) {
      if (width(`${cut}${c}`) > 5) break;
      cut += c;
    }
    return { text: `${cut}…`, size: 10 };
  }
</script>

<article>
  <a class="close" href={close} aria-label={t().close}>
    <span class="back">{t().back}</span><span class="x">×</span>
  </a>
  <h2>{name}</h2>
  <p class="muted small">{t().sameIn(same)}{learned ? ` · ${t().collected}` : ''}</p>

  <svg class="net" viewBox="0 0 {S} {S}" role="img" aria-label={t().sameIn(same)}>
    {#each nodes as n}
      {#if n.form.cognate}
        <line
          x1={C}
          y1={C}
          x2={n.x}
          y2={n.y}
          stroke={color(n.lang)}
          stroke-width={selected === n.lang ? 3 : 1.6}
          opacity="0.55"
        />
      {/if}
    {/each}
    <circle cx={C} cy={C} r="46" fill="var(--ink)" />
    <text x={C} y={C + 7} text-anchor="middle" font-size={name.length > 8 ? 14 : 19} fill="#f2f0ea">
      {name}
    </text>
    {#each nodes as n}
      {@const filled = learned && n.form.cognate}
      {@const short = label(n.form.form)}
      <!-- biome-ignore lint/a11y/useSemanticElements: SVG has no button element -->
      <g
        class="node"
        role="button"
        tabindex="0"
        aria-label={t().langs[n.lang]}
        onclick={() => (selected = n.lang)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') selected = n.lang;
        }}
      >
        <circle
          cx={n.x}
          cy={n.y}
          r={selected === n.lang ? 28 : 25}
          fill={filled ? color(n.lang) : '#fff'}
          stroke={color(n.lang)}
          stroke-width="2"
          stroke-dasharray={n.form.cognate ? undefined : '3 3'}
        />
        <text
          x={n.x}
          y={n.y + 5}
          text-anchor="middle"
          font-size={short.size}
          direction={RTL.includes(n.lang) ? 'rtl' : undefined}
          fill={filled ? '#fff' : n.form.cognate ? 'var(--ink)' : '#9a98a3'}>{short.text}</text
        >
      </g>
      <text class="label" x={n.lx} y={n.ly} text-anchor={n.anchor} dx={n.dx}>{t().langs[n.lang]}</text>
    {/each}
  </svg>

  {#if selected}
    {@const form = word.forms[selected]}
    <div class="info">
      <span class="tag">{t().langs[selected]}</span>
      <div class="script"><bdi dir={RTL.includes(selected) ? 'rtl' : 'ltr'}>{form.form}</bdi></div>
      <div class="muted small">
        {form.roman ? `${form.roman} · ` : ''}{form.cognate ? t().inNetwork : t().otherWord}
      </div>
    </div>
  {:else}
    <p class="muted small">{t().tapLang}</p>
  {/if}

  <div class="info">
    <span class="tag">{t().origin}</span>
    <div class="ety">
      {#each word.etymology as step, i}
        {#if i > 0}<em>→</em>{/if}
        <span><bdi>{step.form}</bdi>{step.roman ? ` (${step.roman})` : ''} <em>{step.lang[locale]}</em></span>
      {/each}
    </div>
    <p class="muted small">{word.fact[locale]}</p>
    {#if word.groups}
      <div class="legend">
        {#each groups as group, i}
          <span><i style:background={i === 1 ? DEEP[1] : 'var(--accent)'}></i>{word.groups[group]![locale]}</span>
        {/each}
        <span><i class="dashed"></i>{t().otherWordLegend}</span>
      </div>
    {/if}
  </div>
</article>

<style>
  h2 {
    margin: 4px 0 0;
    font-size: 2rem;
  }
  .close {
    display: block;
    color: var(--muted);
    font-size: 0.9rem;
    text-decoration: none;
  }
  .x {
    display: none;
    float: right;
    font-size: 1.6rem;
    line-height: 1;
  }
  @media (min-width: 901px) {
    .back {
      display: none;
    }
    .x {
      display: inline;
    }
  }
  .muted {
    margin: 0;
    color: var(--muted);
  }
  .small {
    font-size: 0.85rem;
  }
  .net {
    display: block;
    width: 100%;
    max-width: 440px;
    height: auto;
    margin: 0 auto;
  }
  .net text {
    font-family: var(--script);
  }
  .net .label {
    fill: var(--muted);
    font-family: system-ui, sans-serif;
    font-size: 11px;
  }
  .node {
    cursor: pointer;
    outline: none;
  }
  .node:focus-visible circle,
  .node:hover circle {
    stroke-width: 3;
  }
  .info {
    margin-top: 10px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--bg);
  }
  .tag {
    color: var(--muted);
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .script {
    font-family: var(--script);
    font-size: 2.1rem;
  }
  .ety {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin: 8px 0 10px;
  }
  .ety span {
    padding: 6px 10px;
    border-radius: 10px;
    background: var(--paper2);
    font-size: 0.9rem;
  }
  .ety em {
    color: var(--muted);
    font-style: normal;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin-top: 8px;
    color: var(--muted);
    font-size: 0.75rem;
  }
  .legend i {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 5px;
    border-radius: 50%;
    vertical-align: -1px;
  }
  .legend .dashed {
    border: 1px dashed var(--muted);
  }
</style>
