<script lang="ts">
  import { session } from '../session.svelte';
  import { formatNotice } from '../public-notices';
  import { fly, fade } from 'svelte/transition';
  import { prefersReducedMotion } from '../motion';

  // Svelte JS transitions aren't caught by the CSS reduced-motion kill-switch.
  const reduce = prefersReducedMotion();
  const text = $derived(
    session.currentNotice
      ? formatNotice(session.currentNotice, session.view?.players ?? [], session.view?.you.id ?? '')
      : session.banner
  );
  const noticeKey = $derived(session.currentNotice?.id ?? session.banner ?? '');
</script>

{#if text}
  {#key noticeKey}
    <div
      class="announce"
      role="status"
      aria-live="polite"
      in:fly={{ y: reduce ? 0 : -18, duration: reduce ? 0 : 240 }}
      out:fade={{ duration: reduce ? 0 : 180 }}
    >
      {text}
    </div>
  {/key}
{/if}

<style>
  .announce {
    font-family: var(--display);
    font-weight: 600;
    font-size: 1.05rem;
    letter-spacing: 0.01em;
    color: var(--felt-edge);
    background: var(--brass);
    padding: 8px 22px;
    border-radius: 999px;
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.4), 0 0 24px rgb(230 184 75 / 0.35);
    white-space: nowrap;
    pointer-events: none;
  }
</style>
