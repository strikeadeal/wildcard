<script lang="ts">
  let {
    title,
    body,
    confirmLabel,
    cancelLabel = 'Cancel',
    destructive = true,
    onconfirm,
    oncancel
  }: {
    title: string;
    body?: string;
    confirmLabel: string;
    cancelLabel?: string;
    destructive?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();

  let cancelEl = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    cancelEl?.focus();
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') oncancel();
  }
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="overlay" role="dialog" aria-label={title} onclick={oncancel}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sheet" onclick={(e) => e.stopPropagation()}>
    <h2>{title}</h2>
    {#if body}
      <p>{body}</p>
    {/if}
    <div class="actions">
      <button class="ghost" bind:this={cancelEl} onclick={oncancel}>{cancelLabel}</button>
      <button class={destructive ? '' : 'ghost'} onclick={onconfirm}>{confirmLabel}</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgb(6 16 12 / 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 10;
  }
  .sheet {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 24px;
    box-shadow: 0 20px 50px rgb(0 0 0 / 0.5);
    text-align: center;
    min-width: 260px;
    max-width: 320px;
  }
  h2 {
    margin: 0 0 10px;
    font-family: var(--display);
    font-size: 1.2rem;
    font-weight: 600;
  }
  p {
    margin: 0 0 20px;
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 12px;
    justify-content: center;
  }
  .actions button {
    min-height: 48px;
    min-width: 110px;
  }
</style>
