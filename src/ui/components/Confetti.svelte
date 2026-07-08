<script lang="ts">
  import { prefersReducedMotion } from '../motion';

  let { nonce = 0 }: { nonce?: number } = $props();
  let canvas = $state<HTMLCanvasElement | null>(null);
  let lastNonce = $state(0);

  const COLORS = ['#e6b84b', '#e0443a', '#f5c542', '#37b06b', '#3f86e0'];

  $effect(() => {
    if (nonce === lastNonce || !canvas || prefersReducedMotion()) return;
    lastNonce = nonce;
    burst(canvas);
  });

  function burst(cv: HTMLCanvasElement) {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = (cv.width = innerWidth);
    const H = (cv.height = innerHeight);
    const parts = Array.from({ length: 90 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H * 0.35,
      vx: (Math.random() - 0.5) * 9,
      vy: -7 - Math.random() * 6,
      r: 3 + Math.random() * 4,
      c: COLORS[(Math.random() * COLORS.length) | 0]!,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3
    }));
    const start = performance.now();
    const DUR = 1400;
    function frame(now: number) {
      const t = now - start;
      ctx!.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.28;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx!.save();
        ctx!.translate(p.x, p.y); ctx!.rotate(p.rot);
        ctx!.globalAlpha = Math.max(0, 1 - t / DUR);
        ctx!.fillStyle = p.c;
        ctx!.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2);
        ctx!.restore();
      }
      if (t < DUR) requestAnimationFrame(frame);
      else ctx!.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }
</script>

<canvas bind:this={canvas} aria-hidden="true"></canvas>

<style>
  canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 15; }
</style>
