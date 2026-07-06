<script lang="ts">
  import { session } from '../session.svelte';
  import CardFace from '../components/CardFace.svelte';
  import type { Card } from '../../engine/types';

  let name = $state(session.savedName());
  let code = $state(session.prefillCode);
  let busy = $state(false);

  const ready = $derived(name.trim().length > 0);

  // A decorative fan — the first thing you see is a hand of cards.
  const fan: Card[] = [
    { id: -1, color: 'blue', value: '7' },
    { id: -2, color: 'red', value: 'reverse' },
    { id: -3, color: null, value: 'wild' },
    { id: -4, color: 'green', value: 'skip' },
    { id: -5, color: 'yellow', value: '2' }
  ];

  async function create() {
    busy = true;
    await session.createRoom(name);
    busy = false;
  }

  async function join() {
    busy = true;
    await session.joinRoom(code, name);
    busy = false;
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

  <label>
    Your name
    <input bind:value={name} maxlength="20" placeholder="e.g. Sam" autocomplete="nickname" />
  </label>

  <button class="primary" onclick={create} disabled={!ready || busy}>Create a room</button>

  <div class="or"><span>or join one</span></div>

  <section class="join">
    <label>
      Room code
      <input bind:value={code} placeholder="e.g. KP4XQ" autocapitalize="characters" />
    </label>
    <button class="ghost" onclick={join} disabled={!ready || !code.trim() || busy}>Join</button>
  </section>
</main>

<style>
  main {
    max-width: 420px;
    margin: 0 auto;
    padding: 32px 22px 40px;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    gap: 18px;
    justify-content: center;
  }
  .hero { text-align: center; margin-bottom: 6px; }
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
  .primary { background: var(--accent); font-size: 1.05rem; }

  .or {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .or::before, .or::after { content: ''; height: 1px; flex: 1; background: var(--line); }

  .join { display: flex; align-items: flex-end; gap: 10px; }
  .join label { flex: 1; }
  .join .ghost { align-self: flex-end; }
</style>
