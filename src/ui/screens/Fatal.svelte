<script lang="ts">
  import { session } from '../session.svelte';
</script>

<main>
  <h2>{session.fatal?.title}</h2>
  <p>{session.fatal?.detail}</p>
  {#if session.fatal?.canRejoin}
    <button onclick={() => session.rejoin()}>Rejoin my seat</button>
  {/if}
  <button class="ghost" onclick={() => session.leave()}>Back to start</button>
</main>

<style>
  main {
    max-width: 420px;
    margin: 0 auto;
    padding: 48px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    text-align: center;
  }
  p { color: var(--muted); }
</style>
