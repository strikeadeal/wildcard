<script lang="ts">
  import { untrack } from 'svelte';
  import type { PlayerView } from '../../engine/types';
  import { deriveActionPrompt } from '../action-prompt';

  let { view }: { view: PlayerView } = $props();

  const prompt = $derived(deriveActionPrompt(view));

  // Bump the nonce only on the waiting → active|urgent edge (your turn just
  // started) so the one-shot rise + underline beat doesn't replay on every
  // prompt-text change within the same turn. `untrack` on the initializer
  // marks the one-time read as intentional (not a missed derived).
  let nonce = $state(0);
  let lastTone = $state<'active' | 'waiting' | 'urgent'>(untrack(() => prompt.tone));
  $effect(() => {
    if (lastTone === 'waiting' && prompt.tone !== 'waiting') nonce++;
    lastTone = prompt.tone;
  });
</script>

<div class="prompt {prompt.tone}">
  {#key nonce}
    <span class="text" class:beat={nonce > 0}>{prompt.text}</span>
  {/key}
</div>

<style>
  .prompt {
    min-height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 0 4px;
  }
  .text { position: relative; }

  .waiting .text { color: var(--muted); font-size: 0.9rem; }

  .active .text {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--text);
    font-weight: 600;
  }
  .active .text::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--brass);
  }

  .urgent .text {
    color: var(--brass);
    font-weight: 700;
    background: rgb(230 184 75 / 0.14);
    padding: 4px 16px;
    border-radius: 999px;
  }

  /* "Your turn begins" beat: a one-shot rise + brass underline sweep, gated
     on `nonce > 0` so it never plays on first paint — only on the
     waiting → active|urgent transition. CSS-only, so the reduced-motion
     kill-switch in app.css covers it. */
  .text.beat { animation: prompt-rise var(--motion-medium) var(--ease-out); }
  .text.beat::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -3px;
    height: 2px;
    background: var(--brass);
    transform-origin: left;
    animation: prompt-underline var(--motion-medium) var(--ease-out) forwards;
  }
  @keyframes prompt-rise {
    0% { opacity: 0; transform: translateY(6px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes prompt-underline {
    0% { transform: scaleX(0); opacity: 1; }
    70% { transform: scaleX(1); opacity: 1; }
    100% { transform: scaleX(1); opacity: 0; }
  }
</style>
