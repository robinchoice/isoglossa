<script lang="ts">
  import { APP_NAME } from '@app/shared';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { auth, checkAuth } from '$lib/auth.svelte';
  import Feedback from '$lib/components/Feedback.svelte';
  import WordDetail from '$lib/components/WordDetail.svelte';
  import { openFeedback } from '$lib/feedback.svelte';
  import { t } from '$lib/i18n';
  import { loadProgress, logOut, progress } from '$lib/progress.svelte';
  import { cognateLangs, streak } from '$lib/words';

  let { data, children } = $props();

  onMount(async () => {
    await checkAuth();
    await loadProgress();
  });

  // Word-language pairs: a word learned in 14 languages counts 14 times
  const total = $derived(
    data.words
      .filter((w) => progress.learned[w.id])
      .reduce((sum, w) => sum + cognateLangs(w).length, 0),
  );
  const days = $derived(streak(new Set(progress.days)));

  // The word detail opens over any page as ?word=<id>
  const word = $derived(data.words.find((w) => w.id === page.url.searchParams.get('word')));

  const tabs = $derived([
    { href: '/', label: t().today, on: page.url.pathname === '/' },
    { href: '/map', label: t().map, on: page.url.pathname.startsWith('/map') },
    { href: '/words', label: t().words, on: page.url.pathname.startsWith('/words') },
  ]);
</script>

{#snippet logo()}
  <a href="/" class="logo">Iso<i>glossa</i></a>
{/snippet}

<div class="frame" class:open={!!word}>
  <nav class="side" aria-label={APP_NAME}>
    {@render logo()}
    {#each tabs as tab}
      <a href={tab.href} class:on={tab.on} aria-current={tab.on ? 'page' : undefined}>{tab.label}</a>
    {/each}
    <div class="account" data-feedback-ignore>
      {#if auth.user}
        <span class="muted">{t().loggedInAs(auth.user.email)}</span>
        <button type="button" onclick={() => openFeedback('idea')}>{t().giveFeedback}</button>
        <button type="button" onclick={logOut}>{t().logOut}</button>
      {:else}
        <a href="/login?next={encodeURIComponent(page.url.pathname)}">{t().logIn}</a>
      {/if}
    </div>
  </nav>

  <div class="main">
    <header>
      {@render logo()}
      {#if progress.ready}
        <span class="pill">{t().streak(days)} · {t().nWords(total)}</span>
      {/if}
    </header>
    <main>
      {@render children()}
    </main>
    <nav class="tabbar" aria-label={APP_NAME}>
      {#each tabs as tab}
        <a href={tab.href} class:on={tab.on && !word} aria-current={tab.on ? 'page' : undefined}>{tab.label}</a>
      {/each}
    </nav>
  </div>

  {#if word}
    <aside class="panel">
      {#key word.id}
        <WordDetail {word} close={page.url.pathname} />
      {/key}
    </aside>
  {/if}
</div>

{#if auth.user}
  <Feedback />
{/if}

<style>
  :global(:root) {
    --script: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Noto Serif', 'Noto Serif CJK JP', Georgia, serif;
    --ink: #17171a;
    --gold: #876008;
    --gold-bg: #f2c14e;
    --paper2: #e9e8e2;
  }
  :global(bdi) {
    unicode-bidi: isolate;
  }
  .frame {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    min-height: 100dvh;
  }
  .frame.open {
    grid-template-columns: 200px minmax(0, 1fr) 420px;
  }
  .logo {
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 800;
    font-stretch: 80%;
    letter-spacing: -0.02em;
    text-decoration: none;
  }
  .logo i {
    color: var(--accent);
    font-style: normal;
  }
  .side {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    height: 100dvh;
    padding: 24px 14px;
    border-right: 1px solid var(--border);
    background: var(--surface);
  }
  .side .logo {
    padding: 0 10px 18px;
  }
  .side > a:not(.logo) {
    padding: 10px 12px;
    border-radius: 10px;
    color: var(--muted);
    text-decoration: none;
  }
  .side > a.on {
    background:
      var(--gradient) left / 3px 100% no-repeat,
      var(--bg);
    color: var(--text);
    font-weight: 600;
  }
  .account {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: auto;
    padding: 0 12px;
    font-size: 0.85rem;
  }
  .account button,
  .account a {
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }
  .muted {
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  header {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: flex-end;
    padding: 22px 28px 10px;
  }
  .main header .logo {
    display: none;
    margin-right: auto;
  }
  .pill {
    padding: 5px 10px;
    border-radius: 99px;
    background: var(--paper2);
    color: var(--muted);
    font-size: 0.8rem;
    white-space: nowrap;
  }
  main {
    flex: 1;
    padding: 0 28px 32px;
  }
  .tabbar {
    display: none;
  }
  .panel {
    position: sticky;
    top: 0;
    height: 100dvh;
    overflow: auto;
    padding: 22px;
    border-left: 1px solid var(--border);
    background: var(--surface);
  }

  /* Phone: tabs at the bottom, the word detail as its own page */
  @media (max-width: 900px) {
    .frame,
    .frame.open {
      grid-template-columns: minmax(0, 1fr);
    }
    .side {
      display: none;
    }
    header {
      justify-content: space-between;
      padding: 18px 18px 8px;
    }
    .main header .logo {
      display: block;
    }
    main {
      padding: 0 18px 24px;
    }
    .tabbar {
      position: sticky;
      bottom: 0;
      display: flex;
      border-top: 1px solid var(--border);
      background: var(--surface);
    }
    .tabbar a {
      flex: 1;
      padding: 12px 0 calc(14px + env(safe-area-inset-bottom));
      color: var(--muted);
      font-size: 0.8rem;
      text-align: center;
      text-decoration: none;
    }
    .tabbar a.on {
      color: var(--text);
      font-weight: 600;
      background: var(--gradient) top / 100% 2px no-repeat;
    }
    .panel {
      position: fixed;
      inset: 0;
      z-index: 10;
      height: auto;
      padding: 18px;
      border: none;
    }
  }
</style>
