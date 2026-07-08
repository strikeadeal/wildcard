/**
 * Motion helpers shared across the table. The reduced-motion check lives here
 * (once) because Svelte JS transitions, WAAPI animations, and canvas effects
 * are NOT caught by the CSS `prefers-reduced-motion` kill-switch in app.css.
 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A tiny registry of on-screen anchor elements (draw pile, seats) so imperative
 * fx can measure positions without prop-drilling refs across the tree.
 */
const anchors = new Map<string, HTMLElement>();

export function setAnchor(key: string, el: HTMLElement): void {
  anchors.set(key, el);
}
export function clearAnchor(key: string): void {
  anchors.delete(key);
}
export function getAnchorRect(key: string): DOMRect | null {
  const el = anchors.get(key);
  return el ? el.getBoundingClientRect() : null;
}

/** Svelte action: `use:anchor={'deck'}` registers this element under a key. */
export function anchor(node: HTMLElement, key: string) {
  setAnchor(key, node);
  return {
    update(nextKey: string) {
      clearAnchor(key);
      key = nextKey;
      setAnchor(key, node);
    },
    destroy() {
      clearAnchor(key);
    }
  };
}

/**
 * Fly a transient element from one on-screen rect to another, then remove it.
 * Used for the opponent-draw ghost card. No-ops under reduced motion.
 */
export function flyGhost(opts: {
  fromRect: DOMRect;
  toRect: DOMRect;
  duration?: number;
  build: () => HTMLElement;
}): void {
  if (prefersReducedMotion()) return;
  const { fromRect, toRect, duration = 420, build } = opts;
  const el = build();
  Object.assign(el.style, {
    position: 'fixed', left: '0', top: '0', margin: '0',
    pointerEvents: 'none', zIndex: '30', willChange: 'transform'
  } as CSSStyleDeclaration);
  document.body.appendChild(el);

  const cx = (r: DOMRect) => r.left + r.width / 2;
  const cy = (r: DOMRect) => r.top + r.height / 2;
  const anim = el.animate(
    [
      { transform: `translate(${cx(fromRect)}px, ${cy(fromRect)}px) translate(-50%, -50%) scale(1)`, opacity: 1 },
      { transform: `translate(${cx(toRect)}px, ${cy(toRect)}px) translate(-50%, -50%) scale(0.5)`, opacity: 0.15 }
    ],
    { duration, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' }
  );
  anim.onfinish = () => el.remove();
  anim.oncancel = () => el.remove();
}
