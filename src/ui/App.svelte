<script lang="ts">
  import { onMount } from 'svelte';
  import { session } from './session.svelte';
  import Home from './screens/Home.svelte';
  import Connecting from './screens/Connecting.svelte';
  import Fatal from './screens/Fatal.svelte';
  import Lobby from './screens/Lobby.svelte';
  import Table from './screens/Table.svelte';

  function confirmLeave(e: BeforeUnloadEvent) {
    if (session.gameLive) e.preventDefault();
  }

  $effect(() => {
    if (!import.meta.env.DEV) return;
    const testApi = ((window as any).__wildcardTest ??= {});
    testApi.dropGuestConnection = () => session.dropGuestConnectionForTest();
    testApi.dropHostSignaling = () => session.dropHostSignalingForTest();
    return () => {
      if ((window as any).__wildcardTest?.dropGuestConnection) {
        delete (window as any).__wildcardTest.dropGuestConnection;
      }
      if ((window as any).__wildcardTest?.dropHostSignaling) {
        delete (window as any).__wildcardTest.dropHostSignaling;
      }
    };
  });

  onMount(() => {
    const handler = (event: Event) => session.captureInstallPrompt(event);
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  });

  onMount(() => {
    const handler = () => session.markInstalled();
    window.addEventListener('appinstalled', handler);
    return () => window.removeEventListener('appinstalled', handler);
  });
</script>

<svelte:window
  onbeforeunload={confirmLeave}
  ononline={() => session.setOnline(true)}
  onoffline={() => session.setOnline(false)}
/>

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
    bottom: calc(24px + var(--safe-bottom));
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface);
    border: 1px solid var(--line);
    padding: 12px 20px;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.45);
    max-width: 90vw;
    z-index: 20;
  }
</style>
