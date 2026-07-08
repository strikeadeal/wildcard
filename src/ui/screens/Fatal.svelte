<script lang="ts">
  import { session } from '../session.svelte';
</script>

<main>
  <div class="mark" aria-hidden="true">!</div>
  <h2>{session.fatal?.title}</h2>
  <p>{session.fatal?.detail}</p>
  {#if session.fatal?.canRejoin}
    <button class="primary" onclick={() => session.rejoin()}>Rejoin my seat</button>
  {/if}
  <button class="ghost" onclick={() => session.leave()}>Back to start</button>
</main>

<style>
  main {
    max-width: 420px;
    margin: 0 auto;
    padding:
      calc(48px + var(--safe-top))
      calc(24px + var(--safe-right))
      calc(48px + var(--safe-bottom))
      calc(24px + var(--safe-left));
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    text-align: center;
  }
  .mark {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-family: var(--display);
    font-weight: 700;
    font-size: 1.8rem;
    color: var(--card-yellow);
    border: 2px solid var(--card-yellow);
    margin-bottom: 4px;
  }
  h2 { font-size: 1.7rem; }
  p { color: var(--muted); margin: 0; line-height: 1.5; }
  .primary { background: var(--btn-green); }
</style>
