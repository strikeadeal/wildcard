<script lang="ts">
  import { session } from '../session.svelte';
</script>

{#if session.canOfferInstall}
  <section class="install" aria-label="Install WILDCARD">
    <div>
      <h2>Install WILDCARD</h2>
      <p>Save it to your device for quicker rematches and a cleaner full-screen table.</p>
    </div>
    <div class="actions">
      <button class="ghost" onclick={() => session.dismissInstallPrompt()}>Not now</button>
      <button onclick={() => session.installApp()}>Install WILDCARD</button>
    </div>
  </section>
{/if}

<style>
  .install {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: rgb(0 0 0 / 0.18);
  }

  .install h2 {
    font-size: 1rem;
    margin-bottom: 6px;
  }

  .install p {
    margin: 0;
    color: var(--muted);
    line-height: 1.45;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .actions button {
    flex: 1 1 170px;
  }
</style>
