<script lang="ts">
  import type { OpponentView } from '../../engine/types';

  let { players, onpick }: {
    players: OpponentView[];
    onpick: (id: string) => void;
  } = $props();
</script>

<div class="overlay" role="dialog" aria-label="Swap hands with">
  <div class="sheet">
    <p>You played a 7 — swap hands with…</p>
    <div class="list">
      {#each players as p (p.id)}
        <button onclick={() => onpick(p.id)}>
          <span>{p.name}</span>
          <span class="count">{p.cardCount} cards</span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgb(var(--scrim) / 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 10;
  }
  .sheet {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 24px;
    box-shadow: 0 20px 50px rgb(0 0 0 / 0.5);
    min-width: 260px;
  }
  .sheet p { margin: 0 0 16px; font-family: var(--display); font-size: 1.2rem; font-weight: 600; text-align: center; }
  .list { display: flex; flex-direction: column; gap: 10px; }
  .list button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--line);
    box-shadow: none;
    font-weight: 600;
  }
  .list button:hover:not(:disabled) { border-color: var(--brass); }
  .count { color: var(--muted); font-weight: 500; font-size: 0.85rem; }
</style>
