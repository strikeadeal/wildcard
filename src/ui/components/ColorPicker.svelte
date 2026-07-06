<script lang="ts">
  import type { Color } from '../../engine/types';
  import { COLORS } from '../../engine/deck';

  let { onpick }: { onpick: (color: Color) => void } = $props();
</script>

<div class="overlay" role="dialog" aria-label="Pick a color">
  <div class="sheet">
    <p>Pick a color</p>
    <div class="swatches">
      {#each COLORS as color (color)}
        <button class={color} onclick={() => onpick(color)} aria-label={color}>
          <span class="ring"></span>
        </button>
      {/each}
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
  }
  .sheet p { margin: 0 0 16px; font-family: var(--display); font-size: 1.2rem; font-weight: 600; }
  .swatches { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .swatches button {
    width: 80px;
    height: 80px;
    border-radius: 18px;
    padding: 0;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.35);
    display: grid;
    place-items: center;
  }
  .ring { width: 34px; height: 34px; border-radius: 50%; border: 3px solid rgb(255 255 255 / 0.6); }
  .red { background: var(--card-red); }
  .yellow { background: var(--card-yellow); }
  .green { background: var(--card-green); }
  .blue { background: var(--card-blue); }
</style>
