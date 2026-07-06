<script lang="ts">
  import type { OpponentView } from '../../engine/types';

  let { player, isTurn, catchable, oncatch }: {
    player: OpponentView;
    isTurn: boolean;
    catchable: boolean;
    oncatch: () => void;
  } = $props();
</script>

<div class="seat" class:turn={isTurn} class:off={!player.connected}>
  <span class="name">{player.name}</span>
  <span class="count" aria-label="{player.cardCount} cards">🂠 {player.cardCount}</span>
  {#if player.saidUno && player.cardCount === 1}<span class="uno">last card!</span>{/if}
  {#if !player.connected}<span class="away">away</span>{/if}
  {#if catchable}
    <button class="catch" onclick={oncatch}>Catch!</button>
  {/if}
</div>

<style>
  .seat {
    background: var(--surface);
    border-radius: 10px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 76px;
    border: 2px solid transparent;
  }
  .turn { border-color: var(--accent); }
  .off { opacity: 0.55; }
  .name { font-size: 0.85em; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { font-weight: 700; }
  .uno { color: var(--card-yellow); font-size: 0.75em; font-weight: 700; }
  .away { color: var(--muted); font-size: 0.75em; }
  .catch { background: var(--card-yellow); color: #3b3200; min-height: 44px; padding: 0 10px; font-size: 0.85em; } /* 44px touch-target floor */
</style>
