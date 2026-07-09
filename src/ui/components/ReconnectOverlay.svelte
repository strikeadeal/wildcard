<script lang="ts">
  import type { RecoveryState } from '../connection-state';
  import { session } from '../session.svelte';

  let { state }: { state: RecoveryState } = $props();

  const message = $derived.by(() => {
    switch (state) {
      case 'unstable': return 'Connection unstable…';
      case 'reconnecting': return 'Rejoining your seat…';
      case 'roomUnavailable': return 'Room unavailable. The host may have left.';
      case 'networkUnavailable': return 'Could not reconnect. Check your network.';
      default: return '';
    }
  });
</script>

<div class="overlay" role="status" aria-live="polite">
  <div class="sheet">
    <p>{message}</p>
    {#if state === 'roomUnavailable' || state === 'networkUnavailable'}
      <div class="actions">
        {#if state === 'networkUnavailable'}
          <button onclick={() => session.retryRecovery()}>Retry</button>
        {/if}
        <button class="ghost" onclick={() => session.leave()}>Home</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgb(6 16 12 / 0.68);
    display: flex;
    align-items: center;
    justify-content: center;
    padding:
      calc(24px + var(--safe-top))
      calc(24px + var(--safe-right))
      calc(24px + var(--safe-bottom))
      calc(24px + var(--safe-left));
    z-index: 14;
  }
  .sheet {
    width: min(100%, 320px);
    background: rgb(12 30 22 / 0.94);
    border: 1px solid rgb(255 255 255 / 0.12);
    border-radius: 8px;
    box-shadow: 0 20px 50px rgb(0 0 0 / 0.45);
    padding: 24px 20px;
    display: grid;
    gap: 18px;
    text-align: center;
  }
  p {
    margin: 0;
    font-family: var(--display);
    font-size: 1.2rem;
    font-weight: 600;
  }
  .actions {
    display: flex;
    justify-content: center;
    gap: 12px;
    flex-wrap: wrap;
  }
</style>
