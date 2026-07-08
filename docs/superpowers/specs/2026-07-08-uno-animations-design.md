# UNO PWA — Animation Pass Design

**Date:** 2026-07-08
**Status:** Approved

## Goal

Players report the game "lacks animations and feels unprofessional." This pass adds
professional-grade motion to the three moments that still read as static, extending
the existing art direction rather than replacing it. Success means drawing a card,
playing a special card, calling UNO, and winning a round each feel like a deliberate,
polished moment on par with a commercial card game — without adding dependencies or
compromising the felt/brass aesthetic.

## Scope

- **In:** (1) drawing cards — deck→hand travel for you, ghost card + count pulse for
  opponents; (2) special-card punch — distinct beats for skip / reverse / +2 / +4;
  (3) UNO call and round-win celebration (winner emphasis, score count-up, confetti).
- **Out:** turn/direction motion beyond reverse (existing turn-glow stays), new
  dependencies, changes to game rules, networking, or the engine.

## Constraints

- **Tone:** restrained & elegant. Smooth spring easing, short emphasis beats, no
  arcade bounce. Match `--brass`, `--card-*`, `--display`, `--shadow-card` and the
  house easing `cubic-bezier(0.2,0.8,0.3,1)`.
- **Zero new dependencies:** CSS keyframes + Svelte built-ins
  (`svelte/transition`, `svelte/animate`, `svelte/motion`) only; confetti is a
  hand-rolled canvas.
- **Accessibility:** honor the existing `prefers-reduced-motion` contract — CSS
  keyframes/transitions are neutralized by the `src/app.css` kill-switch; all
  JS/WAAPI/canvas motion is gated on a shared `prefersReducedMotion()` helper.

## Architecture

The client has **no event stream** — every animatable moment is derived by diffing
consecutive `PlayerView`s, exactly as `src/ui/announce.ts` (`deriveAnnouncement`)
already does and `tests/ui/announce.test.ts` tests. That pure function becomes the
single source of truth for animation triggers.

### Core deriver — `src/ui/events.ts` (extends `announce.ts`)

One pure function, one diff pass, returning the banner (unchanged) plus a structured
animation event:

```ts
type GameEvent =
  | { kind: 'draw';    playerId: string; n: number; toSelf: boolean }
  | { kind: 'special'; card: Card }   // discardTop became skip/reverse/draw2/wild4
  | { kind: 'uno';     playerId: string; isYou: boolean }
  | { kind: 'win';     winnerId: string; isYou: boolean };

function deriveViewChange(prev, next):
  { banner: string | null; fromSelf: boolean; event: GameEvent | null }
```

- **draw:** a player's `cardCount` rose (or `you.hand` grew) and it is not a deal.
  `isDeal = prev === null || prev.phase === 'roundEnd'`.
- **special:** `discardTop.id` changed to a skip/reverse/draw2/wild4.
- **uno:** a player's `saidUno` went false→true at `cardCount === 1`.
- **win:** `next.phase === 'roundEnd'` and prev wasn't.
- **banner/fromSelf:** existing `deriveAnnouncement` logic verbatim.

At most one `event` per transition; banner and event may co-occur (wild4 → `special`
+ "+4" banner). Tested in `tests/ui/events.test.ts` (kept banner cases + one per
event kind + deal-suppression).

### Session wiring — `src/ui/session.svelte.ts`

`handleView` calls `deriveViewChange`, keeps setting `banner`/`lastPlayFromSelf`, and
exposes a reactive `fxEvent = { ...event, nonce }` (nonce bumped each time so repeated
identical events refire). Cleared in `leave()`.

### Shared utilities — `src/ui/motion.ts` (new)

- `prefersReducedMotion()` — the reduced-motion guard, deduplicated from `Table.svelte`
  and `Announce.svelte` (both refactored to import it).
- **Anchor registry** — `setAnchor` / `clearAnchor` / `getAnchorRect`. Components
  register on-screen positions by key (`'deck'`, `'seat:'+id`) so the fx layer can
  measure without prop-drilling.
- `flyGhost({ fromRect, toRect, duration, build })` — spawns a transient
  absolutely-positioned element, animates `from → to` via the Web Animations API,
  self-removes on finish. No-ops under reduced motion.

### fx ownership

- **Declarative (component-local, keyed off view):** `dealIn` hand transition,
  special-card stamp/spin/penalty-pop, seat count pulse, round-end entrance + score
  count-up. Neutralized automatically by the CSS kill-switch or gated durations.
- **Imperative (spawned / measured):** one `AnimationLayer.svelte` — a fixed,
  `pointer-events:none` overlay mounted once in `Table.svelte` — watches
  `session.fxEvent.nonce` and dispatches ghost draw-cards, the UNO pop, and confetti,
  reading positions from the anchor registry. Returns early under reduced motion.

## Feature detail

- **Drawing:** replace the hand's `in:fly` with a `dealIn` transition originating at
  the `'deck'` anchor (fires for single draws and full deals alike). Opponent draws
  fly a ghost card-back deck→seat and pulse that seat's count (pulse driven by a prop
  from `Table` reading `fxEvent`, keeping `OpponentSeat` dumb).
- **Special-card punch:** CSS-keyframe beats keyed on `discardTop.id` — skip stamp +
  skipped-seat flash, reverse 180° spin, +2/+4 penalty pill pop/shake that re-pops on
  stacked accumulation.
- **UNO & round win:** a brass "UNO!" pop near the caller; round-end scrim fade +
  sheet spring-up + winner glow + `svelte/motion` score count-up, with a hand-rolled
  `Confetti.svelte` canvas burst (low density, suit/brass colours, gravity, ~1.2s,
  self-cleaning).

## Files

- **New:** `src/ui/motion.ts`, `src/ui/components/AnimationLayer.svelte`,
  `src/ui/components/Confetti.svelte`, `tests/ui/events.test.ts`.
- **Rename+extend:** `src/ui/announce.ts` → `src/ui/events.ts`; replace
  `tests/ui/announce.test.ts`.
- **Modify:** `src/ui/session.svelte.ts`, `src/ui/screens/Table.svelte`,
  `src/ui/components/OpponentSeat.svelte`, `src/ui/components/Announce.svelte`,
  `src/ui/components/RoundEnd.svelte`.

## Testing

1. `npm test` — `events.test.ts` covers each event kind, deal-suppression, and
   unchanged banner behaviour. `npm run check` clean.
2. `npm run e2e` — existing full-round Playwright spec passes with no regressions or
   console errors.
3. Manual (`npm run dev`, two contexts): draw travel, opponent ghost + pulse, each
   special beat, UNO pop, round-win count-up + confetti.
4. OS "Reduce Motion" on → all motion neutralized, gameplay unaffected.
