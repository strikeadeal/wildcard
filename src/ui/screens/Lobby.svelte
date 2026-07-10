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
    <p class="eyebrow">Room code</p>
    <strong class="code">{session.roomCode}</strong>
    <div class="share">
      <button class="ghost" onclick={copyLink}>{copied ? 'Copied!' : 'Copy link'}</button>
      <button class="ghost" onclick={share}>Share</button>
    </div>
  </header>

  <section class="seats">
    <div class="seats-head">
      <h2>Players</h2>
      <span class="count">{lobby?.players.length ?? 0}/6</span>
    </div>
    <ul>
      {#each lobby?.players ?? [] as player (player.id)}
        <li class:off={!player.connected}>
          <span class="dot" class:on={player.connected}></span>
          <span class="pname">{player.name}</span>
          {#if player.id === lobby?.hostId}<span class="tag host">Host</span>{/if}
          {#if !player.connected}<span class="tag away">Away</span>{/if}
          {#if session.isHost && player.id !== 'p0'}
            <button class="ghost small" onclick={() => session.removeSeat(player.id)}>Remove</button>
          {/if}
        </li>
      {/each}
    </ul>
    <p class="hint">Tell friends the code, or send them the link.</p>
  </section>

  {#if lobby}
    <RuleToggles
      config={lobby.config}
      editable={session.isHost}
      onchange={(config) => session.setConfig(config)}
    />
  {/if}

  <div class="lobby-actions">
    {#if session.isHost}
      <button class="primary" onclick={() => session.startGame()} disabled={!canStart}>
        {canStart ? 'Start game' : 'Waiting for players…'}
      </button>
    {:else}
      <p class="hint centered">Waiting for the host to start…</p>
    {/if}
    <button class="ghost" onclick={() => session.leave()}>Leave room</button>
  </div>
</main>

<style>
  main {
    max-width: 440px;
    margin: 0 auto;
    padding:
      calc(28px + var(--safe-top))
      calc(20px + var(--safe-right))
      calc(36px + var(--safe-bottom))
      calc(20px + var(--safe-left));
    padding-bottom: calc(132px + var(--safe-bottom));
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  header { text-align: center; }
  .eyebrow { color: var(--muted); margin: 0 0 2px; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.14em; }
  .code {
    display: block;
    font-family: var(--display);
    font-weight: 600;
    font-size: 2.6rem;
    letter-spacing: 0.16em;
    color: var(--brass);
  }
  .share { display: flex; gap: 8px; justify-content: center; margin-top: 12px; }

  .seats-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
  .seats-head h2 { font-size: 1.2rem; }
  .count { color: var(--muted); font-variant-numeric: tabular-nums; }

  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 14px;
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex-shrink: 0; }
  .dot.on { background: var(--card-green); box-shadow: 0 0 8px rgb(55 176 107 / 0.6); }
  .pname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li.off .pname { color: var(--muted); }
  .tag { font-size: 0.72rem; font-weight: 700; padding: 3px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em; }
  .tag.host { background: rgb(230 184 75 / 0.16); color: var(--brass); }
  .tag.away { background: rgb(0 0 0 / 0.25); color: var(--muted); }
  .small { min-height: 44px; padding: 0 12px; font-size: 0.85rem; }

  .hint { color: var(--muted); margin: 10px 0 0; font-size: 0.9rem; }
  .hint.centered { text-align: center; margin: 0; }

  .lobby-actions {
    position: sticky;
    bottom: 0;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-inline: calc(-20px - var(--safe-left)) calc(-20px - var(--safe-right));
    margin-bottom: calc(-36px - var(--safe-bottom));
    padding: var(--space-3) calc(20px + var(--safe-right))
      calc(var(--space-3) + var(--safe-bottom)) calc(20px + var(--safe-left));
    background: linear-gradient(transparent, var(--felt) 20%);
  }
  .primary { background: var(--btn-green); }
</style>
