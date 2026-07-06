<script lang="ts">
  import { session } from '../session.svelte';

  const view = $derived(session.view);
  const winner = $derived(
    view?.players.find((p) => p.id === view?.roundWinner)
  );
  const ranked = $derived(
    [...(view?.players ?? [])].sort((a, b) => b.score - a.score)
  );
</script>

<div class="overlay" role="dialog" aria-label="Round over">
  <h2>{winner?.id === view?.you.id ? 'You win the round! 🎉' : `${winner?.name} wins the round`}</h2>
  <table>
    <tbody>
      {#each ranked as p (p.id)}
        <tr class:you={p.id === view?.you.id}>
          <td>{p.name}</td>
          <td>{p.score}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if session.isHost}
    <button onclick={() => session.sendAction({ type: 'nextRound' })}>Next round</button>
  {:else}
    <p class="hint">Waiting for the host to deal the next round…</p>
  {/if}
  <button class="ghost" onclick={() => session.leave()}>Leave game</button>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.75);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    z-index: 10;
    padding: 20px;
  }
  table { border-collapse: collapse; min-width: 240px; }
  td { padding: 8px 14px; border-bottom: 1px solid var(--surface); }
  td:last-child { text-align: right; font-weight: 700; }
  .you td { color: var(--card-yellow); }
  .hint { color: var(--muted); margin: 0; }
</style>
