<script lang="ts">
  import { session } from '../session.svelte';
  import { flip } from 'svelte/animate';
  import CardFace from '../components/CardFace.svelte';
  import ColorPicker from '../components/ColorPicker.svelte';
  import OpponentSeat from '../components/OpponentSeat.svelte';
  import SwapPicker from '../components/SwapPicker.svelte';
  import RoundEnd from '../components/RoundEnd.svelte';
  import Announce from '../components/Announce.svelte';
  import AnimationLayer from '../components/AnimationLayer.svelte';
  import type { Card, Color } from '../../engine/types';
  import { prefersReducedMotion, anchor, getAnchorRect } from '../motion';
  import { cubicOut } from 'svelte/easing';

  const view = $derived(session.view);
  const myTurn = $derived(view !== null && view.turnPlayerId === view.you.id);
  const others = $derived.by(() => {
    if (!view) return [];
    const idx = view.players.findIndex((p) => p.id === view.you.id);
    return [...view.players.slice(idx + 1), ...view.players.slice(0, idx)];
  });
  const drawFx = $derived(session.fxEvent?.kind === 'draw' ? session.fxEvent : null);
  const turnName = $derived(
    view?.players.find((p) => p.id === view?.turnPlayerId)?.name ?? ''
  );
  const stuckPlayer = $derived.by(() => {
    if (!view || !session.isHost || view.phase === 'roundEnd') return null;
    const holder = view.players.find((p) => p.id === view.turnPlayerId);
    return holder && !holder.connected ? holder : null;
  });

  // FLIP / JS transitions aren't caught by the CSS reduced-motion kill-switch.
  const reduce = prefersReducedMotion();
  const flipDur = reduce ? 0 : 220;

  // A played card flies onto the discard from the direction of its player:
  // up from your hand when you played it, down from the opponents otherwise.
  function land(_node: Element, { fromSelf }: { fromSelf: boolean }) {
    const dy = fromSelf ? 70 : -70;
    return {
      duration: reduce ? 0 : 300,
      css: (t: number, u: number) =>
        `transform: translateY(${u * dy}px) scale(${0.72 + t * 0.28}); opacity: ${t}`
    };
  }

  // A newly-held card flies from the draw pile into its slot, then the FLIP
  // reflow settles the hand. Falls back to a short lift if the deck isn't
  // measured yet (e.g. very first paint).
  function dealIn(node: Element) {
    const deck = getAnchorRect('deck');
    const rect = node.getBoundingClientRect();
    const dx = deck ? deck.left + deck.width / 2 - (rect.left + rect.width / 2) : 0;
    const dy = deck ? deck.top + deck.height / 2 - (rect.top + rect.height / 2) : -46;
    return {
      duration: reduce ? 0 : 320,
      easing: cubicOut,
      css: (t: number, u: number) =>
        `transform: translate(${u * dx}px, ${u * dy}px) scale(${0.6 + t * 0.4}); opacity: ${t}`
    };
  }

  let pendingWild = $state<number | null>(null);

  function cardClicked(card: Card) {
    if (!view || !view.playableCardIds.includes(card.id)) return;
    if (card.color === null) {
      pendingWild = card.id;
      return;
    }
    play(card.id);
  }

  function play(cardId: number, chosenColor?: Color) {
    if (myTurn) session.sendAction({ type: 'playCard', cardId, chosenColor });
    else session.sendAction({ type: 'jumpIn', cardId, chosenColor });
  }

  function pickColor(color: Color) {
    if (pendingWild !== null) {
      play(pendingWild, color);
      pendingWild = null;
    } else if (view?.mustChooseColor) {
      session.sendAction({ type: 'chooseColor', color });
    }
  }
</script>

{#if view}
  <div class="table">
    <div class="opponents">
      {#each others as p (p.id)}
        <OpponentSeat
          player={p}
          isTurn={view.turnPlayerId === p.id}
          catchable={view.catchableIds.includes(p.id)}
          drewNonce={drawFx && drawFx.playerId === p.id ? drawFx.nonce : 0}
          oncatch={() => session.sendAction({ type: 'catchUno', targetId: p.id })}
        />
      {/each}
    </div>

    <div class="center">
      <div class="announce-slot"><Announce /></div>
      <div class="piles">
        <div class="drawpile">
          <div class="stack" use:anchor={'deck'}>
            <CardFace facedown onclick={view.canDraw ? () => session.sendAction({ type: 'drawCard' }) : undefined} />
          </div>
          <small>{view.deckCount} in deck</small>
          {#if view.pendingDraw > 0}<strong class="penalty">Draw +{view.pendingDraw}</strong>{/if}
        </div>

        <div class="discard">
          {#key view.discardTop?.id}
            <div class="landed" in:land={{ fromSelf: session.lastPlayFromSelf }}>
              <CardFace card={view.discardTop} />
            </div>
          {/key}
          <span class="colordot {view.currentColor}" aria-label="current color {view.currentColor}">
            {view.currentColor}
          </span>
        </div>

        <span class="direction" aria-label="direction of play">
          {view.direction === 1 ? '↻' : '↺'}
        </span>
      </div>

      <p class="status" class:mine={myTurn} aria-live="polite">
        {myTurn ? 'Your turn' : turnName + "'s turn"}
      </p>

      {#if stuckPlayer}
        <div class="stuck">
          <small>{stuckPlayer.name} is disconnected.</small>
          <button class="ghost small" onclick={() => session.skipTurn(stuckPlayer.id)}>Skip their turn</button>
          <button class="ghost small" onclick={() => session.removeSeat(stuckPlayer.id)}>Remove them</button>
        </div>
      {/if}
    </div>

    <div class="actions">
      {#if view.canChallenge}
        <button onclick={() => session.sendAction({ type: 'challengeWildFour' })}>Challenge the +4</button>
      {/if}
      {#if view.canPass}
        <button class="ghost" onclick={() => session.sendAction({ type: 'passTurn' })}>Keep it</button>
      {/if}
      {#if view.canCallUno}
        <button class="lastcard" onclick={() => session.sendAction({ type: 'callUno' })}>Last card!</button>
      {/if}
    </div>

    <div class="hand" role="group" aria-label="Your hand">
      {#each view.you.hand as card (card.id)}
        <div
          class="handcard"
          animate:flip={{ duration: flipDur }}
          in:dealIn
        >
          <CardFace
            {card}
            playable={view.playableCardIds.includes(card.id)}
            onclick={view.playableCardIds.includes(card.id) ? () => cardClicked(card) : undefined}
          />
        </div>
      {/each}
    </div>
  </div>

  {#if pendingWild !== null || view.mustChooseColor}
    <ColorPicker onpick={pickColor} />
  {/if}
  {#if view.mustChooseSwapTarget}
    <SwapPicker
      players={others}
      onpick={(id) => session.sendAction({ type: 'chooseSwapTarget', targetId: id })}
    />
  {/if}
  {#if view.phase === 'roundEnd'}
    <RoundEnd />
  {/if}
  <AnimationLayer />
{/if}

<style>
  .table {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    padding: 14px 12px calc(12px + env(safe-area-inset-bottom));
    gap: 6px;
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
  /* Announcement banner floats near the top of the pitch, above the piles. */
  .announce-slot {
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    display: flex;
    justify-content: center;
    max-width: 92%;
    pointer-events: none;
  }
  .piles { display: flex; align-items: center; gap: 24px; --card-w: 86px; }
  .drawpile, .discard { display: flex; flex-direction: column; align-items: center; gap: 8px; }

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

  .status {
    margin: 0;
    font-family: var(--display);
    font-weight: 600;
    font-size: 1.25rem;
    padding: 6px 18px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.22);
    border: 1px solid var(--line);
  }
  .status.mine {
    color: var(--felt-edge);
    background: var(--brass);
    border-color: transparent;
    animation: turnglow 2s ease-in-out infinite;
  }
  @keyframes turnglow {
    0%, 100% { box-shadow: 0 0 0 0 rgb(230 184 75 / 0); }
    50% { box-shadow: 0 0 22px 2px rgb(230 184 75 / 0.55); }
  }

  .stuck { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
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
  }
  .hand::-webkit-scrollbar { display: none; }
  /* Hold them like a real hand: a slight overlap. */
  .handcard { margin-inline: -8px; }
  .handcard:first-child { margin-inline-start: 0; }
  .handcard:last-child { margin-inline-end: 0; }
</style>
