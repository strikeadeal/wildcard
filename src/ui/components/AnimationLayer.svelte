<script lang="ts">
  import { session } from '../session.svelte';
  import { getAnchorRect, flyGhost, prefersReducedMotion } from '../motion';

  // One overlay owns every spawned/imperative effect. Declarative fx (deal-in,
  // special-card beats, count pulse) live in their own components.
  let lastNonce = $state(-1);

  $effect(() => {
    const fx = session.fxEvent;
    if (!fx || fx.nonce === lastNonce) return;
    lastNonce = fx.nonce;
    if (prefersReducedMotion()) return;
    if (fx.kind === 'draw' && !fx.toSelf) ghostDraw(fx.playerId);
  });

  function buildBack(w: number, h: number): HTMLElement {
    const d = document.createElement('div');
    d.className = 'fx-cardback';
    d.style.width = `${w}px`;
    d.style.height = `${h}px`;
    return d;
  }

  function ghostDraw(playerId: string) {
    const from = getAnchorRect('deck');
    const to = getAnchorRect('seat:' + playerId);
    if (!from || !to) return;
    flyGhost({ fromRect: from, toRect: to, build: () => buildBack(from.width, from.height) });
  }
</script>

<div class="fx-layer" aria-hidden="true"></div>

<style>
  .fx-layer { position: fixed; inset: 0; pointer-events: none; z-index: 12; }

  /* The ghost card-back is appended to <body>, so its style must be global. */
  :global(.fx-cardback) {
    border-radius: 8px;
    background:
      radial-gradient(120% 120% at 50% 40%, #234a3a 0%, #16342700 60%),
      repeating-linear-gradient(45deg, #14332680 0 6px, #1c3f30 6px 12px), #163a2c;
    box-shadow: 0 6px 16px rgb(0 0 0 / 0.5);
  }
</style>
