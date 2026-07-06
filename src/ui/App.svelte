<script lang="ts">
  import { session } from './session.svelte';
  import Home from './screens/Home.svelte';
  import Connecting from './screens/Connecting.svelte';
  import Fatal from './screens/Fatal.svelte';
  import Lobby from './screens/Lobby.svelte';
  import Table from './screens/Table.svelte';

  function confirmLeave(e: BeforeUnloadEvent) {
    if (session.gameLive) e.preventDefault();
  }
</script>

<svelte:window onbeforeunload={confirmLeave} />

{#if session.screen === 'home'}
  <Home />
{:else if session.screen === 'connecting'}
  <Connecting />
{:else if session.screen === 'lobby'}
  <Lobby />
{:else if session.screen === 'game'}
  <Table />
{:else}
  <Fatal />
{/if}

{#if session.toast}
  <div class="toast" role="status">{session.toast}</div>
{/if}

<style>
  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface);
    padding: 12px 20px;
    border-radius: 8px;
    max-width: 90vw;
  }
</style>
