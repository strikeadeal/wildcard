<script lang="ts">
  import { session } from '../session.svelte';
  import { formatNotice } from '../public-notices';

  const items = $derived(session.noticeHistory.slice().reverse());
</script>

{#if items.length}
  <ol class="action-history" aria-label="Recent actions">
    {#each items as notice (notice.id)}
      <li>{formatNotice(notice, session.view?.players ?? [], session.view?.you.id ?? '')}</li>
    {/each}
  </ol>
{/if}

<style>
  .action-history {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: min(100%, 420px);
    color: rgb(247 242 230 / 0.78);
    font-size: 0.84rem;
    line-height: 1.3;
    text-align: center;
    pointer-events: none;
  }

  li {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-shadow: 0 1px 10px rgb(0 0 0 / 0.42);
  }
</style>
