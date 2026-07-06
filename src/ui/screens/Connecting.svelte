<script lang="ts">
  import { session } from '../session.svelte';
</script>

<main>
  <p>Connecting…</p>
  <button class="ghost" onclick={() => session.leave()}>Cancel</button>
</main>

<style>
  main {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }
</style>
