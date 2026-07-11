<script lang="ts">
  import type { Card } from '../../engine/types';

  let { card = null, facedown = false, playable = false, pending = false, onclick }: {
    card?: Card | null;
    facedown?: boolean;
    playable?: boolean;
    pending?: boolean;
    onclick?: () => void;
  } = $props();

  // What prints in the corners: numbers verbatim, +N for draw cards.
  const CORNER: Record<string, string> = { draw2: '+2', wild4: '+4' };
  const isWild = $derived(!!card && card.color === null);
  const colorClass = $derived(facedown ? 'back' : (card?.color ?? 'wild'));
  const corner = $derived(card ? (CORNER[card.value] ?? card.value) : '');
  const kind = $derived(card?.value ?? '');
  const isSymbol = $derived(kind === 'skip' || kind === 'reverse');
</script>

{#snippet glyph(value: string, size: 'big' | 'idx')}
  {#if value === 'skip'}
    <svg class={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.4" aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" /><line x1="6.2" y1="17.8" x2="17.8" y2="6.2" />
    </svg>
  {:else if value === 'reverse'}
    <svg class={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M7 4.5 L7 19.5" /><path d="M3.6 16 L7 19.5 L10.4 16" />
      <path d="M17 19.5 L17 4.5" /><path d="M13.6 8 L17 4.5 L20.4 8" />
    </svg>
  {:else}
    <span class={size}>{value}</span>
  {/if}
{/snippet}

<button
  class="card {colorClass}"
  class:playable
  class:action-pending={pending}
  class:symbol={isSymbol}
  disabled={!onclick}
  {onclick}
  aria-label={facedown ? 'Face-down card' : card ? `${card.color ?? 'wild'} ${card.value}` : 'Empty'}
>
  {#if facedown}
    <span class="back-mono">W</span>
  {:else if card}
    <span class="oval" class:wild={isWild}>
      {#if !isWild || kind === 'wild4'}
        {@render glyph(CORNER[kind] ?? kind, 'big')}
      {/if}
    </span>
    {#if !isWild}
      <span class="idx tl">{@render glyph(corner, 'idx')}</span>
      <span class="idx br">{@render glyph(corner, 'idx')}</span>
    {/if}
  {/if}
</button>

<style>
  .card {
    width: var(--card-w, 64px);
    aspect-ratio: 5 / 7;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border: none;
    border-radius: calc(var(--card-w, 64px) * 0.12);
    position: relative;
    background: #f7f2e6;
    box-shadow: var(--shadow-card);
    flex-shrink: 0;
    overflow: hidden;
    transition: transform 0.16s cubic-bezier(0.2, 0.8, 0.3, 1), box-shadow 0.16s ease;
  }
  .card:disabled { opacity: 1; }

  /* Per-suit ink: oval fill + corner index, all AA on white stock / white glyph. */
  .red { --suit: #d23b31; --idx: #c8362d; --gl: #fff; }
  .green { --suit: #279155; --idx: #227a48; --gl: #fff; }
  .blue { --suit: #356fd0; --idx: #2f66c4; --gl: #fff; }
  .yellow { --suit: #f2c033; --idx: #7a5a00; --gl: #4a3600; }
  .wild { --suit: transparent; --idx: #333; --gl: #fff; }

  /* The classic tilted oval that names a card as a card, not a colored div. */
  .oval {
    position: absolute;
    inset: 12%;
    border-radius: 50%;
    transform: rotate(-17deg);
    background: var(--suit);
    display: grid;
    place-items: center;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.18) inset;
  }
  .oval.wild {
    background: conic-gradient(
      from -17deg,
      var(--card-red) 0 90deg, var(--card-blue) 90deg 180deg,
      var(--card-green) 180deg 270deg, var(--card-yellow) 270deg 360deg
    );
  }
  .big {
    transform: rotate(17deg);
    color: var(--gl);
    font-weight: 800;
    font-size: calc(var(--card-w, 64px) * 0.4);
    line-height: 1;
    text-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
  }
  .symbol .big { font-size: calc(var(--card-w, 64px) * 0.34); }
  svg.big { width: calc(var(--card-w, 64px) * 0.42); height: calc(var(--card-w, 64px) * 0.42); filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.3)); }

  .idx {
    position: absolute;
    color: var(--idx);
    font-weight: 800;
    font-size: calc(var(--card-w, 64px) * 0.22);
    line-height: 1;
    display: grid;
  }
  svg.idx { width: calc(var(--card-w, 64px) * 0.22); height: calc(var(--card-w, 64px) * 0.22); }
  .idx.tl { top: 6%; left: 9%; }
  .idx.br { bottom: 6%; right: 9%; transform: rotate(180deg); }

  /* Deck back: felt panel with the brass WILDCARD monogram. */
  .back {
    background:
      radial-gradient(120% 120% at 50% 40%, #234a3a 0%, #16342700 60%),
      repeating-linear-gradient(45deg, #14332680 0 6px, #1c3f30 6px 12px), #163a2c;
  }
  .back-mono {
    position: absolute;
    inset: 14%;
    border: 2px solid var(--brass);
    border-radius: 50%;
    color: var(--brass);
    font-family: var(--display);
    font-weight: 700;
    font-size: calc(var(--card-w, 64px) * 0.4);
    display: grid;
    place-items: center;
  }

  .playable {
    transform: translateY(-12px);
    box-shadow: 0 12px 22px rgb(0 0 0 / 0.5), 0 0 0 3px var(--brass);
    cursor: pointer;
  }
  .playable:active { transform: translateY(-6px); }
  .action-pending {
    transform: translateY(-6px) scale(0.98);
    box-shadow: 0 8px 16px rgb(0 0 0 / 0.45), 0 0 0 4px var(--brass);
    animation: action-pending-pulse 480ms ease-in-out infinite alternate;
  }
  @keyframes action-pending-pulse {
    to { opacity: 0.78; box-shadow: 0 8px 16px rgb(0 0 0 / 0.45), 0 0 0 5px rgb(230 184 75 / 0.65); }
  }
</style>
