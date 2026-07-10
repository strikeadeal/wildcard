<script lang="ts">
  import { session } from '../session.svelte';
  import { flip } from 'svelte/animate';
  import CardFace from '../components/CardFace.svelte';
  import ColorPicker from '../components/ColorPicker.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import OpponentSeat from '../components/OpponentSeat.svelte';
  import SwapPicker from '../components/SwapPicker.svelte';
  import RoundEnd from '../components/RoundEnd.svelte';
  import ActionHistory from '../components/ActionHistory.svelte';
  import TurnPrompt from '../components/TurnPrompt.svelte';
  import AnimationLayer from '../components/AnimationLayer.svelte';
  import ReconnectOverlay from '../components/ReconnectOverlay.svelte';
  import type { Card, Color, OpponentView } from '../../engine/types';
  import { prefersReducedMotion, anchor, getAnchorRect, dealDelay } from '../motion';
  import { cubicOut } from 'svelte/easing';
  import { noticeToGameEvent } from '../public-notices';
  import { discardTilt } from '../discard-pile';
  import type { RecoveryState } from '../connection-state';
  import { cueForNotice, initFeedback, isMuted, playCue, setMuted } from '../feedback';

  const view = $derived(session.view);
  const recovery = $derived(session.recovery);
  const selectionEpoch = $derived(session.selectionEpoch);
  const recovering = $derived(recovery !== 'idle');
  const myTurn = $derived(view !== null && view.turnPlayerId === view.you.id);
  const others = $derived.by(() => {
    if (!view) return [];
    const idx = view.players.findIndex((p) => p.id === view.you.id);
    return [...view.players.slice(idx + 1), ...view.players.slice(0, idx)];
  });
  const drawFx = $derived(session.fxEvent?.kind === 'draw' ? session.fxEvent : null);
  // The pile behind the top discard — same array minus its last (current top)
  // entry — rendered as inert, absolutely-positioned cards for depth.
  const underDiscards = $derived(session.recentDiscards.slice(0, -1));
  const topTilt = $derived(view?.discardTop ? discardTilt(view.discardTop.id) : 0);
  // Latch the nonce of the last skip / reverse so the beat re-triggers (via
  // {#key}) only when that specific special lands, not on every event.
  let stampNonce = $state(0);
  let spinNonce = $state(0);
  let lastNoticeFxId = $state(-1);
  $effect(() => {
    const fx = session.fxEvent;
    if (fx?.kind !== 'special') return;
    if (fx.card.value === 'skip') stampNonce = fx.nonce;
    else if (fx.card.value === 'reverse') spinNonce = fx.nonce;
  });
  $effect(() => {
    const notice = session.currentNotice;
    const youId = view?.you.id ?? '';
    if (!notice || notice.id === lastNoticeFxId) return;
    lastNoticeFxId = notice.id;
    const event = noticeToGameEvent(notice, youId);
    if (event) session.fxEvent = { ...event, nonce: notice.id };
  });

  // Haptics + synthesized sound. Kept as a separate effect (own last-id
  // latch) from the fx effect above so the two concerns never entangle.
  initFeedback();
  let muted = $state(isMuted());
  let lastNoticeFeedbackId = $state(-1);
  $effect(() => {
    const notice = session.currentNotice;
    const youId = view?.you.id ?? '';
    if (!notice || notice.id === lastNoticeFeedbackId) return;
    lastNoticeFeedbackId = notice.id;
    const cue = cueForNotice(notice, youId);
    if (cue) playCue(cue);
  });
  // A your-turn cue on the false→true edge only, gated by a first-view latch
  // so the initial deal / page load never chimes.
  let seenFirstView = $state(false);
  let wasMyTurn = $state(false);
  $effect(() => {
    if (!view) {
      seenFirstView = false;
      wasMyTurn = false;
      return;
    }
    if (!seenFirstView) {
      seenFirstView = true;
      wasMyTurn = myTurn;
      return;
    }
    if (myTurn && !wasMyTurn) playCue('yourTurn');
    wasMyTurn = myTurn;
  });
  function toggleMute() {
    muted = !muted;
    setMuted(muted);
  }
  // FLIP / JS transitions aren't caught by the CSS reduced-motion kill-switch.
  const reduce = prefersReducedMotion();
  const flipDur = reduce ? 0 : 220;

  // A played card flies onto the discard from the direction of its player:
  // up from your hand when you played it, down from the opponents otherwise.
  // When it's your play, the flight originates at the hand's actual on-screen
  // position (falling back to the fixed offset if it isn't measured yet); the
  // rotation unwinds from a reversed tilt down to 0 as it lands, so it settles
  // into the resting tilt held by the static inner `.tilt` wrapper.
  function land(node: Element, { fromSelf, tilt }: { fromSelf: boolean; tilt: number }) {
    const handRect = fromSelf ? getAnchorRect('hand') : null;
    const rect = node.getBoundingClientRect();
    let dx = 0;
    let dy = fromSelf ? 70 : -70;
    if (handRect) {
      dx = handRect.left + handRect.width / 2 - (rect.left + rect.width / 2);
      dy = handRect.top + handRect.height / 2 - (rect.top + rect.height / 2);
    }
    return {
      duration: reduce ? 0 : 300,
      css: (t: number, u: number) =>
        `transform: translate(${u * dx}px, ${u * dy}px) rotate(${u * -tilt}deg) scale(${0.72 + t * 0.28}); opacity: ${t}`
    };
  }

  // A newly-held card flies from the draw pile into its slot, then the FLIP
  // reflow settles the hand. Falls back to a short lift if the deck isn't
  // measured yet (e.g. very first paint).
  function dealIn(node: Element, { index }: { index: number }) {
    const deck = getAnchorRect('deck');
    const rect = node.getBoundingClientRect();
    const dx = deck ? deck.left + deck.width / 2 - (rect.left + rect.width / 2) : 0;
    const dy = deck ? deck.top + deck.height / 2 - (rect.top + rect.height / 2) : -46;
    return {
      delay: dealDelay(index, session.freshDeal, reduce),
      duration: reduce ? 0 : 320,
      easing: cubicOut,
      css: (t: number, u: number) =>
        `transform: translate(${u * dx}px, ${u * dy}px) scale(${0.6 + t * 0.4}); opacity: ${t}`
    };
  }

  let pendingWild = $state<number | null>(null);
  let pendingRemove = $state<OpponentView | null>(null);
  let lastSelectionEpoch = $state(-1);
  $effect(() => {
    if (selectionEpoch === lastSelectionEpoch) return;
    lastSelectionEpoch = selectionEpoch;
    pendingWild = null;
    pendingRemove = null;
  });
  $effect(() => {
    if (!import.meta.env.DEV) return;
    const testApi = ((window as any).__wildcardTest ??= {});
    testApi.openPendingWildPicker = () => {
      if (!recovering && view) pendingWild = Number.MAX_SAFE_INTEGER;
    };
    return () => {
      if ((window as any).__wildcardTest?.openPendingWildPicker) {
        delete (window as any).__wildcardTest.openPendingWildPicker;
      }
    };
  });

  function cardClicked(card: Card) {
    if (recovering || !view || !view.playableCardIds.includes(card.id)) return;
    if (card.color === null) {
      pendingWild = card.id;
      return;
    }
    play(card.id);
  }

  function play(cardId: number, chosenColor?: Color) {
    if (recovering) return;
    if (myTurn) session.sendAction({ type: 'playCard', cardId, chosenColor });
    else session.sendAction({ type: 'jumpIn', cardId, chosenColor });
  }

  function pickColor(color: Color) {
    if (recovering) return;
    if (pendingWild !== null) {
      play(pendingWild, color);
      pendingWild = null;
    } else if (view?.mustChooseColor) {
      session.sendAction({ type: 'chooseColor', color });
    }
  }

  function removePlayer(player: OpponentView) {
    if (recovering) return;
    pendingRemove = player;
  }
</script>

{#if view}
  <div class="table" class:my-turn={myTurn}>
    <button
      type="button"
      class="ghost mute-toggle"
      aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
      aria-pressed={muted}
      onclick={toggleMute}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 9v6h4l5 5V4L8 9H4z" fill="currentColor" stroke="none" />
        {#if muted}
          <line x1="16.5" y1="9" x2="21.5" y2="15" />
          <line x1="21.5" y1="9" x2="16.5" y2="15" />
        {:else}
          <path d="M16.2 8.6a5 5 0 0 1 0 6.8" />
          <path d="M18.6 6a9 9 0 0 1 0 12" />
        {/if}
      </svg>
    </button>

    <div class="opponents">
      {#each others as p (p.id)}
        <OpponentSeat
          player={p}
          isTurn={view.turnPlayerId === p.id}
          catchable={view.catchableIds.includes(p.id)}
          drewNonce={drawFx && drawFx.playerId === p.id ? drawFx.nonce : 0}
          onskip={session.isHost && !p.connected && view.turnPlayerId === p.id
            ? () => session.skipTurn(p.id)
            : undefined}
          onremove={session.isHost && !p.connected
            ? () => removePlayer(p)
            : undefined}
          oncatch={() => {
            if (!recovering) session.sendAction({ type: 'catchUno', targetId: p.id });
          }}
        />
      {/each}
    </div>

    <div class="center">
      <div class="piles">
        <div class="drawpile" class:drawable={view.canDraw && !recovering}>
          <div class="stack" use:anchor={'deck'}>
            <CardFace
              facedown
              onclick={!recovering && view.canDraw
                ? () => session.sendAction({ type: 'drawCard' })
                : undefined}
            />
          </div>
          <small>{view.deckCount} in deck</small>
          {#key view.pendingDraw}
            {#if view.pendingDraw > 0}<strong class="penalty pop">Draw +{view.pendingDraw}</strong>{/if}
          {/key}
        </div>

        <div class="discard">
          <div class="pile">
            {#each underDiscards as underCard (underCard.id)}
              <div
                class="under"
                style="transform: translate({(underCard.id % 5) - 2}px, {(underCard.id % 3) - 1}px) rotate({discardTilt(underCard.id)}deg)"
                aria-hidden="true"
              >
                <CardFace card={underCard} />
              </div>
            {/each}
            {#key view.discardTop?.id}
              <div class="landed" in:land={{ fromSelf: session.lastPlayFromSelf, tilt: topTilt }}>
                <div class="tilt" style="transform: rotate({topTilt}deg)">
                  <CardFace card={view.discardTop} />
                </div>
              </div>
            {/key}
            {#key stampNonce}
              {#if stampNonce > 0}
                <svg class="skip-stamp" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.4" aria-hidden="true">
                  <circle cx="12" cy="12" r="8.4" /><line x1="6.2" y1="17.8" x2="17.8" y2="6.2" />
                </svg>
              {/if}
            {/key}
          </div>
          <span class="colordot {view.currentColor}" aria-label="current color {view.currentColor}">
            {view.currentColor}
          </span>
        </div>

        {#key spinNonce}
          <span class="direction" class:spin={spinNonce > 0} aria-label="direction of play">
            {view.direction === 1 ? '↻' : '↺'}
          </span>
        {/key}
      </div>

      <ActionHistory />
    </div>

    <TurnPrompt {view} />

      <div class="actions">
      {#if view.canChallenge}
        <button disabled={recovering} onclick={!recovering ? () => session.sendAction({ type: 'challengeWildFour' }) : undefined}>Challenge the +4</button>
      {/if}
      {#if view.canPass}
        <button class="ghost" disabled={recovering} onclick={!recovering ? () => session.sendAction({ type: 'passTurn' }) : undefined}>Keep it</button>
      {/if}
      {#if view.canCallUno}
        <button class="lastcard" disabled={recovering} onclick={!recovering ? () => session.sendAction({ type: 'callUno' }) : undefined}>Last card!</button>
      {/if}
    </div>

    <div class="hand" role="group" aria-label="Your hand" use:anchor={'hand'}>
      {#each view.you.hand as card, i (card.id)}
        <div
          class="handcard"
          animate:flip={{ duration: flipDur }}
          in:dealIn|global={{ index: i }}
        >
          <CardFace
            {card}
            playable={view.playableCardIds.includes(card.id)}
            onclick={!recovering && view.playableCardIds.includes(card.id)
              ? () => cardClicked(card)
              : undefined}
          />
        </div>
      {/each}
    </div>
  </div>

  {#if recovery !== 'idle'}
    <ReconnectOverlay state={recovery as RecoveryState} />
  {/if}

  {#if !recovering && (pendingWild !== null || view.mustChooseColor)}
    <ColorPicker onpick={pickColor} />
  {/if}
  {#if !recovering && view.mustChooseSwapTarget}
    <SwapPicker
      players={others}
      onpick={(id) => session.sendAction({ type: 'chooseSwapTarget', targetId: id })}
    />
  {/if}
  {#if view.phase === 'roundEnd'}
    <RoundEnd />
  {/if}
  {#if !recovering && pendingRemove}
    <ConfirmDialog
      title={`Remove ${pendingRemove.name}?`}
      body={`${pendingRemove.name} will be removed from this game.`}
      confirmLabel="Remove player"
      onconfirm={() => {
        if (pendingRemove) session.removeSeat(pendingRemove.id);
        pendingRemove = null;
      }}
      oncancel={() => { pendingRemove = null; }}
    />
  {/if}
  <AnimationLayer />
{/if}

<style>
  .table {
    position: relative;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    padding:
      calc(14px + var(--safe-top))
      calc(12px + var(--safe-right))
      calc(12px + var(--safe-bottom))
      calc(12px + var(--safe-left));
    gap: 6px;
  }
  .mute-toggle {
    position: absolute;
    top: calc(6px + var(--safe-top));
    right: calc(6px + var(--safe-right));
    z-index: 5;
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    padding: 0;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.75;
  }
  .mute-toggle:hover:not(:disabled) { opacity: 1; }
  .table.my-turn .hand {
    outline: 1px solid rgb(230 184 75 / 0.45);
    box-shadow: 0 0 0 1px rgb(230 184 75 / 0.2) inset, 0 0 24px rgb(230 184 75 / 0.18);
  }
  .opponents {
    display: flex;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .center {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  /* The felt "pitch": a faint marked oval where cards are played. */
  .center::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: min(78vw, 320px);
    height: min(52vh, 380px);
    transform: translate(-50%, -54%);
    border-radius: 50%;
    border: 1px solid rgb(255 255 255 / 0.06);
    background: radial-gradient(ellipse at center, rgb(255 255 255 / 0.045), transparent 68%);
    pointer-events: none;
  }
  .center > * { position: relative; }
  .piles { display: flex; align-items: center; gap: 24px; --card-w: 86px; }
  .drawpile, .discard { display: flex; flex-direction: column; align-items: center; gap: 8px; position: relative; }

  /* The stack of cards behind the top discard: inert depth, never interactive. */
  .pile { position: relative; }
  .under {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  /* Positioned so it paints in the same phase as the absolutely-positioned
     .under cards, where DOM order keeps the top card above the pile. */
  .landed { position: relative; }
  /* Holds the deterministic resting tilt so `land` (which owns the outer
     transform for the fly-in) can animate independently of it — a card keeps
     this same rotation whether it's the top card or has been demoted to an
     under-card, so demotion never visually jumps. */
  .tilt { width: 100%; height: 100%; }

  /* When a draw is available, the deck gets a subtle brass halo. The static
     box-shadow is the reduced-motion fallback (app.css kills the animation). */
  .drawpile.drawable .stack {
    border-radius: calc(var(--card-w) * 0.12);
    box-shadow: 0 0 12px 1px rgb(230 184 75 / 0.28);
    animation: deckpulse 2.4s ease-in-out infinite;
  }
  @keyframes deckpulse {
    0%, 100% { box-shadow: 0 0 8px 0 rgb(230 184 75 / 0.18); }
    50% { box-shadow: 0 0 16px 2px rgb(230 184 75 / 0.40); }
  }

  /* Give the draw pile the depth of a real deck. */
  .stack { position: relative; }
  .stack::before, .stack::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: calc(var(--card-w) * 0.12);
    background: #14332680;
    z-index: -1;
  }
  .stack::before { transform: translate(3px, 3px); }
  .stack::after { transform: translate(6px, 6px); opacity: 0.6; }

  small { color: var(--muted); font-size: 0.82rem; }
  .penalty {
    color: var(--felt-edge);
    background: var(--card-yellow);
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 800;
  }

  .colordot {
    text-transform: capitalize;
    font-weight: 700;
    font-size: 0.82rem;
    padding: 3px 12px;
    border-radius: 999px;
    color: var(--ink-dark);
  }
  .colordot.red { background: var(--card-red); }
  .colordot.yellow { background: var(--card-yellow); color: var(--ink-yellow); }
  .colordot.green { background: var(--card-green); }
  .colordot.blue { background: var(--card-blue); }

  .direction { font-size: 1.9rem; color: var(--muted); line-height: 1; }

  .small { min-height: 44px; padding: 0 12px; font-size: 0.85rem; }

  .actions { display: flex; justify-content: center; gap: 10px; min-height: 48px; flex-wrap: wrap; }
  .lastcard {
    background: var(--card-yellow);
    color: var(--ink-yellow);
    font-weight: 800;
    box-shadow: 0 0 20px rgb(245 197 66 / 0.4), 0 2px 0 rgb(0 0 0 / 0.25);
  }

  .hand {
    flex: 0 0 auto;
    display: flex;
    justify-content: safe center;
    overflow-x: auto;
    overflow-y: visible;
    padding: 18px 10px 6px;
    --card-w: 74px;
    scrollbar-width: none;
    border-radius: 16px;
    transition: outline-color var(--motion-medium) ease, box-shadow var(--motion-medium) ease;
  }
  .hand::-webkit-scrollbar { display: none; }
  /* Hold them like a real hand: a slight overlap. */
  .handcard { margin-inline: -8px; }
  .handcard:first-child { margin-inline-start: 0; }
  .handcard:last-child { margin-inline-end: 0; }

  .skip-stamp {
    position: absolute;
    top: 50%; left: 50%;
    width: 68%; height: 68%;
    color: var(--card-red);
    transform: translate(-50%, -50%);
    filter: drop-shadow(0 2px 4px rgb(0 0 0 / 0.5));
    pointer-events: none;
    animation: stamp 460ms var(--ease-out) forwards;
  }
  @keyframes stamp {
    0% { opacity: 0; transform: translate(-50%, -50%) scale(1.6) rotate(-12deg); }
    35% { opacity: 1; }
    60% { transform: translate(-50%, -50%) scale(1) rotate(0deg); }
    100% { opacity: 0; transform: translate(-50%, -50%) scale(1) rotate(0deg); }
  }

  .direction.spin { animation: revspin 460ms var(--ease-out); }
  @keyframes revspin {
    0% { transform: rotate(0deg) scale(1); color: var(--brass); }
    100% { transform: rotate(360deg) scale(1); }
  }

  .penalty.pop { animation: penaltypop var(--motion-emphasis) var(--ease-out); }
  @keyframes penaltypop {
    0% { transform: scale(0.7); }
    45% { transform: scale(1.18); }
    70% { transform: scale(0.96) translateX(-2px); }
    85% { transform: translateX(2px); }
    100% { transform: scale(1) translateX(0); }
  }
</style>
