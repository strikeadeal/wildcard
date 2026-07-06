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
  <span class="count" aria-label="{player.cardCount} cards">
    <svg class="mini" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="6" y="3.5" width="9" height="13" rx="2" fill="#f7f2e6" transform="rotate(9 10 10)" />
      <rect x="4" y="3" width="9" height="13" rx="2" fill="#f7f2e6" stroke="var(--line)" />
    </svg>
    {player.cardCount}
  </span>
  {#if player.saidUno && player.cardCount === 1}<span class="badge uno">Last card!</span>{/if}
  {#if !player.connected}<span class="badge away">Away</span>{/if}
  {#if catchable}
    <button class="catch" onclick={oncatch}>Catch!</button>
  {/if}
</div>

<style>
  .seat {
    background: var(--surface);
    border-radius: 12px;
    padding: 9px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 82px;
    border: 1px solid var(--line);
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
  }
  .turn {
    border-color: var(--brass);
    box-shadow: 0 0 18px rgb(230 184 75 / 0.4);
  }
  .off { opacity: 0.55; }
  .name {
    font-size: 0.85rem;
    font-weight: 600;
    max-width: 92px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    font-size: 1.05rem;
  }
  .mini { width: 20px; height: 20px; filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.4)); }
  .badge {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 7px;
    border-radius: 999px;
  }
  .uno { color: var(--ink-yellow); background: var(--card-yellow); }
  .away { color: var(--muted); background: rgb(0 0 0 / 0.25); }
  .catch { background: var(--card-yellow); color: var(--ink-yellow); min-height: 44px; padding: 0 12px; font-size: 0.85rem; font-weight: 800; } /* 44px touch-target floor */
</style>
