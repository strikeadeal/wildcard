<script lang="ts">
  import { session } from '../session.svelte';
  import { fatalContent, type FatalAction } from '../fatal-state';

  const content = $derived(
    session.fatal ? fatalContent(session.fatal.reason, session.fatal.code) : null
  );

  const ACTION_LABEL: Record<FatalAction, string> = {
    retry: 'Try again',
    create: 'Create a new room',
    refresh: 'Refresh',
    home: 'Back to start'
  };

  function runAction(action: FatalAction): void {
    switch (action) {
      case 'refresh': location.reload(); break;
      case 'retry': session.retryLastJoin(); break;
      case 'create': session.createFromSavedName(); break;
      case 'home': session.clearFatalToHome(); break;
    }
  }
</script>

<main>
  <div class="mark" aria-hidden="true">!</div>
  <h2>{content?.title}</h2>
  <p>{content?.detail}</p>
  {#each content?.actions ?? [] as action, i (action)}
    <button class={i === 0 ? 'primary' : 'ghost'} onclick={() => runAction(action)}>
      {ACTION_LABEL[action]}
    </button>
  {/each}
</main>

<style>
  main {
    max-width: 420px;
    margin: 0 auto;
    padding:
      calc(48px + var(--safe-top))
      calc(24px + var(--safe-right))
      calc(48px + var(--safe-bottom))
      calc(24px + var(--safe-left));
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    text-align: center;
  }
  .mark {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-family: var(--display);
    font-weight: 700;
    font-size: 1.8rem;
    color: var(--card-yellow);
    border: 2px solid var(--card-yellow);
    margin-bottom: 4px;
  }
  h2 { font-size: 1.7rem; }
  p { color: var(--muted); margin: 0; line-height: 1.5; }
  .primary { background: var(--btn-green); }
</style>
