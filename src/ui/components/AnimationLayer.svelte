<script lang="ts">
  import { session } from '../session.svelte';
  import { getAnchorRect, flyGhost, prefersReducedMotion } from '../motion';

  // One overlay owns every spawned/imperative effect. Declarative fx (deal-in,
  // special-card beats, count pulse) live in their own components.

  let lastNonce = $state(-1);
  let unoPop = $state<{ x: number; y: number; nonce: number } | null>(null);
  let unoTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const fx = session.fxEvent;
    if (!fx || fx.nonce === lastNonce) return;
    lastNonce = fx.nonce;
    if (prefersReducedMotion()) return;
    if (fx.kind === 'draw' && !fx.toSelf) ghostDraw(fx.playerId);
    else if (fx.kind === 'uno') showUno(fx.playerId, fx.isYou);
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

  function showUno(playerId: string, isYou: boolean) {
    let x = innerWidth / 2;
    let y = innerHeight * 0.6;
    if (!isYou) {
      const r = getAnchorRect('seat:' + playerId);
      if (r) { x = r.left + r.width / 2; y = r.bottom + 10; }
      else { y = innerHeight * 0.3; }
    }
    unoPop = { x, y, nonce: (unoPop?.nonce ?? 0) + 1 };
    clearTimeout(unoTimer);
    unoTimer = setTimeout(() => { unoPop = null; }, 750);
  }
</script>

<div class="fx-layer" aria-hidden="true">
  {#if unoPop}
    {#key unoPop.nonce}
      <span class="uno-pop" style="left: {unoPop.x}px; top: {unoPop.y}px;">UNO!</span>
    {/key}
  {/if}
</div>

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

  .uno-pop {
    position: absolute;
    transform: translate(-50%, -50%);
    font-family: var(--display);
    font-weight: 700;
    font-size: 2.2rem;
    letter-spacing: 0.04em;
    color: var(--brass);
    text-shadow: 0 2px 10px rgb(0 0 0 / 0.55), 0 0 22px rgb(230 184 75 / 0.55);
    animation: unopop 750ms cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
  }
  @keyframes unopop {
    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
    35% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
    60% { transform: translate(-50%, -50%) scale(1); }
    100% { opacity: 0; transform: translate(-50%, -60%) scale(1); }
  }
</style>
