<script lang="ts">
  import { session } from '../session.svelte';

  const label = $derived({
    create: 'Creating your room…',
    join: 'Finding the host…',
    rejoin: 'Rejoining your seat…'
  }[session.operation ?? 'join']);
</script>

<main>
  <div class="spinner" aria-hidden="true"></div>
  <p>{label}</p>
  <button class="ghost" onclick={() => session.leave()}>Cancel</button>
</main>

<style>
  main {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    padding:
      calc(var(--space-5) + var(--safe-top))
      calc(20px + var(--safe-right))
      calc(var(--space-6) + var(--safe-bottom))
      calc(20px + var(--safe-left));
  }
  .spinner {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 3px solid var(--line);
    border-top-color: var(--brass);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  p { margin: 0; font-family: var(--display); font-size: 1.3rem; }
</style>
