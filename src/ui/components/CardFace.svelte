<script lang="ts">
  import type { Card } from '../../engine/types';

  let { card = null, facedown = false, playable = false, onclick }: {
    card?: Card | null;
    facedown?: boolean;
    playable?: boolean;
    onclick?: () => void;
  } = $props();

  const GLYPH: Record<string, string> = {
    skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4'
  };
  const label = $derived(card ? (GLYPH[card.value] ?? card.value) : '');
  const colorClass = $derived(facedown ? 'back' : (card?.color ?? 'wild'));
</script>

<button
  class="card {colorClass}"
  class:playable
  disabled={!onclick}
  onclick={onclick}
  aria-label={facedown ? 'Face-down card' : card ? `${card.color ?? 'wild'} ${card.value}` : 'Empty'}
>
  {#if !facedown && card}
    <span class="corner">{label}</span>
    <span class="big">{label}</span>
  {/if}
</button>

<style>
  .card {
    width: var(--card-w, 64px);
    aspect-ratio: 5 / 7;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border-radius: 10px;
    border: 2px solid rgb(255 255 255 / 0.25);
    position: relative;
    color: #fff;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .card:disabled { opacity: 1; }
  .red { background: var(--card-red); }
  .yellow { background: var(--card-yellow); color: #3b3200; }
  .green { background: var(--card-green); }
  .blue { background: var(--card-blue); }
  .wild {
    background: conic-gradient(
      var(--card-red) 0 25%, var(--card-yellow) 0 50%,
      var(--card-green) 0 75%, var(--card-blue) 0
    );
  }
  .back { background: repeating-linear-gradient(135deg, #2a2e37 0 8px, #343945 8px 16px); }
  .big { font-size: calc(var(--card-w, 64px) * 0.42); font-weight: 800; text-shadow: 0 1px 2px rgb(0 0 0 / 0.4); }
  .corner {
    position: absolute;
    top: 4px;
    left: 7px;
    font-size: calc(var(--card-w, 64px) * 0.2);
    font-weight: 700;
  }
  .playable {
    outline: 3px solid #fff;
    transform: translateY(-8px);
    cursor: pointer;
  }
</style>
