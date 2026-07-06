<script lang="ts">
  import { session } from '../session.svelte';

  const view = $derived(session.view);
  const winner = $derived(
    view?.players.find((p) => p.id === view?.roundWinner)
  );
  const iWon = $derived(winner?.id === view?.you.id);
  const ranked = $derived(
    [...(view?.players ?? [])].sort((a, b) => b.score - a.score)
  );
  const topScore = $derived(ranked[0]?.score ?? 0);
</script>

<div class="overlay" role="dialog" aria-label="Round over">
  <div class="sheet">
    <p class="eyebrow">Round over</p>
    <h2>{iWon ? 'You win the round!' : `${winner?.name} wins the round`}</h2>

    <table>
      <tbody>
        {#each ranked as p, i (p.id)}
          <tr class:you={p.id === view?.you.id} class:lead={p.score === topScore && topScore > 0}>
            <td class="rank">{i + 1}</td>
            <td class="who">{p.name}{p.id === view?.you.id ? ' (you)' : ''}</td>
            <td class="score">{p.score}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    {#if session.isHost}
      <button class="primary" onclick={() => session.sendAction({ type: 'nextRound' })}>Next round</button>
    {:else}
      <p class="hint">Waiting for the host to deal the next round…</p>
    {/if}
    <button class="ghost" onclick={() => session.leave()}>Leave game</button>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgb(6 16 12 / 0.82);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    padding: 20px;
  }
  .sheet {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 26px 24px;
    box-shadow: 0 20px 50px rgb(0 0 0 / 0.5);
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .eyebrow { margin: 0; color: var(--muted); text-transform: uppercase; letter-spacing: 0.14em; font-size: 0.78rem; }
  h2 { margin: 0; font-size: 1.6rem; }

  table { border-collapse: collapse; width: 100%; margin: 4px 0; }
  td { padding: 10px 6px; border-bottom: 1px solid var(--line); }
  .rank { color: var(--muted); width: 1.5em; font-variant-numeric: tabular-nums; }
  .who { width: 100%; }
  .score { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: none; }
  .lead .score { color: var(--brass); }
  .you .who { color: var(--brass); font-weight: 700; }

  .primary { background: var(--card-green); }
  .hint { color: var(--muted); margin: 0; text-align: center; }
</style>
