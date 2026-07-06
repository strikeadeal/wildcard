<script lang="ts">
  import { session } from '../session.svelte';
  import CardFace from '../components/CardFace.svelte';
  import ColorPicker from '../components/ColorPicker.svelte';
  import OpponentSeat from '../components/OpponentSeat.svelte';
  import SwapPicker from '../components/SwapPicker.svelte';
  import RoundEnd from '../components/RoundEnd.svelte';
  import type { Card, Color } from '../../engine/types';

  const view = $derived(session.view);
  const myTurn = $derived(view !== null && view.turnPlayerId === view.you.id);
  const others = $derived.by(() => {
    if (!view) return [];
    const idx = view.players.findIndex((p) => p.id === view.you.id);
    return [...view.players.slice(idx + 1), ...view.players.slice(0, idx)];
  });
  const turnName = $derived(
    view?.players.find((p) => p.id === view?.turnPlayerId)?.name ?? ''
  );
  const stuckPlayer = $derived.by(() => {
    if (!view || !session.isHost || view.phase === 'roundEnd') return null;
    const holder = view.players.find((p) => p.id === view.turnPlayerId);
    return holder && !holder.connected ? holder : null;
  });

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
          oncatch={() => session.sendAction({ type: 'catchUno', targetId: p.id })}
        />
      {/each}
    </div>

    <div class="center">
      <div class="piles">
        <div class="drawpile">
          <CardFace facedown onclick={view.canDraw ? () => session.sendAction({ type: 'drawCard' }) : undefined} />
          <small>{view.deckCount} left</small>
          {#if view.pendingDraw > 0}<strong class="penalty">+{view.pendingDraw}!</strong>{/if}
        </div>
        <div class="discard">
          <CardFace card={view.discardTop} />
          <small class="colordot {view.currentColor}">{view.currentColor}</small>
        </div>
        <span class="direction" aria-label="direction of play">
          {view.direction === 1 ? '↻' : '↺'}
        </span>
      </div>
      <p class="status" aria-live="polite">
        {myTurn ? 'Your turn' : turnName + "'s turn"}
      </p>
      {#if stuckPlayer}
        <div class="stuck">
          <small>{stuckPlayer.name} is disconnected.</small>
          <button class="ghost" onclick={() => session.skipTurn(stuckPlayer.id)}>Skip their turn</button>
          <button class="ghost" onclick={() => session.removeSeat(stuckPlayer.id)}>Remove them</button>
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
        <CardFace
          {card}
          playable={view.playableCardIds.includes(card.id)}
          onclick={view.playableCardIds.includes(card.id) ? () => cardClicked(card) : undefined}
        />
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
{/if}

<style>
  .table {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    padding: 12px;
    gap: 8px;
  }
  .opponents {
    display: flex;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .piles { display: flex; align-items: center; gap: 20px; }
  .drawpile, .discard { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  small { color: var(--muted); }
  .penalty { color: var(--card-yellow); }
  .colordot { text-transform: capitalize; font-weight: 700; }
  .colordot.red { color: var(--card-red); }
  .colordot.yellow { color: var(--card-yellow); }
  .colordot.green { color: var(--card-green); }
  .colordot.blue { color: var(--card-blue); }
  .direction { font-size: 1.6em; color: var(--muted); }
  .status { margin: 0; font-weight: 600; }
  .stuck { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .actions { display: flex; justify-content: center; gap: 10px; min-height: 48px; flex-wrap: wrap; }
  .lastcard { background: var(--card-yellow); color: #3b3200; font-weight: 800; }
  .hand {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 12px 4px 4px;
    --card-w: 72px;
  }
</style>
