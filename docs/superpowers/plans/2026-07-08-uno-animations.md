# UNO Animation Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add restrained, professional motion to three UNO moments — drawing cards, playing special cards, and calling UNO / winning a round — with zero new dependencies.

**Architecture:** The client has no event stream, so all animation triggers are derived by diffing consecutive `PlayerView`s in one pure function (`src/ui/events.ts`, generalizing the existing `deriveAnnouncement`). The session exposes the derived event as a reactive `fxEvent`. Declarative fx (card deal-in, special-card beats, count pulse, round-end entrance) live in the components; imperative/spawned fx (opponent draw ghost, UNO pop, confetti) are owned by one `AnimationLayer` overlay that reads on-screen positions from a small anchor registry in `src/ui/motion.ts`.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, Vitest (unit), Playwright (e2e). Motion via CSS keyframes + `svelte/transition` + `svelte/animate` + `svelte/motion` + the Web Animations API + a hand-rolled `<canvas>`.

## Global Constraints

- **Zero new dependencies.** Only CSS, Svelte built-ins, WAAPI, and canvas. Do not add any npm package.
- **Restrained & elegant tone.** House easing `cubic-bezier(0.2, 0.8, 0.3, 1)`; tokens `--brass`, `--card-*`, `--display`, `--shadow-card` from `src/app.css`. No arcade bounce.
- **Reduced-motion contract.** CSS keyframes/transitions are neutralized by the existing kill-switch in `src/app.css:107`. Every JS transition, WAAPI animation, `tweened`/canvas effect MUST gate on `prefersReducedMotion()` (Task 2). Never rely on the CSS kill-switch for JS/WAAPI/canvas.
- **Component tests:** the repo has no Svelte component-unit harness and adding one violates the zero-dep rule. Pure logic (`events.ts`, the anchor registry) is unit-tested with Vitest (TDD). Component/visual tasks are verified by `npm run check` (svelte-check), `npm run e2e` (existing full-round spec must stay green), and explicit manual steps.
- **Branch:** work stays on `feat/card-animations-event-banners`. Commit after every task.

---

### Task 1: View-diff deriver (`events.ts`) — pure, TDD

Generalize `deriveAnnouncement` into `deriveViewChange`, returning the existing banner plus a structured animation event. This is the single source of truth for every animation trigger.

**Files:**
- Create: `src/ui/events.ts`
- Create: `tests/ui/events.test.ts`
- Delete: `src/ui/announce.ts`, `tests/ui/announce.test.ts`

**Interfaces:**
- Consumes: `PlayerView`, `Card` from `src/engine/types`.
- Produces:
  - `type GameEvent = { kind:'draw'; playerId:string; n:number; toSelf:boolean } | { kind:'special'; card:Card } | { kind:'uno'; playerId:string; isYou:boolean } | { kind:'win'; winnerId:string; isYou:boolean }`
  - `interface ViewChange { banner: string | null; fromSelf: boolean; event: GameEvent | null }`
  - `function deriveViewChange(prev: PlayerView | null, next: PlayerView): ViewChange`

- [ ] **Step 1: Write the failing test** — create `tests/ui/events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveViewChange } from '../../src/ui/events';
import type { Card, PlayerView } from '../../src/engine/types';
import { C } from '../engine/fixtures';

/** Minimal PlayerView builder; `you` is 'p0', opponents 'p1'/'p2'. */
function view(over: Partial<PlayerView> = {}): PlayerView {
  return {
    you: { id: 'p0', name: 'Ada', hand: [], saidUno: false, score: 0 },
    players: [
      { id: 'p0', name: 'Ada', cardCount: 5, saidUno: false, connected: true, score: 0 },
      { id: 'p1', name: 'Bob', cardCount: 5, saidUno: false, connected: true, score: 0 },
      { id: 'p2', name: 'Cyd', cardCount: 5, saidUno: false, connected: true, score: 0 }
    ],
    discardTop: C('red', '5'),
    currentColor: 'red',
    deckCount: 80,
    turnPlayerId: 'p0',
    direction: 1,
    phase: 'play',
    pendingDraw: 0,
    config: { stacking: false, jumpIn: false, drawUntilPlayable: false, sevenZero: false },
    roundWinner: null,
    playableCardIds: [],
    canDraw: true,
    canPass: false,
    canChallenge: false,
    canCallUno: false,
    catchableIds: [],
    mustChooseColor: false,
    mustChooseSwapTarget: false,
    ...over
  };
}

describe('deriveViewChange — banner (unchanged behaviour)', () => {
  it('says nothing on the first view (no prior state)', () => {
    const r = deriveViewChange(null, view());
    expect(r.banner).toBeNull();
    expect(r.fromSelf).toBe(false);
  });

  it('says nothing for a normal coloured play', () => {
    const prev = view({ discardTop: C('red', '5'), currentColor: 'red' });
    const next = view({ discardTop: C('green', '3'), currentColor: 'green', turnPlayerId: 'p1' });
    expect(deriveViewChange(prev, next).banner).toBeNull();
  });

  it('announces the colour once a wild colour has settled', () => {
    const prev = view({ discardTop: C('blue', '2'), currentColor: 'blue', turnPlayerId: 'p0' });
    const next = view({ discardTop: C(null, 'wild'), currentColor: 'green', phase: 'play', turnPlayerId: 'p1' });
    expect(deriveViewChange(prev, next).banner).toBe('Colour is now GREEN');
  });

  it('stays silent while the wild is still in the choose-colour phase', () => {
    const prev = view({ discardTop: C('blue', '2'), currentColor: 'blue' });
    const next = view({ discardTop: C(null, 'wild'), currentColor: 'blue', phase: 'chooseColor' });
    expect(deriveViewChange(prev, next).banner).toBeNull();
  });

  it('names the victim when a +2 is played', () => {
    const prev = view({ pendingDraw: 0, discardTop: C('red', '5'), turnPlayerId: 'p0' });
    const next = view({ pendingDraw: 2, discardTop: C('red', 'draw2'), turnPlayerId: 'p1' });
    expect(deriveViewChange(prev, next).banner).toBe('Bob draws +2');
  });

  it('uses second person when the penalty falls on you', () => {
    const prev = view({ pendingDraw: 0, turnPlayerId: 'p1' });
    const next = view({ pendingDraw: 4, discardTop: C(null, 'wild4'), turnPlayerId: 'p0' });
    expect(deriveViewChange(prev, next).banner).toBe('You draw +4');
  });

  it('re-announces each increment when penalties stack', () => {
    const prev = view({ pendingDraw: 2, turnPlayerId: 'p1' });
    const next = view({ pendingDraw: 4, discardTop: C('blue', 'draw2'), turnPlayerId: 'p2' });
    expect(deriveViewChange(prev, next).banner).toBe('Cyd draws +2');
  });

  it('reports fromSelf when the local player played', () => {
    const prev = view({ discardTop: C('red', '5'), turnPlayerId: 'p0' });
    const next = view({ discardTop: C('red', '7'), turnPlayerId: 'p1' });
    expect(deriveViewChange(prev, next).fromSelf).toBe(true);
  });

  it('does not flag fromSelf when the discard did not change', () => {
    const top: Card = C('red', '5');
    const prev = view({ discardTop: top, turnPlayerId: 'p0' });
    const next = view({ discardTop: top, turnPlayerId: 'p0', deckCount: 79 });
    expect(deriveViewChange(prev, next).fromSelf).toBe(false);
  });
});

describe('deriveViewChange — animation events', () => {
  it('emits a draw event when an opponent gains cards mid-game', () => {
    const prev = view({ turnPlayerId: 'p1' });
    const next = view({
      turnPlayerId: 'p2',
      players: [
        { id: 'p0', name: 'Ada', cardCount: 5, saidUno: false, connected: true, score: 0 },
        { id: 'p1', name: 'Bob', cardCount: 7, saidUno: false, connected: true, score: 0 },
        { id: 'p2', name: 'Cyd', cardCount: 5, saidUno: false, connected: true, score: 0 }
      ]
    });
    expect(deriveViewChange(prev, next).event).toEqual({ kind: 'draw', playerId: 'p1', n: 2, toSelf: false });
  });

  it('flags toSelf when YOU draw', () => {
    const prev = view();
    const next = view({
      players: [
        { id: 'p0', name: 'Ada', cardCount: 6, saidUno: false, connected: true, score: 0 },
        { id: 'p1', name: 'Bob', cardCount: 5, saidUno: false, connected: true, score: 0 },
        { id: 'p2', name: 'Cyd', cardCount: 5, saidUno: false, connected: true, score: 0 }
      ]
    });
    expect(deriveViewChange(prev, next).event).toEqual({ kind: 'draw', playerId: 'p0', n: 1, toSelf: true });
  });

  it('suppresses the draw event on a fresh deal (prev round just ended)', () => {
    const prev = view({ phase: 'roundEnd' });
    const next = view({
      players: [
        { id: 'p0', name: 'Ada', cardCount: 7, saidUno: false, connected: true, score: 0 },
        { id: 'p1', name: 'Bob', cardCount: 7, saidUno: false, connected: true, score: 0 },
        { id: 'p2', name: 'Cyd', cardCount: 7, saidUno: false, connected: true, score: 0 }
      ]
    });
    expect(deriveViewChange(prev, next).event).toBeNull();
  });

  it('emits a special event when the discard becomes a skip', () => {
    const prev = view({ discardTop: C('red', '5') });
    const skip = C('red', 'skip');
    const next = view({ discardTop: skip, turnPlayerId: 'p1' });
    expect(deriveViewChange(prev, next).event).toEqual({ kind: 'special', card: skip });
  });

  it('emits a uno event when a player calls last-card at one card', () => {
    const prev = view({
      players: [
        { id: 'p0', name: 'Ada', cardCount: 5, saidUno: false, connected: true, score: 0 },
        { id: 'p1', name: 'Bob', cardCount: 1, saidUno: false, connected: true, score: 0 },
        { id: 'p2', name: 'Cyd', cardCount: 5, saidUno: false, connected: true, score: 0 }
      ]
    });
    const next = view({
      players: [
        { id: 'p0', name: 'Ada', cardCount: 5, saidUno: false, connected: true, score: 0 },
        { id: 'p1', name: 'Bob', cardCount: 1, saidUno: true, connected: true, score: 0 },
        { id: 'p2', name: 'Cyd', cardCount: 5, saidUno: false, connected: true, score: 0 }
      ]
    });
    expect(deriveViewChange(prev, next).event).toEqual({ kind: 'uno', playerId: 'p1', isYou: false });
  });

  it('emits a win event when the round ends, outranking a special final card', () => {
    const prev = view({ phase: 'play', discardTop: C('red', '5') });
    const next = view({ phase: 'roundEnd', roundWinner: 'p0', discardTop: C('red', 'skip') });
    expect(deriveViewChange(prev, next).event).toEqual({ kind: 'win', winnerId: 'p0', isYou: true });
  });

  it('emits no event for an ordinary coloured play', () => {
    const prev = view({ discardTop: C('red', '5'), turnPlayerId: 'p0' });
    const next = view({ discardTop: C('red', '7'), turnPlayerId: 'p1' });
    expect(deriveViewChange(prev, next).event).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- events`
Expected: FAIL — cannot resolve `../../src/ui/events`.

- [ ] **Step 3: Write minimal implementation** — create `src/ui/events.ts`:

```ts
import type { Card, PlayerView } from '../engine/types';

/**
 * The client sees only before/after PlayerView snapshots — there is no event
 * stream — so both game announcements and animation triggers are derived by
 * diffing consecutive views. This pure function is that single diff pass, kept
 * out of Svelte so it can be unit-tested.
 */
export type GameEvent =
  | { kind: 'draw'; playerId: string; n: number; toSelf: boolean }
  | { kind: 'special'; card: Card }
  | { kind: 'uno'; playerId: string; isYou: boolean }
  | { kind: 'win'; winnerId: string; isYou: boolean };

export interface ViewChange {
  /** Message to surface in the banner, or null when nothing notable happened. */
  banner: string | null;
  /** Whether the local player made the most recent play (drives fly direction). */
  fromSelf: boolean;
  /** The single most salient animation trigger for this transition, if any. */
  event: GameEvent | null;
}

const SPECIAL = new Set<string>(['skip', 'reverse', 'draw2', 'wild4']);

/** A fresh 7-card deal only follows round-end (or the very first view). */
function isDeal(prev: PlayerView | null): boolean {
  return prev === null || prev.phase === 'roundEnd';
}

/** Banner text + fly direction — logic preserved verbatim from deriveAnnouncement. */
function deriveBanner(prev: PlayerView | null, next: PlayerView): { banner: string | null; fromSelf: boolean } {
  if (!prev || !prev.discardTop || !next.discardTop) return { banner: null, fromSelf: false };

  const discardChanged = next.discardTop.id !== prev.discardTop.id;
  const fromSelf = discardChanged && prev.turnPlayerId === next.you.id;

  if (next.pendingDraw > prev.pendingDraw) {
    const delta = next.pendingDraw - prev.pendingDraw;
    const isYou = next.turnPlayerId === next.you.id;
    const name = isYou
      ? 'You'
      : next.players.find((p) => p.id === next.turnPlayerId)?.name ?? 'Next player';
    const verb = isYou ? 'draw' : 'draws';
    return { banner: `${name} ${verb} +${delta}`, fromSelf };
  }

  if (discardChanged && next.discardTop.color === null && next.phase !== 'chooseColor') {
    return { banner: `Colour is now ${next.currentColor.toUpperCase()}`, fromSelf };
  }

  return { banner: null, fromSelf };
}

/** At most one animation event per transition, most-salient first. */
function deriveEvent(prev: PlayerView | null, next: PlayerView): GameEvent | null {
  // Win outranks everything — even a special final card ends the round.
  if (next.phase === 'roundEnd' && prev?.phase !== 'roundEnd' && next.roundWinner) {
    return { kind: 'win', winnerId: next.roundWinner, isYou: next.roundWinner === next.you.id };
  }

  if (!prev) return null;

  // Special card: the discard top just became a skip / reverse / +2 / +4.
  const discardChanged = !!next.discardTop && next.discardTop.id !== prev.discardTop?.id;
  if (discardChanged && next.discardTop && SPECIAL.has(next.discardTop.value)) {
    return { kind: 'special', card: next.discardTop };
  }

  // Draw: a player's hand grew, and it is not a fresh deal.
  if (!isDeal(prev)) {
    for (const p of next.players) {
      const before = prev.players.find((q) => q.id === p.id);
      if (before && p.cardCount > before.cardCount) {
        return { kind: 'draw', playerId: p.id, n: p.cardCount - before.cardCount, toSelf: p.id === next.you.id };
      }
    }
  }

  // UNO: a player just called "last card" while holding one.
  for (const p of next.players) {
    const before = prev.players.find((q) => q.id === p.id);
    if (before && !before.saidUno && p.saidUno && p.cardCount === 1) {
      return { kind: 'uno', playerId: p.id, isYou: p.id === next.you.id };
    }
  }

  return null;
}

export function deriveViewChange(prev: PlayerView | null, next: PlayerView): ViewChange {
  const { banner, fromSelf } = deriveBanner(prev, next);
  return { banner, fromSelf, event: deriveEvent(prev, next) };
}
```

- [ ] **Step 4: Delete the old files**

```bash
git rm src/ui/announce.ts tests/ui/announce.test.ts
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- events`
Expected: PASS (all banner + event cases).

- [ ] **Step 6: Commit**

```bash
git add src/ui/events.ts tests/ui/events.test.ts
git commit -m "feat(ui): derive structured animation events from view diffs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Shared motion utilities (`motion.ts`) + dedupe reduced-motion

Central home for the reduced-motion check (currently duplicated), the anchor registry, a Svelte action to register anchors, and the ghost-fly helper.

**Files:**
- Create: `src/ui/motion.ts`
- Create: `tests/ui/motion.test.ts`
- Modify: `src/ui/components/Announce.svelte` (import shared `prefersReducedMotion`)
- Modify: `src/ui/screens/Table.svelte` (import shared `prefersReducedMotion`)

**Interfaces:**
- Produces:
  - `function prefersReducedMotion(): boolean`
  - `function setAnchor(key: string, el: HTMLElement): void`
  - `function clearAnchor(key: string): void`
  - `function getAnchorRect(key: string): DOMRect | null`
  - `function anchor(node: HTMLElement, key: string): { update(k: string): void; destroy(): void }` — Svelte action
  - `function flyGhost(opts: { fromRect: DOMRect; toRect: DOMRect; duration?: number; build: () => HTMLElement }): void`

- [ ] **Step 1: Write the failing test** — create `tests/ui/motion.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setAnchor, clearAnchor, getAnchorRect, prefersReducedMotion } from '../../src/ui/motion';

function fakeEl(rect: Partial<DOMRect>): HTMLElement {
  return { getBoundingClientRect: () => rect as DOMRect } as unknown as HTMLElement;
}

describe('anchor registry', () => {
  beforeEach(() => { clearAnchor('deck'); });

  it('returns null for an unregistered key', () => {
    expect(getAnchorRect('deck')).toBeNull();
  });

  it('returns the element rect once registered', () => {
    setAnchor('deck', fakeEl({ left: 10, top: 20, width: 30, height: 40 }));
    expect(getAnchorRect('deck')).toMatchObject({ left: 10, top: 20, width: 30, height: 40 });
  });

  it('returns null after the anchor is cleared', () => {
    setAnchor('deck', fakeEl({ left: 1 }));
    clearAnchor('deck');
    expect(getAnchorRect('deck')).toBeNull();
  });
});

describe('prefersReducedMotion', () => {
  it('is false when matchMedia is unavailable (node/test env)', () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- motion`
Expected: FAIL — cannot resolve `../../src/ui/motion`.

- [ ] **Step 3: Write the implementation** — create `src/ui/motion.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- motion`
Expected: PASS.

- [ ] **Step 5: Dedupe the reduced-motion check in `Announce.svelte`**

In `src/ui/components/Announce.svelte`, replace the inline guard:

```svelte
  import { fly, fade } from 'svelte/transition';

  // Svelte JS transitions aren't caught by the CSS reduced-motion kill-switch,
  // so gate their durations here (same pattern as Table.svelte).
  const reduce = typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
```

with:

```svelte
  import { fly, fade } from 'svelte/transition';
  import { prefersReducedMotion } from '../motion';

  // Svelte JS transitions aren't caught by the CSS reduced-motion kill-switch.
  const reduce = prefersReducedMotion();
```

- [ ] **Step 6: Dedupe the reduced-motion check in `Table.svelte`**

In `src/ui/screens/Table.svelte`, replace lines 29–33:

```svelte
  // FLIP (Web Animations API) isn't caught by the CSS reduced-motion
  // kill-switch, so gate its duration here too.
  const reduce = typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flipDur = reduce ? 0 : 220;
```

with:

```svelte
  // FLIP / JS transitions aren't caught by the CSS reduced-motion kill-switch.
  const reduce = prefersReducedMotion();
  const flipDur = reduce ? 0 : 220;
```

and add to the existing import block near the top of the `<script>`:

```svelte
  import { prefersReducedMotion } from '../motion';
```

- [ ] **Step 7: Verify type-check and tests still pass**

Run: `npm run check && npm test`
Expected: no errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/ui/motion.ts tests/ui/motion.test.ts src/ui/components/Announce.svelte src/ui/screens/Table.svelte
git commit -m "feat(ui): shared motion helpers — reduced-motion, anchors, flyGhost

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Session wiring — expose `fxEvent`

Route the derived event into a reactive trigger the DOM layer watches.

**Files:**
- Modify: `src/ui/session.svelte.ts`

**Interfaces:**
- Consumes: `deriveViewChange`, `GameEvent` from Task 1.
- Produces: `session.fxEvent: (GameEvent & { nonce: number }) | null` — a fresh object (new nonce) per event so repeated identical events refire.

- [ ] **Step 1: Update the import** — in `src/ui/session.svelte.ts`, replace line 2:

```ts
import { deriveAnnouncement } from './announce';
```

with:

```ts
import { deriveViewChange, type GameEvent } from './events';
```

- [ ] **Step 2: Add the reactive field** — after line 45 (`lastPlayFromSelf = $state(false);`), add:

```ts
  /** Latest animation trigger (draw/special/uno/win); nonce bumps on every event. */
  fxEvent = $state<(GameEvent & { nonce: number }) | null>(null);
```

and add a private counter alongside the other private fields (near line 58):

```ts
  private fxNonce = 0;
```

- [ ] **Step 3: Emit the event in `handleView`** — replace the body of `handleView` (lines 95–101):

```ts
  private handleView(view: PlayerView): void {
    const { banner, fromSelf } = deriveAnnouncement(this.view, view);
    this.lastPlayFromSelf = fromSelf;
    if (banner) this.showBanner(banner);
    this.view = view;
    this.screen = 'game';
  }
```

with:

```ts
  private handleView(view: PlayerView): void {
    const { banner, fromSelf, event } = deriveViewChange(this.view, view);
    this.lastPlayFromSelf = fromSelf;
    if (banner) this.showBanner(banner);
    if (event) this.fxEvent = { ...event, nonce: ++this.fxNonce };
    this.view = view;
    this.screen = 'game';
  }
```

- [ ] **Step 4: Clear it on leave** — in `leave()`, after `this.banner = null;` (line 243) add:

```ts
    this.fxEvent = null;
```

- [ ] **Step 5: Verify type-check and tests**

Run: `npm run check && npm test`
Expected: no errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui/session.svelte.ts
git commit -m "feat(ui): expose fxEvent animation trigger on the session

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Drawing — cards deal in from the deck (`dealIn`)

Replace the hand's generic fly-in with a transition that originates at the draw pile, so single draws and full deals both read as cards coming off the deck.

**Files:**
- Modify: `src/ui/screens/Table.svelte`

**Interfaces:**
- Consumes: `anchor`, `getAnchorRect`, `prefersReducedMotion` from `motion.ts`; `cubicOut` from `svelte/easing`.

- [ ] **Step 1: Register the deck anchor** — in `src/ui/screens/Table.svelte`, change the draw-pile stack element (line 89) from:

```svelte
          <div class="stack">
```

to:

```svelte
          <div class="stack" use:anchor={'deck'}>
```

and extend the motion import from Task 2 to:

```svelte
  import { prefersReducedMotion, anchor, getAnchorRect } from '../motion';
  import { cubicOut } from 'svelte/easing';
```

- [ ] **Step 2: Add the `dealIn` transition** — in the `<script>`, after the `land` function (ends line 44) add:

```svelte
  // A newly-held card flies from the draw pile into its slot, then the FLIP
  // reflow settles the hand. Falls back to a short lift if the deck isn't
  // measured yet (e.g. very first paint).
  function dealIn(node: Element) {
    const deck = getAnchorRect('deck');
    const rect = node.getBoundingClientRect();
    const dx = deck ? deck.left + deck.width / 2 - (rect.left + rect.width / 2) : 0;
    const dy = deck ? deck.top + deck.height / 2 - (rect.top + rect.height / 2) : -46;
    return {
      duration: reduce ? 0 : 320,
      easing: cubicOut,
      css: (t: number, u: number) =>
        `transform: translate(${u * dx}px, ${u * dy}px) scale(${0.6 + t * 0.4}); opacity: ${t}`
    };
  }
```

- [ ] **Step 3: Use it on hand cards** — change the handcard wrapper (lines 139–143) from:

```svelte
        <div
          class="handcard"
          animate:flip={{ duration: flipDur }}
          in:fly={{ y: reduce ? 0 : -46, duration: flipDur }}
        >
```

to:

```svelte
        <div
          class="handcard"
          animate:flip={{ duration: flipDur }}
          in:dealIn
        >
```

- [ ] **Step 4: Drop the now-unused `fly` import** — change line 4 from:

```svelte
  import { fly } from 'svelte/transition';
```

to (remove the line entirely, since `land` is a hand-rolled transition and `fly` is no longer used).

- [ ] **Step 5: Verify type-check**

Run: `npm run check`
Expected: no errors (in particular, no "fly is declared but never used").

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open the app, create a room and start a solo/two-tab game. Draw a card. Expected: the new card visibly flies from the draw pile into your hand and the hand reflows. With OS "Reduce Motion" on, the card appears instantly.

- [ ] **Step 7: Commit**

```bash
git add src/ui/screens/Table.svelte
git commit -m "feat(ui): deal drawn cards in from the draw pile

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Drawing — opponent ghost card + seat count pulse

When an opponent draws, fly a ghost card-back from the deck to their seat and pulse their count. Introduces the `AnimationLayer` overlay that owns all spawned fx.

**Files:**
- Create: `src/ui/components/AnimationLayer.svelte`
- Modify: `src/ui/components/OpponentSeat.svelte`
- Modify: `src/ui/screens/Table.svelte`

**Interfaces:**
- Consumes: `session.fxEvent` (Task 3), `getAnchorRect`, `flyGhost`, `prefersReducedMotion`, `anchor` (Task 2).
- `OpponentSeat` gains prop `drewNonce?: number` — nonzero + changed value ⇒ pulse this seat's count once.

- [ ] **Step 1: Create the AnimationLayer** — create `src/ui/components/AnimationLayer.svelte`:

```svelte
<script lang="ts">
  import { session } from '../session.svelte';
  import { getAnchorRect, flyGhost, prefersReducedMotion } from '../motion';

  // One overlay owns every spawned/imperative effect. Declarative fx (deal-in,
  // special-card beats, count pulse) live in their own components.
  let lastNonce = $state(-1);

  $effect(() => {
    const fx = session.fxEvent;
    if (!fx || fx.nonce === lastNonce) return;
    lastNonce = fx.nonce;
    if (prefersReducedMotion()) return;
    if (fx.kind === 'draw' && !fx.toSelf) ghostDraw(fx.playerId);
  });

  function buildBack(w: number, h: number): HTMLElement {
    const d = document.createElement('div');
    d.className = 'fx-cardback';
    d.style.width = `${w}px`;
    d.style.height = `${h}px`;
    return d;
  }

  function ghostDraw(playerId: string) {
    const from = getAnchorRect('deck');
    const to = getAnchorRect('seat:' + playerId);
    if (!from || !to) return;
    flyGhost({ fromRect: from, toRect: to, build: () => buildBack(from.width, from.height) });
  }
</script>

<div class="fx-layer" aria-hidden="true"></div>

<style>
  .fx-layer { position: fixed; inset: 0; pointer-events: none; z-index: 12; }

  /* The ghost card-back is appended to <body>, so its style must be global. */
  :global(.fx-cardback) {
    border-radius: 8px;
    background:
      radial-gradient(120% 120% at 50% 40%, #234a3a 0%, #16342700 60%),
      repeating-linear-gradient(45deg, #14332680 0 6px, #1c3f30 6px 12px), #163a2c;
    box-shadow: 0 6px 16px rgb(0 0 0 / 0.5);
  }
</style>
```

- [ ] **Step 2: Add the pulse prop to `OpponentSeat`** — in `src/ui/components/OpponentSeat.svelte`, change the props block (lines 4–9) to add `drewNonce`:

```svelte
  let { player, isTurn, catchable, oncatch, drewNonce = 0 }: {
    player: OpponentView;
    isTurn: boolean;
    catchable: boolean;
    oncatch: () => void;
    drewNonce?: number;
  } = $props();

  import { anchor } from '../motion';
```

(Place the `import` at the top of the `<script>` with the existing import, not mid-block — shown together here for context.)

- [ ] **Step 3: Register the seat anchor and pulse the count** — change the seat markup (lines 12–20) from:

```svelte
<div class="seat" class:turn={isTurn} class:off={!player.connected}>
  <span class="name">{player.name}</span>
  <span class="count" aria-label="{player.cardCount} cards">
    <svg class="mini" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="6" y="3.5" width="9" height="13" rx="2" fill="#f7f2e6" transform="rotate(9 10 10)" />
      <rect x="4" y="3" width="9" height="13" rx="2" fill="#f7f2e6" stroke="var(--line)" />
    </svg>
    {player.cardCount}
  </span>
```

to:

```svelte
<div class="seat" class:turn={isTurn} class:off={!player.connected} use:anchor={'seat:' + player.id}>
  <span class="name">{player.name}</span>
  {#key drewNonce}
    <span class="count" class:pop={drewNonce > 0} aria-label="{player.cardCount} cards">
      <svg class="mini" viewBox="0 0 20 20" aria-hidden="true">
        <rect x="6" y="3.5" width="9" height="13" rx="2" fill="#f7f2e6" transform="rotate(9 10 10)" />
        <rect x="4" y="3" width="9" height="13" rx="2" fill="#f7f2e6" stroke="var(--line)" />
      </svg>
      {player.cardCount}
    </span>
  {/key}
```

- [ ] **Step 4: Add the pulse keyframe** — in the `OpponentSeat.svelte` `<style>`, append:

```css
  .pop { animation: countpop 360ms cubic-bezier(0.2, 0.8, 0.3, 1); }
  @keyframes countpop {
    0% { transform: scale(1); }
    45% { transform: scale(1.35); color: var(--brass); }
    100% { transform: scale(1); }
  }
```

- [ ] **Step 5: Wire Table → seats and mount the layer** — in `src/ui/screens/Table.svelte` `<script>`, add after the `others` derived (around line 19):

```svelte
  const drawFx = $derived(session.fxEvent?.kind === 'draw' ? session.fxEvent : null);
```

Change the opponents loop (lines 75–82) to pass the per-seat nonce:

```svelte
      {#each others as p (p.id)}
        <OpponentSeat
          player={p}
          isTurn={view.turnPlayerId === p.id}
          catchable={view.catchableIds.includes(p.id)}
          drewNonce={drawFx && drawFx.playerId === p.id ? drawFx.nonce : 0}
          oncatch={() => session.sendAction({ type: 'catchUno', targetId: p.id })}
        />
      {/each}
```

Add the import near the other component imports (after line 10):

```svelte
  import AnimationLayer from '../components/AnimationLayer.svelte';
```

and mount it once — add just before the final `{/if}` that closes the `{#if view}` block (after the RoundEnd block, line 165):

```svelte
  <AnimationLayer />
```

- [ ] **Step 6: Verify type-check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, two browser tabs, start a 2-player game. Have the opponent draw. Expected: a ghost card-back flies from the deck to their seat, and their count pips to brass and back. Reduce-motion on: no ghost, no pulse, count updates instantly.

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/AnimationLayer.svelte src/ui/components/OpponentSeat.svelte src/ui/screens/Table.svelte
git commit -m "feat(ui): opponent draw flies a ghost card and pulses their count

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Special-card punch (skip stamp, reverse spin, penalty pop)

Short CSS beats when a special card lands. All keyframe-based, so the CSS kill-switch neutralizes them under reduced motion for free.

**Files:**
- Modify: `src/ui/screens/Table.svelte`

**Interfaces:**
- Consumes: `session.fxEvent` (Task 3).

- [ ] **Step 1: Latch per-kind nonces** — in `src/ui/screens/Table.svelte` `<script>`, add after the `drawFx` derived (Task 5):

```svelte
  // Latch the nonce of the last skip / reverse so the beat re-triggers (via
  // {#key}) only when that specific special lands, not on every event.
  let stampNonce = $state(0);
  let spinNonce = $state(0);
  $effect(() => {
    const fx = session.fxEvent;
    if (fx?.kind !== 'special') return;
    if (fx.card.value === 'skip') stampNonce = fx.nonce;
    else if (fx.card.value === 'reverse') spinNonce = fx.nonce;
  });
```

- [ ] **Step 2: Skip stamp over the discard** — change the discard block (lines 96–105) to add the stamp overlay inside `.discard`:

```svelte
        <div class="discard">
          {#key view.discardTop?.id}
            <div class="landed" in:land={{ fromSelf: session.lastPlayFromSelf }}>
              <CardFace card={view.discardTop} />
            </div>
          {/key}
          {#key stampNonce}
            {#if stampNonce > 0}
              <svg class="skip-stamp" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.4" aria-hidden="true">
                <circle cx="12" cy="12" r="8.4" /><line x1="6.2" y1="17.8" x2="17.8" y2="6.2" />
              </svg>
            {/if}
          {/key}
          <span class="colordot {view.currentColor}" aria-label="current color {view.currentColor}">
            {view.currentColor}
          </span>
        </div>
```

- [ ] **Step 3: Reverse spin on the direction glyph** — change the direction span (lines 107–109) to key it on `spinNonce`:

```svelte
        {#key spinNonce}
          <span class="direction" class:spin={spinNonce > 0} aria-label="direction of play">
            {view.direction === 1 ? '↻' : '↺'}
          </span>
        {/key}
```

- [ ] **Step 4: Penalty pill pop on each increment** — change the penalty line (line 93) to re-pop whenever the pending total changes:

```svelte
          {#key view.pendingDraw}
            {#if view.pendingDraw > 0}<strong class="penalty pop">Draw +{view.pendingDraw}</strong>{/if}
          {/key}
```

- [ ] **Step 5: Add the keyframes** — in the `Table.svelte` `<style>`, append:

```css
  .skip-stamp {
    position: absolute;
    top: 50%; left: 50%;
    width: 68%; height: 68%;
    color: var(--card-red);
    transform: translate(-50%, -50%);
    filter: drop-shadow(0 2px 4px rgb(0 0 0 / 0.5));
    pointer-events: none;
    animation: stamp 460ms cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
  }
  @keyframes stamp {
    0% { opacity: 0; transform: translate(-50%, -50%) scale(1.6) rotate(-12deg); }
    35% { opacity: 1; }
    60% { transform: translate(-50%, -50%) scale(1) rotate(0deg); }
    100% { opacity: 0; transform: translate(-50%, -50%) scale(1) rotate(0deg); }
  }

  .direction.spin { animation: revspin 460ms cubic-bezier(0.2, 0.8, 0.3, 1); }
  @keyframes revspin {
    0% { transform: rotate(0deg) scale(1); color: var(--brass); }
    100% { transform: rotate(180deg) scale(1); }
  }

  .penalty.pop { animation: penaltypop 420ms cubic-bezier(0.2, 0.8, 0.3, 1); }
  @keyframes penaltypop {
    0% { transform: scale(0.7); }
    45% { transform: scale(1.18); }
    70% { transform: scale(0.96) translateX(-2px); }
    85% { transform: translateX(2px); }
    100% { transform: scale(1) translateX(0); }
  }
```

Note: `.discard` needs `position: relative` for the absolutely-positioned stamp. It is already a flex column; add `position: relative;` to the existing `.drawpile, .discard` rule (line 221) → `.drawpile, .discard { display: flex; flex-direction: column; align-items: center; gap: 8px; position: relative; }`.

- [ ] **Step 6: Verify type-check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`. Play each special: skip → red stamp thumps over the discard; reverse → the ↻/↺ glyph spins 180°; +2 / +4 → the "Draw +N" pill pops, and re-pops when stacked. Reduce-motion on: cards/pills appear with no beat.

- [ ] **Step 8: Commit**

```bash
git add src/ui/screens/Table.svelte
git commit -m "feat(ui): special-card beats — skip stamp, reverse spin, penalty pop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: UNO call pop

A clean brass "UNO!" wordmark pops near whoever called last-card.

**Files:**
- Modify: `src/ui/components/AnimationLayer.svelte`

**Interfaces:**
- Consumes: `session.fxEvent` uno variant, `getAnchorRect`.

- [ ] **Step 1: Handle the uno event** — in `src/ui/components/AnimationLayer.svelte`, add a `unoPop` state and dispatch. Update the `<script>` to:

```svelte
<script lang="ts">
  import { session } from '../session.svelte';
  import { getAnchorRect, flyGhost, prefersReducedMotion } from '../motion';

  let lastNonce = $state(-1);
  let unoPop = $state<{ x: number; y: number; nonce: number } | null>(null);

  $effect(() => {
    const fx = session.fxEvent;
    if (!fx || fx.nonce === lastNonce) return;
    lastNonce = fx.nonce;
    if (prefersReducedMotion()) return;
    if (fx.kind === 'draw' && !fx.toSelf) ghostDraw(fx.playerId);
    else if (fx.kind === 'uno') showUno(fx.playerId, fx.isYou);
  });

  function buildBack(w: number, h: number): HTMLElement {
    const d = document.createElement('div');
    d.className = 'fx-cardback';
    d.style.width = `${w}px`;
    d.style.height = `${h}px`;
    return d;
  }

  function ghostDraw(playerId: string) {
    const from = getAnchorRect('deck');
    const to = getAnchorRect('seat:' + playerId);
    if (!from || !to) return;
    flyGhost({ fromRect: from, toRect: to, build: () => buildBack(from.width, from.height) });
  }

  function showUno(playerId: string, isYou: boolean) {
    let x = innerWidth / 2;
    let y = innerHeight * 0.6;
    if (!isYou) {
      const r = getAnchorRect('seat:' + playerId);
      if (r) { x = r.left + r.width / 2; y = r.bottom + 10; }
      else { y = innerHeight * 0.3; }
    }
    unoPop = { x, y, nonce: (unoPop?.nonce ?? 0) + 1 };
    setTimeout(() => { unoPop = null; }, 750);
  }
</script>
```

- [ ] **Step 2: Render the pop** — change the layer markup to include the wordmark:

```svelte
<div class="fx-layer" aria-hidden="true">
  {#if unoPop}
    {#key unoPop.nonce}
      <span class="uno-pop" style="left: {unoPop.x}px; top: {unoPop.y}px;">UNO!</span>
    {/key}
  {/if}
</div>
```

- [ ] **Step 3: Style it** — add to the `AnimationLayer.svelte` `<style>` (keep the existing `.fx-layer` and `:global(.fx-cardback)` rules):

```css
  .uno-pop {
    position: absolute;
    transform: translate(-50%, -50%);
    font-family: var(--display);
    font-weight: 700;
    font-size: 2.2rem;
    letter-spacing: 0.04em;
    color: var(--brass);
    text-shadow: 0 2px 10px rgb(0 0 0 / 0.55), 0 0 22px rgb(230 184 75 / 0.55);
    animation: unopop 750ms cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
  }
  @keyframes unopop {
    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
    35% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
    60% { transform: translate(-50%, -50%) scale(1); }
    100% { opacity: 0; transform: translate(-50%, -60%) scale(1); }
  }
```

- [ ] **Step 4: Verify type-check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, two tabs. Get a player to one card and tap "Last card!". Expected: a brass "UNO!" pops and fades near that player (centre-low for you, under the seat for an opponent). Reduce-motion on: no pop.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/AnimationLayer.svelte
git commit -m "feat(ui): UNO-call pop near the caller

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Round-win celebration (entrance, score count-up, confetti)

Give the round-end its payoff: the sheet springs in, the winner glows, scores count up, and a restrained confetti burst fires.

**Files:**
- Create: `src/ui/components/Confetti.svelte`
- Modify: `src/ui/components/RoundEnd.svelte`
- Modify: `src/ui/components/AnimationLayer.svelte`

**Interfaces:**
- `Confetti` gains prop `nonce: number` — a changed nonzero value fires one burst.
- `AnimationLayer` consumes the `win` event and drives `Confetti`'s nonce.

- [ ] **Step 1: Create the confetti canvas** — create `src/ui/components/Confetti.svelte`:

```svelte
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
```

- [ ] **Step 2: Fire confetti on the win event from `AnimationLayer`** — in `src/ui/components/AnimationLayer.svelte`, import `Confetti`, add a `confettiNonce`, dispatch on win, and render it. Add to the imports:

```svelte
  import Confetti from './Confetti.svelte';
```

add state near `unoPop`:

```svelte
  let confettiNonce = $state(0);
```

extend the `$effect` dispatch chain (after the `uno` branch):

```svelte
    else if (fx.kind === 'win') confettiNonce++;
```

and render inside `.fx-layer`, after the uno block:

```svelte
  <Confetti nonce={confettiNonce} />
```

- [ ] **Step 3: Animate the RoundEnd entrance + score count-up** — in `src/ui/components/RoundEnd.svelte`, update the `<script>` (after line 12) to add transitions and a count-up tween:

```svelte
  import { fade, fly } from 'svelte/transition';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { prefersReducedMotion } from '../motion';

  const reduce = prefersReducedMotion();
  // One shared 0→1 progress drives every row's count-up.
  const progress = tweened(0, { duration: reduce ? 0 : 650, easing: cubicOut });
  $effect(() => { progress.set(1); });
```

- [ ] **Step 4: Apply the transitions and count-up in markup** — change the overlay/sheet (lines 15–16):

```svelte
<div class="overlay" role="dialog" aria-label="Round over" transition:fade={{ duration: reduce ? 0 : 200 }}>
  <div class="sheet" in:fly={{ y: reduce ? 0 : 24, duration: reduce ? 0 : 320, easing: cubicOut }}>
```

change the winner heading (line 18) to add a glow class:

```svelte
    <h2 class="winner">{iWon ? 'You win the round!' : `${winner?.name} wins the round`}</h2>
```

and change the score cell (line 26) to count up:

```svelte
            <td class="score">{Math.round(p.score * $progress)}</td>
```

- [ ] **Step 5: Add the winner-glow keyframe** — in the `RoundEnd.svelte` `<style>`, append:

```css
  .winner { animation: winnerglow 1.6s ease-in-out 0.2s both; }
  @keyframes winnerglow {
    0% { text-shadow: 0 0 0 rgb(230 184 75 / 0); transform: scale(0.98); }
    40% { text-shadow: 0 0 26px rgb(230 184 75 / 0.6); transform: scale(1.03); }
    100% { text-shadow: 0 0 0 rgb(230 184 75 / 0); transform: scale(1); }
  }
```

- [ ] **Step 6: Verify type-check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, two tabs, play a round to a win. Expected: scrim fades in, the sheet springs up, the winner line glows, scores count up from zero, and a brass/suit confetti burst falls over the sheet. Reduce-motion on: sheet appears instantly, scores show final values, no confetti.

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/Confetti.svelte src/ui/components/AnimationLayer.svelte src/ui/components/RoundEnd.svelte
git commit -m "feat(ui): round-win celebration — entrance, score count-up, confetti

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Full verification pass

Confirm the whole feature end-to-end and that nothing regressed.

**Files:** none (verification only).

- [ ] **Step 1: Unit tests + type-check**

Run: `npm test && npm run check`
Expected: all Vitest suites pass (including `events` and `motion`); svelte-check reports no errors.

- [ ] **Step 2: E2E regression**

Run: `npm run e2e`
Expected: the existing full-round + reconnect Playwright spec (`e2e/game.spec.ts`) passes with no new console errors. If a spawned fx element ever intercepted a click it would surface here — every fx element is `pointer-events: none`, so it must not.

- [ ] **Step 3: Manual reduced-motion sweep**

Enable OS "Reduce Motion", run `npm run dev`, and exercise: draw (self + opponent), each special card, a UNO call, and a round win. Expected: every effect is neutralized — no fly-ins, ghosts, pops, spins, count-ups, or confetti — and gameplay is unaffected. Disable it and confirm all effects return.

- [ ] **Step 4: Final review commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "chore(ui): animation-pass verification tweaks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(Skip if steps 1–3 required no changes.)

---

## Self-Review

**Spec coverage:**
- Core deriver → Task 1. Session `fxEvent` → Task 3. `motion.ts` (reduced-motion dedupe, anchors, flyGhost) → Task 2. Drawing (self `dealIn`) → Task 4; (opponent ghost + count pulse) → Task 5. Special-card punch (skip/reverse/+2/+4) → Task 6. UNO pop → Task 7. Round-win (entrance + count-up + confetti) + `AnimationLayer` win trigger + `Confetti.svelte` → Task 8. `AnimationLayer` created in Task 5, extended in Tasks 7–8. Verification → Task 9. All spec sections mapped.
- Deliberate spec deviation: the spec's optional "skipped-seat flash" is omitted — the client can't reliably identify the skipped seat from a view diff, and fabricating it risks flashing the wrong seat. The skip stamp carries the beat. Noted here so it isn't mistaken for a gap.

**Type consistency:** `GameEvent` (Task 1) is consumed unchanged by `session.fxEvent` (Task 3), `AnimationLayer` (Tasks 5/7/8), and Table's `drawFx`/latch effects (Tasks 5/6). `getAnchorRect`/`flyGhost`/`anchor`/`prefersReducedMotion` signatures (Task 2) match every call site. `OpponentSeat` prop `drewNonce` (Task 5) matches Table's pass-down. `Confetti` prop `nonce` (Task 8) matches AnimationLayer's `confettiNonce` binding.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; commands include expected output.
