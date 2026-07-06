<script lang="ts">
  import { session } from '../session.svelte';

  let name = $state(session.savedName());
  let code = $state(session.prefillCode);
  let busy = $state(false);

  const ready = $derived(name.trim().length > 0);

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
  <h1>WILDCARD</h1>
  <p class="tag">The classic card game, with your friends, in the browser.</p>

  <label>
    Your name
    <input bind:value={name} maxlength="20" placeholder="e.g. Sam" autocomplete="nickname" />
  </label>

  <section>
    <button onclick={create} disabled={!ready || busy}>Create a room</button>
  </section>

  <section>
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
    padding: 48px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  label { display: flex; flex-direction: column; gap: 6px; }
  section { display: flex; flex-direction: column; gap: 10px; }
  .tag { color: var(--muted); margin: 0; }
</style>
