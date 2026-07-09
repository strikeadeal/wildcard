<script lang="ts">
  import { session } from '../session.svelte';
  import CardFace from '../components/CardFace.svelte';
  import InstallPrompt from '../components/InstallPrompt.svelte';
  import type { Card } from '../../engine/types';
  import { validateCode } from '../../net/codes';

  let name = $state(session.savedName());
  let code = $state(session.prefillCode);
  let busyOp = $state<'create' | 'join' | null>(null);

  const ready = $derived(name.trim().length > 0);
  const busy = $derived(busyOp !== null);
  const codeError = $derived(validateCode(code));
  const canJoin = $derived(ready && !!code.trim() && !codeError && !busy);

  // A decorative fan — the first thing you see is a hand of cards.
  const fan: Card[] = [
    { id: -1, color: 'blue', value: '7' },
    { id: -2, color: 'red', value: 'reverse' },
    { id: -3, color: null, value: 'wild' },
    { id: -4, color: 'green', value: 'skip' },
    { id: -5, color: 'yellow', value: '2' }
  ];

  async function create() {
    busyOp = 'create';
    await session.createRoom(name);
    busyOp = null;
  }

  async function join() {
    busyOp = 'join';
    await session.joinRoom(code, name);
    busyOp = null;
  }
</script>

<main>
  <header class="hero">
    <div class="fan" aria-hidden="true">
      {#each fan as card, i (card.id)}
        <div class="fan-card" style="--i:{i - 2}">
          <CardFace {card} />
        </div>
      {/each}
    </div>
    <h1>WILDCARD</h1>
    <p class="tag">The classic card game — with your friends, right in the browser.</p>
  </header>

  {#if !session.online}
    <section class="network-note" role="status" aria-live="polite">
      <p><strong>You’re offline.</strong> The app is available, but creating or joining a room needs a network connection.</p>
      <p class="detail">Live play still depends on PeerJS signalling plus a direct or relay WebRTC path once you reconnect.</p>
    </section>
  {/if}

  <InstallPrompt />

  <label>
    Your name
    <input bind:value={name} maxlength="20" placeholder="e.g. Sam" autocomplete="nickname" />
  </label>

  <section class="host">
    <h2>Host a game</h2>
    <button class="primary" onclick={create} disabled={!ready || busy}>
      {busyOp === 'create' ? 'Creating room…' : 'Create a room'}
    </button>
  </section>

  <div class="or"><span>or</span></div>

  <section class="join">
    <h2>Join a game</h2>
    <label>
      Room code
      <input
        bind:value={code}
        placeholder="e.g. KP4XQ"
        autocapitalize="characters"
        aria-invalid={!!codeError}
      />
    </label>
    {#if codeError}
      <small class="field-error" role="status">{codeError}</small>
    {/if}
    <button class="ghost" onclick={join} disabled={!canJoin}>
      {busyOp === 'join' ? 'Joining…' : 'Join'}
    </button>
  </section>
</main>

<style>
  main {
    max-width: 420px;
    margin: 0 auto;
    padding:
      calc(32px + var(--safe-top))
      calc(22px + var(--safe-right))
      calc(40px + var(--safe-bottom))
      calc(22px + var(--safe-left));
    min-height: 100%;
    display: flex;
    flex-direction: column;
    gap: 18px;
    justify-content: center;
  }
  .hero { text-align: center; margin-bottom: 6px; }
  .network-note {
    padding: 14px 16px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--brass) 36%, var(--line));
    background: rgb(0 0 0 / 0.18);
  }
  .network-note p {
    margin: 0;
    line-height: 1.45;
  }
  .network-note .detail {
    margin-top: 8px;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .fan {
    height: 128px;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    margin-bottom: 8px;
    --card-w: 62px;
  }
  .fan-card {
    margin-inline: -13px;
    transform: rotate(calc(var(--i) * 8deg)) translateY(calc(abs(var(--i)) * 9px));
    transform-origin: bottom center;
    filter: drop-shadow(0 8px 10px rgb(0 0 0 / 0.35));
  }
  h1 {
    font-size: clamp(2.4rem, 14vw, 3.6rem);
    font-weight: 600;
    font-variation-settings: 'opsz' 144, 'SOFT' 0, 'WONK' 1;
    letter-spacing: -0.02em;
    line-height: 0.92;
    color: var(--text);
  }
  .tag { color: var(--muted); margin: 12px auto 0; max-width: 30ch; line-height: 1.4; }

  label { display: flex; flex-direction: column; gap: 6px; font-size: 0.9rem; color: var(--muted); }
  label input { color: var(--text); }

  .host, .join {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .host h2, .join h2 {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0;
  }
  .primary { background: var(--accent); font-size: 1.05rem; }

  .field-error {
    color: var(--card-red);
    font-size: 0.82rem;
    line-height: 1.4;
    margin-top: -4px;
  }

  .or {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .or::before, .or::after { content: ''; height: 1px; flex: 1; background: var(--line); }
</style>
