<script lang="ts">
  import type { OpponentView } from '../../engine/types';

  let { players, onpick }: {
    players: OpponentView[];
    onpick: (id: string) => void;
  } = $props();
</script>

<div class="overlay" role="dialog" aria-label="Swap hands with">
  <p>You played a 7 — swap hands with…</p>
  <div class="list">
    {#each players as p (p.id)}
      <button onclick={() => onpick(p.id)}>{p.name} ({p.cardCount})</button>
    {/each}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.6);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    z-index: 10;
  }
  .list { display: flex; flex-direction: column; gap: 10px; min-width: 220px; }
</style>
