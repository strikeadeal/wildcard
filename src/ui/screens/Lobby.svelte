<script lang="ts">
  import { session } from '../session.svelte';
  import RuleToggles from '../components/RuleToggles.svelte';

  const lobby = $derived(session.lobby);
  const canStart = $derived(session.lobby?.canStart ?? false);
  let copied = $state(false);

  const joinLink = $derived(
    location.href.split('#')[0] + '#/join/' + (session.roomCode ?? '')
  );

  async function copyLink() {
    await navigator.clipboard.writeText(joinLink);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: 'WILDCARD', text: 'Join my card game!', url: joinLink }).catch(() => {});
    } else {
      await copyLink();
    }
  }
</script>

<main>
  <header>
    <h2>Room <strong class="code">{session.roomCode}</strong></h2>
    <div class="share">
      <button class="ghost" onclick={copyLink}>{copied ? 'Copied!' : 'Copy link'}</button>
      <button class="ghost" onclick={share}>Share</button>
    </div>
  </header>

  <ul>
    {#each lobby?.players ?? [] as player (player.id)}
      <li class:off={!player.connected}>
        <span>{player.name}{player.id === lobby?.hostId ? ' (host)' : ''}</span>
        {#if !player.connected}<em>away</em>{/if}
        {#if session.isHost && player.id !== 'p0'}
          <button class="ghost small" onclick={() => session.removeSeat(player.id)}>Remove</button>
        {/if}
      </li>
    {/each}
  </ul>
  <p class="hint">{lobby?.players.length ?? 0}/6 seats — tell friends the code or send the link.</p>

  {#if lobby}
    <RuleToggles
      config={lobby.config}
      editable={session.isHost}
      onchange={(config) => session.setConfig(config)}
    />
  {/if}

  {#if session.isHost}
    <button onclick={() => session.startGame()} disabled={!canStart}>
      {canStart ? 'Start game' : 'Waiting for players…'}
    </button>
  {:else}
    <p class="hint">Waiting for the host to start…</p>
  {/if}
  <button class="ghost" onclick={() => session.leave()}>Leave room</button>
</main>

<style>
  main {
    max-width: 420px;
    margin: 0 auto;
    padding: 32px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  header { display: flex; flex-direction: column; gap: 8px; }
  .code { letter-spacing: 0.2em; font-size: 1.4em; }
  .share { display: flex; gap: 8px; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: var(--surface);
    border-radius: 8px;
    padding: 10px 14px;
  }
  li.off span { color: var(--muted); }
  em { color: var(--muted); font-style: normal; font-size: 0.85em; }
  .small { min-height: 44px; padding: 0 10px; font-size: 0.85em; }
  .hint { color: var(--muted); margin: 0; }
</style>
