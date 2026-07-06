<script lang="ts">
  import type { Color } from '../../engine/types';
  import { COLORS } from '../../engine/deck';

  let { onpick }: { onpick: (color: Color) => void } = $props();
</script>

<div class="overlay" role="dialog" aria-label="Pick a color">
  <p>Pick a color</p>
  <div class="swatches">
    {#each COLORS as color (color)}
      <button class={color} onclick={() => onpick(color)} aria-label={color}></button>
    {/each}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.6);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    z-index: 10;
  }
  .swatches { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .swatches button { width: 72px; height: 72px; border-radius: 16px; }
  .red { background: var(--card-red); }
  .yellow { background: var(--card-yellow); }
  .green { background: var(--card-green); }
  .blue { background: var(--card-blue); }
</style>
