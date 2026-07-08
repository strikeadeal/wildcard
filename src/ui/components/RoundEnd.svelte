<script lang="ts">
  import { session } from '../session.svelte';
  import { fade, fly } from 'svelte/transition';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { prefersReducedMotion } from '../motion';

  const view = $derived(session.view);
  const winner = $derived(
    view?.players.find((p) => p.id === view?.roundWinner)
  );
  const iWon = $derived(winner?.id === view?.you.id);
  const ranked = $derived(
    [...(view?.players ?? [])].sort((a, b) => b.score - a.score)
  );
  const topScore = $derived(ranked[0]?.score ?? 0);

  const reduce = prefersReducedMotion();
  // One shared 0→1 progress drives every row's count-up.
  const progress = tweened(0, { duration: reduce ? 0 : 650, easing: cubicOut });
  $effect(() => { progress.set(1); });
</script>

<div class="overlay" role="dialog" aria-label="Round over" transition:fade={{ duration: reduce ? 0 : 200 }}>
  <div class="sheet" in:fly={{ y: reduce ? 0 : 24, duration: reduce ? 0 : 320, easing: cubicOut }}>
    <p class="eyebrow">Round over</p>
    <h2 class="winner">{iWon ? 'You win the round!' : `${winner?.name} wins the round`}</h2>

    <table>
      <tbody>
        {#each ranked as p, i (p.id)}
          <tr class:you={p.id === view?.you.id} class:lead={p.score === topScore && topScore > 0}>
            <td class="rank">{i + 1}</td>
            <td class="who">{p.name}{p.id === view?.you.id ? ' (you)' : ''}</td>
            <td class="score">{Math.round(p.score * $progress)}</td>
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

  .primary { background: var(--btn-green); }
  .hint { color: var(--muted); margin: 0; text-align: center; }

  .winner { animation: winnerglow 1.6s ease-in-out 0.2s both; }
  @keyframes winnerglow {
    0% { text-shadow: 0 0 0 rgb(230 184 75 / 0); transform: scale(0.98); }
    40% { text-shadow: 0 0 26px rgb(230 184 75 / 0.6); transform: scale(1.03); }
    100% { text-shadow: 0 0 0 rgb(230 184 75 / 0); transform: scale(1); }
  }
</style>
