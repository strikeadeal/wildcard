# WILDCARD Clarity-First Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hosting, joining, turn-taking, public game events and connection recovery immediately understandable without changing WILDCARD's rules or P2P architecture.

**Architecture:** Preserve `src/engine/*` as the rules authority and keep `PlayerView` affordance-driven. Add small pure UI modules for prompts, fatal-state copy, public notices and queueing; generate redaction-safe notices in `HostSession`; carry them as an optional protocol field; and layer connection health over the last authoritative table view.

**Tech Stack:** Svelte 5 runes, TypeScript 6, Vite 8, PeerJS, Vitest, Playwright, vite-plugin-pwa.

## Global Constraints

- Preserve the no-backend, peer-to-peer PeerJS architecture.
- Do not change card legality, scoring, house-rule semantics or engine redaction.
- Do not add accounts, analytics, ads, matchmaking, chat, avatars or progression.
- Do not add runtime dependencies.
- Keep all touch targets at least 44px; primary controls remain 48px.
- Every animated state must retain a static text equivalent under reduced motion.
- Public notices must never reveal another player's hand, drawn-card identity or stable private card IDs.
- Treat `navigator.onLine` as advisory; PeerJS connection outcomes remain authoritative.
- Keep sound, haptics, spectator mode, host migration and persistent rooms out of this release.

---

## File structure

### New files

- `src/ui/action-prompt.ts` — pure turn/action instruction derivation from `PlayerView`.
- `src/ui/fatal-state.ts` — typed fatal reasons, copy and permitted recovery actions.
- `src/ui/public-notices.ts` — redaction-safe public notice types, generation and formatting.
- `src/ui/notice-queue.ts` — pure deduplication and bounded-history helpers.
- `src/ui/connection-state.ts` — pure recovery-state reducer and retry policy.
- `src/ui/components/ActionHistory.svelte` — last-three public actions.
- `src/ui/components/ReconnectOverlay.svelte` — non-destructive connection recovery overlay.
- `src/ui/components/InstallPrompt.svelte` — returning-player PWA install affordance.
- `tests/ui/action-prompt.test.ts`
- `tests/ui/fatal-state.test.ts`
- `tests/ui/public-notices.test.ts`
- `tests/ui/notice-queue.test.ts`
- `tests/ui/connection-state.test.ts`
- `e2e/polish.spec.ts`

### Existing files modified

- `src/net/host.ts` — deterministic test seed hook, notice generation and connection notices.
- `src/net/protocol.ts` — optional `notices` on view messages.
- `src/net/guest.ts` — notice and connection-health event forwarding.
- `src/net/transport.ts` — connection-health callback contract.
- `src/net/peer.ts` — ICE health reporting separate from terminal closure.
- `src/ui/session.svelte.ts` — operation, fatal, notice, install and recovery state orchestration.
- `src/ui/events.ts` — corrected fallback penalty wording and compatibility fallback.
- `src/ui/motion.ts` — shared duration/easing constants.
- `src/ui/App.svelte` — install prompt, offline status and global toast placement.
- `src/ui/screens/Home.svelte` — explicit host/join hierarchy and inline validation.
- `src/ui/screens/Connecting.svelte` — operation-specific progress.
- `src/ui/screens/Fatal.svelte` — reason-specific recovery actions.
- `src/ui/screens/Lobby.svelte` — short-screen layout and sticky footer.
- `src/ui/screens/Table.svelte` — derived prompts, action history, reconnect overlay and host controls.
- `src/ui/components/OpponentSeat.svelte` — score and persistent away controls.
- `src/ui/components/Announce.svelte` — queued notice rendering.
- `src/ui/components/AnimationLayer.svelte` — notice-driven effects and multi-card draw representation.
- `src/app.css` — spacing, safe-area and motion tokens; self-hosted font declaration.
- `index.html` — remove the inline font declaration/preload after asset migration.
- `vite.config.ts` — remove the obsolete public-font include.
- `playwright.config.ts` — deterministic e2e seed.
- `e2e/helpers.ts` and `e2e/game.spec.ts` — bounded, race-tolerant action helper.
- relevant existing Vitest files under `tests/net` and `tests/ui`.

---

### Task 1: Stabilise deterministic multiplayer tests

**Files:**
- Modify: `src/net/host.ts:29-146`
- Modify: `src/ui/session.svelte.ts:113-151`
- Modify: `playwright.config.ts:1-28`
- Modify: `e2e/helpers.ts:1-43`
- Modify: `e2e/game.spec.ts:1-130`
- Modify: `tests/net/host.test.ts:30-221`

**Interfaces:**
- Produces: `HostSession` constructor parameter `newSeed: () => number` with production default `() => Date.now() >>> 0`.
- Produces: `clickIfActionable(locator: Locator): Promise<boolean>` for all race-prone e2e actions.
- Consumes: no interfaces from later tasks.

- [ ] **Step 1: Write failing deterministic-seed and bounded-click tests**

Add this host test:

```ts
it('uses the injected seed when starting a game', async () => {
  const handlers: HostEvents = {
    onLobby: () => {}, onView: () => {}, onError: () => {}
  };
  const seeded = new HostSession(
    'Host', DEFAULT_RULES, handlers, () => 'token', () => 1234
  );
  const w = new Wire(seeded);
  w.hello('Ada');
  await flush();
  seeded.startGame();
  expect(seeded.state?.seed).toBe(1235); // deal() advances the supplied seed once
});
```

Add a Playwright regression in `e2e/game.spec.ts` that calls an exported helper
against a disabled draw pile and asserts it returns within one second:

```ts
test('action helper does not wait on a control that became disabled', async ({ page }) => {
  await page.setContent('<button aria-label="Face-down card" disabled>W</button>');
  const started = Date.now();
  expect(await clickIfActionable(page.getByRole('button', { name: 'Face-down card' })))
    .toBe(false);
  expect(Date.now() - started).toBeLessThan(1_000);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npm test -- tests/net/host.test.ts
npx playwright test e2e/game.spec.ts --grep "action helper does not wait"
```

Expected: Vitest fails because the fifth constructor argument is unsupported;
Playwright fails because `clickIfActionable` is not exported.

- [ ] **Step 3: Add the seed hook and test-only Vite setting**

Change the constructor tail and `startGame()` in `src/net/host.ts`:

```ts
constructor(
  hostName: string,
  config: RuleConfig,
  private events: HostEvents,
  private newToken: () => string = () => crypto.randomUUID(),
  private newSeed: () => number = () => Date.now() >>> 0
) { /* existing body */ }

// in startGame()
this.state = createGame(
  this.seats.map((s) => ({ id: s.id, name: s.name })),
  this.config,
  this.newSeed()
);
```

In `session.svelte.ts`, add:

```ts
const configuredSeed = Number(import.meta.env.VITE_GAME_SEED);
const e2eSeed = Number.isFinite(configuredSeed) ? () => configuredSeed : undefined;

// createRoom()
this.host = new HostSession(
  name.trim() || 'Host', DEFAULT_RULES, events, undefined, e2eSeed
);
```

Add this entry to the Vite web server environment in `playwright.config.ts`:

```ts
env: {
  VITE_PEER_HOST: 'localhost',
  VITE_PEER_PORT: '9099',
  VITE_GAME_SEED: '1337'
}
```

- [ ] **Step 4: Make every e2e action bounded and race-tolerant**

In `e2e/helpers.ts`, import `Locator` and add:

```ts
export async function clickIfActionable(locator: Locator): Promise<boolean> {
  if (!await locator.isVisible().catch(() => false)) return false;
  if (!await locator.isEnabled().catch(() => false)) return false;
  return locator.click({ timeout: 750 }).then(() => true, () => false);
}
```

Replace each `isVisible/isEnabled` followed by unbounded `click()` in
`actIfPossible()` with `clickIfActionable()`. Preserve the existing priority:
colour, playable card, draw, Keep it. In `game.spec.ts`, use the same helper for
the 7-0 swap choice.

- [ ] **Step 5: Run deterministic multiplayer verification**

Run:

```bash
npm test -- tests/net/host.test.ts
npx playwright test e2e/game.spec.ts
```

Expected: host unit tests pass; all e2e tests finish without an action-level
240-second wait, and seed `1337` finishes the full round inside the existing
400-iteration guard. Do not add random retries.

- [ ] **Step 6: Commit**

```bash
git add src/net/host.ts src/ui/session.svelte.ts playwright.config.ts e2e/helpers.ts e2e/game.spec.ts tests/net/host.test.ts
git commit -m "test: make multiplayer e2e deterministic"
```

---

### Task 2: Add global spacing, safe-area, motion and font foundations

**Files:**
- Modify: `src/app.css:1-94`
- Modify: `src/ui/motion.ts:1-77`
- Modify: `src/ui/screens/Home.svelte:61-117`
- Modify: `src/ui/screens/Lobby.svelte:73-128`
- Modify: `src/ui/screens/Connecting.svelte:8-30`
- Modify: `src/ui/screens/Fatal.svelte:15-44`
- Modify: `src/ui/screens/Table.svelte:211-381`
- Modify: `index.html:1-33`
- Modify: `vite.config.ts:8-35`
- Move: `public/fonts/Fraunces.woff2` to `src/assets/fonts/Fraunces.woff2`
- Move: `public/fonts/OFL.txt` to `src/assets/fonts/OFL.txt`
- Create: `e2e/polish.spec.ts`

**Interfaces:**
- Produces CSS variables: `--space-1` through `--space-6`, `--safe-top`,
  `--safe-right`, `--safe-bottom`, `--safe-left`, `--motion-fast`,
  `--motion-medium`, `--ease-out`.
- Produces TS constants: `MOTION.fast`, `MOTION.medium`, `MOTION.emphasis`,
  `EASE.out`.

- [ ] **Step 1: Write a failing mobile-foundations e2e test**

Create `e2e/polish.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('home fits a 390x844 viewport and exposes safe-area tokens', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 390);
  const tokens = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return {
      top: css.getPropertyValue('--safe-top').trim(),
      bottom: css.getPropertyValue('--safe-bottom').trim(),
      medium: css.getPropertyValue('--motion-medium').trim()
    };
  });
  expect(tokens).toEqual({
    top: 'env(safe-area-inset-top)',
    bottom: 'env(safe-area-inset-bottom)',
    medium: '240ms'
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx playwright test e2e/polish.spec.ts`

Expected: FAIL because the root safe-area and motion variables do not exist.

- [ ] **Step 3: Define shared CSS and TS tokens**

Add to `:root` in `app.css`:

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;
--safe-top: env(safe-area-inset-top);
--safe-right: env(safe-area-inset-right);
--safe-bottom: env(safe-area-inset-bottom);
--safe-left: env(safe-area-inset-left);
--motion-fast: 160ms;
--motion-medium: 240ms;
--motion-emphasis: 420ms;
--ease-out: cubic-bezier(0.2, 0.8, 0.3, 1);
```

Add to `motion.ts`:

```ts
export const MOTION = { fast: 160, medium: 240, emphasis: 420 } as const;
export const EASE = { out: 'cubic-bezier(0.2, 0.8, 0.3, 1)' } as const;
```

Replace duplicated equivalent duration/easing literals only in files already
touched by later tasks; do not perform an unrelated whole-project rewrite.

- [ ] **Step 4: Apply safe-area padding to every full-screen surface**

Use this pattern on Home, Lobby, Connecting and Fatal, adapting existing base
padding values:

```css
padding:
  calc(var(--space-5) + var(--safe-top))
  calc(20px + var(--safe-right))
  calc(var(--space-6) + var(--safe-bottom))
  calc(20px + var(--safe-left));
```

Update the table to include all four insets:

```css
padding:
  calc(14px + var(--safe-top))
  calc(12px + var(--safe-right))
  calc(12px + var(--safe-bottom))
  calc(12px + var(--safe-left));
```

- [ ] **Step 5: Move the font into Vite's asset graph**

Run:

```bash
mkdir -p src/assets/fonts
git mv public/fonts/Fraunces.woff2 src/assets/fonts/Fraunces.woff2
git mv public/fonts/OFL.txt src/assets/fonts/OFL.txt
```

Move the font declaration from `index.html` to the top of `app.css`:

```css
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 400 900;
  font-display: swap;
  src: url('./assets/fonts/Fraunces.woff2') format('woff2');
}
```

Remove the inline `@font-face`, font preload, and
`'fonts/Fraunces.woff2'` from `includeAssets`. Workbox's existing `woff2` glob
will precache the hashed build asset.

- [ ] **Step 6: Verify mobile CSS and the production font build**

Run:

```bash
npx playwright test e2e/polish.spec.ts
npm run build
```

Expected: mobile test passes; build contains a hashed Fraunces asset, generates the
service worker, and does not print “didn't resolve at build time.”

- [ ] **Step 7: Commit**

```bash
git add src/app.css src/ui/motion.ts src/ui/screens src/assets/fonts index.html vite.config.ts e2e/polish.spec.ts
git commit -m "style: add mobile-safe visual foundations"
```

---

### Task 3: Clarify Home, Connecting and Fatal recovery

**Files:**
- Create: `src/ui/fatal-state.ts`
- Create: `tests/ui/fatal-state.test.ts`
- Modify: `src/ui/session.svelte.ts:9-255`
- Modify: `src/ui/screens/Home.svelte:1-117`
- Modify: `src/ui/screens/Connecting.svelte:1-30`
- Modify: `src/ui/screens/Fatal.svelte:1-44`
- Modify: `src/ui/App.svelte:1-48`
- Modify: `src/net/codes.ts:9-23`
- Modify: `tests/net/codes.test.ts:1-31`

**Interfaces:**
- Produces: `Operation = 'create' | 'join' | 'rejoin' | null`.
- Produces: `FatalReason = 'version' | 'full' | 'started' | 'badToken' |
  'roomUnavailable' | 'networkUnavailable'`.
- Produces: `fatalContent(reason, code): FatalContent`.
- Produces session methods: `retryLastJoin()`, `createFromSavedName()`,
  `clearFatalToHome()`.

- [ ] **Step 1: Write failing fatal-state and inline-code tests**

Create `tests/ui/fatal-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fatalContent } from '../../src/ui/fatal-state';

describe('fatalContent', () => {
  it('does not claim certainty when a room is unreachable', () => {
    const c = fatalContent('roomUnavailable', 'KP4XQ');
    expect(c.title).toBe('Room unavailable');
    expect(c.detail).toContain('host may have left');
    expect(c.actions).toEqual(['retry', 'create', 'home']);
  });

  it('offers refresh for version mismatch', () => {
    expect(fatalContent('version', null).actions).toEqual(['refresh', 'home']);
  });
});
```

Extend `tests/net/codes.test.ts`:

```ts
it('returns a field-friendly reason for malformed codes', () => {
  expect(validateCode('O0I1L')).toBe('Use 5 letters or numbers, excluding I, O, L, 0 and 1.');
  expect(validateCode('KP4XQ')).toBeNull();
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- tests/ui/fatal-state.test.ts tests/net/codes.test.ts`

Expected: FAIL because `fatal-state.ts` and `validateCode` do not exist.

- [ ] **Step 3: Implement pure fatal and code-validation helpers**

In `src/net/codes.ts` export:

```ts
export function validateCode(input: string): string | null {
  if (!input.trim()) return null;
  return normalizeCode(input)
    ? null
    : 'Use 5 letters or numbers, excluding I, O, L, 0 and 1.';
}
```

In `src/ui/fatal-state.ts` define the exact types and a total switch:

```ts
export type FatalReason =
  | 'version' | 'full' | 'started' | 'badToken'
  | 'roomUnavailable' | 'networkUnavailable';
export type FatalAction = 'retry' | 'create' | 'refresh' | 'home';
export interface FatalContent {
  title: string;
  detail: string;
  actions: FatalAction[];
}

export function fatalContent(reason: FatalReason, code: string | null): FatalContent {
  switch (reason) {
    case 'version': return {
      title: 'Update needed', detail: 'Refresh both devices, then try again.',
      actions: ['refresh', 'home']
    };
    case 'full': return {
      title: 'Room full', detail: 'This room already has 6 players.',
      actions: ['create', 'home']
    };
    case 'started': return {
      title: 'Game already started',
      detail: 'Late joining is not available for this game.', actions: ['home']
    };
    case 'badToken': return {
      title: 'Seat no longer available',
      detail: 'Your saved seat is no longer part of this game.', actions: ['home']
    };
    case 'roomUnavailable': return {
      title: 'Room unavailable',
      detail: `No room answers to ${code ?? 'that code'}. Check the code; the host may have left.`,
      actions: ['retry', 'create', 'home']
    };
    case 'networkUnavailable': return {
      title: 'Network unavailable',
      detail: 'WILDCARD could not reach the connection service. Try another network.',
      actions: ['retry', 'home']
    };
  }
}
```

- [ ] **Step 4: Replace free-form session fatal state with typed state**

Use:

```ts
operation = $state<Operation>(null);
fatal = $state<{ reason: FatalReason; code: string | null } | null>(null);

private fail(reason: FatalReason): void {
  this.operation = null;
  this.fatal = { reason, code: this.roomCode ?? this.lastJoin?.code ?? null };
  this.screen = 'fatal';
}

retryLastJoin(): void {
  if (this.lastJoin) void this.joinRoom(this.lastJoin.code, this.lastJoin.name, true);
}

clearFatalToHome(): void { this.leave(); }

createFromSavedName(): void {
  const name = this.savedName();
  this.leave();
  void this.createRoom(name);
}
```

Change the join signature and set its operation before connecting:

```ts
async joinRoom(codeInput: string, name: string, isRejoin = false): Promise<void> {
  this.operation = isRejoin ? 'rejoin' : 'join';
  // retain the existing normalise, timeout and GuestSession flow
}
```

Set `operation` at the beginning of create/join/rejoin and clear it on success,
failure and leave. On `badToken`, call
`localStorage.removeItem(tokenKey(code))` before `fail('badToken')`.

- [ ] **Step 5: Update the three screens**

Home uses one name input and two clearly labelled sections. Its code error is:

```ts
const codeError = $derived(validateCode(code));
const canJoin = $derived(ready && !!code.trim() && !codeError && !busy);
```

Render `codeError` in `<small class="field-error" role="status">` and set
`aria-invalid={!!codeError}` on the input. Button text becomes “Creating room…” or
“Joining…” only for the selected operation.

Connecting maps operation to exact copy:

```ts
const label = $derived({
  create: 'Creating your room…',
  join: 'Finding the host…',
  rejoin: 'Rejoining your seat…'
}[session.operation ?? 'join']);
```

Fatal obtains `fatalContent(session.fatal.reason, session.fatal.code)` and renders
buttons for only the listed actions. `refresh` calls `location.reload()`, `retry`
calls `session.retryLastJoin()`, `create` calls `session.createFromSavedName()`,
and `home` calls `session.clearFatalToHome()`.

- [ ] **Step 6: Verify tests and focused flows**

Run:

```bash
npm test -- tests/ui/fatal-state.test.ts tests/net/codes.test.ts
npm run check
npx playwright test e2e/polish.spec.ts
```

Expected: all pass; malformed code stays on Home with inline text; fatal reasons
render only their specified actions.

- [ ] **Step 7: Commit**

```bash
git add src/net/codes.ts src/ui/fatal-state.ts src/ui/session.svelte.ts src/ui/screens/Home.svelte src/ui/screens/Connecting.svelte src/ui/screens/Fatal.svelte src/ui/App.svelte tests/net/codes.test.ts tests/ui/fatal-state.test.ts e2e/polish.spec.ts
git commit -m "feat: clarify room setup and recovery"
```

---

### Task 4: Keep mobile lobby actions visible

**Files:**
- Modify: `src/ui/screens/Lobby.svelte:23-128`
- Modify: `src/ui/components/RuleToggles.svelte:28-77`
- Modify: `e2e/polish.spec.ts`

**Interfaces:**
- Consumes: safe-area and spacing variables from Task 2.
- Produces: sticky `.lobby-actions` region.

- [ ] **Step 1: Add a failing two-player mobile-lobby test**

Append:

```ts
import { createRoom, joinRoom } from './helpers';

test('host actions remain visible in a two-player mobile lobby', async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  const code = await createRoom(host, 'Hana');
  await joinRoom(guest, code, 'Gil');
  await expect(host.getByText('Gil')).toBeVisible();
  const start = host.getByRole('button', { name: 'Start game' });
  await expect(start).toBeInViewport();
  await expect(host.getByRole('button', { name: 'Leave room' })).toBeInViewport();
});
```

- [ ] **Step 2: Run it and verify the current 917px lobby fails**

Run: `npx playwright test e2e/polish.spec.ts --grep "host actions remain"`

Expected: FAIL because Start/Leave begin below the 844px viewport.

- [ ] **Step 3: Implement the sticky action region**

Rename `.foot` to `.lobby-actions` and apply:

```css
.lobby-actions {
  position: sticky;
  bottom: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-inline: calc(-20px - var(--safe-left)) calc(-20px - var(--safe-right));
  margin-bottom: calc(-36px - var(--safe-bottom));
  padding: var(--space-3) calc(20px + var(--safe-right))
    calc(var(--space-3) + var(--safe-bottom)) calc(20px + var(--safe-left));
  background: linear-gradient(transparent, var(--felt) 20%);
}
```

Add `padding-bottom: 132px` to the lobby content so the sticky region never covers
the final rule. Preserve the current host/guest button logic.

Do not collapse or remove rules in this task; the reserved bottom padding and sticky
footer solve the reachability problem while keeping every house rule visible.

- [ ] **Step 4: Run mobile and accessibility checks**

Run:

```bash
npx playwright test e2e/polish.spec.ts --grep "host actions remain"
npm run check
```

Expected: Start and Leave are initially in viewport; every rule remains keyboard
reachable and guests still see read-only settings.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/Lobby.svelte src/ui/components/RuleToggles.svelte e2e/polish.spec.ts
git commit -m "feat: keep mobile lobby actions visible"
```

---

### Task 5: Add actionable turn prompts, scores and safe away-player controls

**Files:**
- Create: `src/ui/action-prompt.ts`
- Create: `tests/ui/action-prompt.test.ts`
- Modify: `src/ui/screens/Table.svelte:1-381`
- Modify: `src/ui/components/OpponentSeat.svelte:1-85`
- Modify: `src/ui/session.svelte.ts:220-231`
- Modify: `e2e/polish.spec.ts`

**Interfaces:**
- Produces: `deriveActionPrompt(view: PlayerView): ActionPrompt`.
- Produces: `ActionPrompt = { text: string; tone: 'active' | 'waiting' | 'urgent' }`.
- Produces OpponentSeat callbacks: `onskip?: () => void`, `onremove?: () => void`.

- [ ] **Step 1: Write failing prompt tests**

Create tests using the `view()` fixture shape from `tests/ui/events.test.ts`:

```ts
import type { PlayerView } from '../../src/engine/types';
import { C } from '../engine/fixtures';

function view(over: Partial<PlayerView> = {}): PlayerView {
  return {
    you: { id: 'p0', name: 'Ada', hand: [], saidUno: false, score: 0 },
    players: [
      { id: 'p0', name: 'Ada', cardCount: 5, saidUno: false, connected: true, score: 12 },
      { id: 'p1', name: 'Bob', cardCount: 5, saidUno: false, connected: true, score: 7 }
    ],
    discardTop: C('red', '5'), currentColor: 'red', deckCount: 80,
    turnPlayerId: 'p0', direction: 1, phase: 'play', pendingDraw: 0,
    config: { stacking: false, jumpIn: false, drawUntilPlayable: false, sevenZero: false },
    roundWinner: null, playableCardIds: [], canDraw: true, canPass: false,
    canChallenge: false, canCallUno: false, catchableIds: [],
    mustChooseColor: false, mustChooseSwapTarget: false, ...over
  };
}
```

```ts
it('explains a normal local turn', () => {
  expect(deriveActionPrompt(view({ canDraw: true, playableCardIds: [1] }))).toEqual({
    text: 'Your turn — play a raised card or draw.', tone: 'active'
  });
});

it('explains a stackable penalty', () => {
  expect(deriveActionPrompt(view({ pendingDraw: 4, playableCardIds: [9] }))).toEqual({
    text: 'Stack the penalty or draw 4.', tone: 'urgent'
  });
});

it('calls out an out-of-turn jump-in', () => {
  expect(deriveActionPrompt(view({ turnPlayerId: 'p1', playableCardIds: [7] }))).toEqual({
    text: 'Jump in now — you have an identical card.', tone: 'urgent'
  });
});

it('names the player being waited on', () => {
  expect(deriveActionPrompt(view({ turnPlayerId: 'p1' }))).toEqual({
    text: 'Waiting for Bob.', tone: 'waiting'
  });
});
```

Also cover `canPass`, `mustChooseColor`, `mustChooseSwapTarget` and a penalty with
no stack card.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/ui/action-prompt.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure prompt switch**

Create `action-prompt.ts` with this precedence:

```ts
export function deriveActionPrompt(view: PlayerView): ActionPrompt {
  const mine = view.turnPlayerId === view.you.id;
  const turnName = view.players.find((p) => p.id === view.turnPlayerId)?.name ?? 'another player';
  if (view.phase === 'roundEnd') return { text: 'Round over.', tone: 'waiting' };
  if (view.mustChooseColor) return { text: 'Choose the new colour.', tone: 'urgent' };
  if (view.mustChooseSwapTarget) return { text: 'Choose someone to swap hands with.', tone: 'urgent' };
  if (!mine && view.playableCardIds.length > 0) {
    return { text: 'Jump in now — you have an identical card.', tone: 'urgent' };
  }
  if (!mine) return { text: `Waiting for ${turnName}.`, tone: 'waiting' };
  if (view.pendingDraw > 0 && view.playableCardIds.length > 0) {
    return { text: `Stack the penalty or draw ${view.pendingDraw}.`, tone: 'urgent' };
  }
  if (view.pendingDraw > 0) return { text: `Draw ${view.pendingDraw} cards.`, tone: 'urgent' };
  if (view.canPass) return { text: 'Play the card you drew or keep it.', tone: 'active' };
  return { text: 'Your turn — play a raised card or draw.', tone: 'active' };
}
```

- [ ] **Step 4: Integrate prompt and score rendering**

In `Table.svelte`, replace `turnName`/status-string construction with:

```ts
const prompt = $derived(view ? deriveActionPrompt(view) : null);
```

Render `<p class="status {prompt?.tone}" aria-live="polite">{prompt?.text}</p>`.
Apply the brass treatment to `active`, the current neutral style to `waiting`, and
the yellow penalty treatment to `urgent`. Add `class:my-turn={myTurn}` on `.table`
and a restrained outline/glow around `.hand` during the local turn.

In `OpponentSeat.svelte`, render `<span class="score">{player.score} pts</span>`.
For any away player, show host callbacks passed by Table:

```svelte
{#if !player.connected && onremove}
  {#if isTurn && onskip}<button class="ghost small" onclick={onskip}>Skip once</button>{/if}
  <button class="ghost small danger" onclick={onremove}>Remove</button>
{/if}
```

Table's remove handler must confirm before changing host state:

```ts
function removePlayer(player: OpponentView) {
  if (confirm(`${player.name} will be removed from this game.`)) {
    session.removeSeat(player.id);
  }
}
```

Do not move confirmation into `HostSession`.

- [ ] **Step 5: Verify prompts and away controls**

Run:

```bash
npm test -- tests/ui/action-prompt.test.ts
npm run check
npx playwright test e2e/polish.spec.ts
```

Expected: unit cases pass; score is visible; prompt changes correctly; Remove is
available for every away guest and Skip once only for the away turn holder.

- [ ] **Step 6: Commit**

```bash
git add src/ui/action-prompt.ts src/ui/screens/Table.svelte src/ui/components/OpponentSeat.svelte src/ui/session.svelte.ts tests/ui/action-prompt.test.ts e2e/polish.spec.ts
git commit -m "feat: make turn state immediately actionable"
```

---

### Task 6: Generate redaction-safe public notices on the host

**Files:**
- Create: `src/ui/public-notices.ts`
- Create: `tests/ui/public-notices.test.ts`
- Modify: `src/net/host.ts:1-245`
- Modify: `tests/net/host.test.ts:1-221`
- Modify: `src/ui/events.ts:32-52`
- Modify: `tests/ui/events.test.ts:1-190`

**Interfaces:**
- Produces: `PublicNotice`, `PublicNoticeKind`.
- Produces: `deriveActionNotices(before, after, actorId, action, nextId): PublicNotice[]`.
- Produces: `deriveConnectionNotice(playerId, connected, nextId): PublicNotice`.
- Produces: `formatNotice(notice, players, youId): string`.

- [ ] **Step 1: Write failing notice safety and compound-event tests**

Create `tests/ui/public-notices.test.ts` with deterministic engine fixtures:

```ts
it('emits play and penalty notices for a +2 without private card ids', () => {
  const card = C('red', 'draw2', 101);
  const before = fixedState([[card], [C('blue', '3')]], C('red', '5'));
  const result = apply(before, 'p0', { type: 'playCard', cardId: card.id });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const notices = deriveActionNotices(
    before, result.state, 'p0', { type: 'playCard', cardId: card.id }, 10
  );
  expect(notices.map((n) => n.kind)).toEqual(['play', 'penalty']);
  expect(notices[1]).toMatchObject({ id: 11, actorId: 'p0', pendingDraw: 2 });
  expect(JSON.stringify(notices)).not.toContain(`"cardId"`);
  expect(JSON.stringify(notices)).not.toContain(`"hand"`);
});

it('reports draw count but never drawn identities', () => {
  const before = fixedState(
    [[C('red', '5')], [C('blue', '3')]], C(null, 'wild4'),
    { pendingDraw: 4, pendingType: 'wild4' }
  );
  const after = ok(apply(before, 'p0', { type: 'drawCard' }));
  const notices = deriveActionNotices(before, after, 'p0', { type: 'drawCard' }, 1);
  expect(notices).toEqual([{ id: 1, kind: 'draw', actorId: 'p0', count: 4 }]);
});
```

Import `C`, `fixedState` and `ok` from `tests/engine/fixtures.ts`; these are the
only fixture helpers used by the notice suite.

Add cases for normal play, Jump-in, colour, skip, reverse, swap, UNO, Catch,
challenge result, next round and round win. Use existing engine fixture builders;
add focused builders to this test file rather than exporting UI-specific fixtures
from the engine suite.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/ui/public-notices.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Define the public type and exhaustive action derivation**

Create:

```ts
export type PublicNoticeKind =
  | 'play' | 'draw' | 'pass' | 'penalty' | 'color' | 'skip' | 'reverse'
  | 'uno' | 'catch' | 'jumpIn' | 'swap' | 'challenge' | 'nextRound'
  | 'disconnect' | 'reconnect' | 'roundWin';

export interface PublicNotice {
  id: number;
  kind: PublicNoticeKind;
  actorId?: string;
  targetId?: string;
  card?: { color: Color | null; value: CardValue };
  count?: number;
  color?: Color;
  pendingDraw?: number;
  challengeSucceeded?: boolean;
  stacked?: boolean;
}
```

Implement the derivation with public projections only:

```ts
function cardCount(state: GameState, id: string): number {
  return state.players.find((p) => p.id === id)?.hand.length ?? 0;
}

export function deriveActionNotices(
  before: GameState, after: GameState, actorId: string,
  action: Action, nextId: number
): PublicNotice[] {
  const notices: PublicNotice[] = [];
  const add = (notice: Omit<PublicNotice, 'id'>) => {
    notices.push({ id: nextId + notices.length, ...notice });
  };

  switch (action.type) {
    case 'playCard':
    case 'jumpIn': {
      const top = after.discard[after.discard.length - 1]!;
      add({
        kind: action.type === 'jumpIn' ? 'jumpIn' : 'play', actorId,
        card: { color: top.color, value: top.value }
      });
      const targetId = after.players[after.turn]?.id;
      if (top.value === 'draw2' || top.value === 'wild4') {
        add({
          kind: 'penalty', actorId, targetId,
          count: after.pendingDraw - before.pendingDraw,
          pendingDraw: after.pendingDraw, stacked: before.pendingDraw > 0
        });
      } else if (top.value === 'skip') {
        const actorIndex = before.players.findIndex((p) => p.id === actorId);
        const skipped = before.players[
          (((actorIndex + before.direction) % before.players.length) + before.players.length)
          % before.players.length
        ];
        add({ kind: 'skip', actorId, targetId: skipped?.id });
      } else if (top.value === 'reverse') {
        add({ kind: 'reverse', actorId });
      }
      if (action.chosenColor) add({ kind: 'color', actorId, color: action.chosenColor });
      if (action.swapTargetId) add({ kind: 'swap', actorId, targetId: action.swapTargetId });
      break;
    }
    case 'drawCard': {
      const count = cardCount(after, actorId) - cardCount(before, actorId);
      if (count > 0) add({ kind: 'draw', actorId, count });
      break;
    }
    case 'passTurn': add({ kind: 'pass', actorId }); break;
    case 'chooseColor': add({ kind: 'color', actorId, color: action.color }); break;
    case 'chooseSwapTarget':
      add({ kind: 'swap', actorId, targetId: action.targetId }); break;
    case 'callUno': add({ kind: 'uno', actorId }); break;
    case 'catchUno':
      add({
        kind: 'catch', actorId, targetId: action.targetId,
        count: cardCount(after, action.targetId) - cardCount(before, action.targetId)
      });
      break;
    case 'challengeWildFour': {
      const drawn = after.players.find(
        (p) => p.hand.length > cardCount(before, p.id)
      );
      const count = drawn ? drawn.hand.length - cardCount(before, drawn.id) : 0;
      add({
        kind: 'challenge', actorId, targetId: drawn?.id, count,
        challengeSucceeded: !!drawn && drawn.id !== actorId
      });
      if (drawn && count > 0) add({ kind: 'draw', actorId: drawn.id, count });
      break;
    }
    case 'nextRound': add({ kind: 'nextRound', actorId }); break;
  }

  if (before.phase !== 'roundEnd' && after.phase === 'roundEnd' && after.roundWinner) {
    add({ kind: 'roundWin', actorId: after.roundWinner });
  }
  return notices;
}

export function deriveConnectionNotice(
  playerId: string, connected: boolean, id: number
): PublicNotice {
  return { id, kind: connected ? 'reconnect' : 'disconnect', actorId: playerId };
}
```

- [ ] **Step 4: Correct fallback penalty semantics immediately**

Change the old diff fallback in `events.ts` from “Bob draws +2” to:

```ts
return {
  banner: `Penalty is now +${next.pendingDraw} for ${name}`,
  fromSelf
};
```

Update the existing tests to expect “Penalty is now +2 for Bob,”
“Penalty is now +4 for you,” and stacked total `+4`, not merely the delta.

- [ ] **Step 5: Hook notice generation into HostSession without broadcasting yet**

Add:

```ts
private nextNoticeId = 1;

private makeNotices(before: GameState, actorId: string, action: Action): PublicNotice[] {
  if (!this.state) return [];
  const notices = deriveActionNotices(before, this.state, actorId, action, this.nextNoticeId);
  this.nextNoticeId += notices.length;
  return notices;
}
```

In `handleIntent`, clone/reference the immutable pre-apply state, apply, assign the
new state, generate notices, and pass them to the broadcast method introduced in
Task 7. Until Task 7 lands, store them in a private `lastNotices` property exposed
only to tests:

```ts
lastNotices: PublicNotice[] = [];
// after a successful apply
this.lastNotices = this.makeNotices(before, seat.id, action);
this.broadcastViews();
```

- [ ] **Step 6: Run notice, engine and redaction tests**

Run:

```bash
npm test -- tests/ui/public-notices.test.ts tests/ui/events.test.ts tests/engine tests/net/host.test.ts
```

Expected: all pass; JSON safety assertions contain no hand or card ID.

- [ ] **Step 7: Commit**

```bash
git add src/ui/public-notices.ts src/ui/events.ts src/net/host.ts tests/ui/public-notices.test.ts tests/ui/events.test.ts tests/net/host.test.ts
git commit -m "feat: derive public game notices"
```

---

### Task 7: Transport, deduplicate and queue public notices

**Files:**
- Create: `src/ui/notice-queue.ts`
- Create: `tests/ui/notice-queue.test.ts`
- Modify: `src/net/protocol.ts:1-28`
- Modify: `src/net/host.ts:1-245`
- Modify: `src/net/guest.ts:1-56`
- Modify: `src/ui/session.svelte.ts:1-255`
- Modify: `tests/net/host.test.ts`
- Modify: `tests/net/guest.test.ts`

**Interfaces:**
- Consumes: `PublicNotice` and notice derivation from Task 6.
- Produces: optional `notices?: PublicNotice[]` on `ServerMsg.type === 'view'`.
- Produces: `mergeNoticeHistory(current, incoming, limit): PublicNotice[]`.
- Produces session state: `noticeHistory`, `noticeQueue`, `currentNotice`.

- [ ] **Step 1: Write failing queue and wire tests**

Create:

```ts
it('deduplicates by id and keeps the latest three notices', () => {
  const result = mergeNoticeHistory(
    [{ id: 1, kind: 'pass' }],
    [{ id: 1, kind: 'pass' }, { id: 2, kind: 'draw' },
     { id: 3, kind: 'uno' }, { id: 4, kind: 'play' }],
    3
  );
  expect(result.map((n) => n.id)).toEqual([2, 3, 4]);
});
```

Add a HostSession test:

```ts
it('sends public notices alongside the resulting view', async () => {
  const w = new Wire(host);
  w.hello('Ada');
  await flush();
  host.startGame();
  await flush();
  host.applyLocal({ type: 'drawCard' });
  await flush();
  expect(w.last('view')?.notices?.every((n) => Number.isInteger(n.id))).toBe(true);
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/ui/notice-queue.test.ts tests/net/host.test.ts tests/net/guest.test.ts
```

Expected: FAIL because the queue helper and protocol field do not exist.

- [ ] **Step 3: Add the optional protocol field**

Change the view message to:

```ts
| { v: number; type: 'view'; view: PlayerView; notices?: PublicNotice[] }
```

Do not increment `PROTOCOL_VERSION`; the property is optional and additive.
Update `HostEvents.onView` and `GuestEvents.onView` to
`(view: PlayerView, notices?: PublicNotice[]) => void`.

Change `broadcastViews(notices: PublicNotice[] = [])` so every guest and local host
receives the same public notices with their separately redacted `PlayerView`.
In `handleIntent`, replace the temporary test-only storage with:

```ts
const notices = this.makeNotices(before, seat.id, action);
this.lastNotices = notices;
this.broadcastViews(notices);
```

In `setConnected`, allocate and broadcast one connection notice after changing the
connected flag:

```ts
const notice = deriveConnectionNotice(playerId, connected, this.nextNoticeId++);
this.lastNotices = [notice];
this.broadcastViews([notice]);
```

- [ ] **Step 4: Implement queue helpers**

Create:

```ts
export function mergeNoticeHistory(
  current: PublicNotice[], incoming: PublicNotice[], limit = 3
): PublicNotice[] {
  const byId = new Map(current.map((n) => [n.id, n]));
  for (const notice of incoming) byId.set(notice.id, notice);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-limit);
}

export function appendNoticeQueue(
  current: PublicNotice[], incoming: PublicNotice[]
): PublicNotice[] {
  const seen = new Set(current.map((n) => n.id));
  return [...current, ...incoming.filter((n) => !seen.has(n.id))];
}
```

- [ ] **Step 5: Integrate queue state into Session**

Add:

```ts
noticeHistory = $state<PublicNotice[]>([]);
noticeQueue = $state<PublicNotice[]>([]);
currentNotice = $derived(this.noticeQueue[0] ?? null);
private noticeTimer: ReturnType<typeof setTimeout> | undefined;
```

Add the scheduler used by append and dismiss:

```ts
private scheduleNoticeDismissal(): void {
  clearTimeout(this.noticeTimer);
  this.noticeTimer = setTimeout(() => this.dismissCurrentNotice(), 2400);
}
```

Change `handleView(view, notices = [])` to merge history and append queue before
storing the view. When no notices are supplied, continue invoking
`deriveViewChange()` so older cached hosts still drive existing banners/effects.

Implement:

```ts
dismissCurrentNotice(): void {
  this.noticeQueue = this.noticeQueue.slice(1);
  clearTimeout(this.noticeTimer);
  if (this.noticeQueue.length) this.scheduleNoticeDismissal();
}
```

Use 2400ms per notice and clear queue/history/timer in `leave()`.

- [ ] **Step 6: Verify queue and wire behaviour**

Run:

```bash
npm test -- tests/ui/notice-queue.test.ts tests/net/host.test.ts tests/net/guest.test.ts
npm run check
```

Expected: optional field is accepted in both directions; duplicate views do not
repeat notices; last-three history remains bounded.

- [ ] **Step 7: Commit**

```bash
git add src/net/protocol.ts src/net/host.ts src/net/guest.ts src/ui/notice-queue.ts src/ui/session.svelte.ts tests/ui/notice-queue.test.ts tests/net/host.test.ts tests/net/guest.test.ts
git commit -m "feat: deliver and queue public notices"
```

---

### Task 8: Present queued notices, action history and aligned effects

**Files:**
- Create: `src/ui/components/ActionHistory.svelte`
- Modify: `src/ui/components/Announce.svelte:1-38`
- Modify: `src/ui/components/AnimationLayer.svelte:1-91`
- Modify: `src/ui/screens/Table.svelte:1-381`
- Modify: `src/ui/public-notices.ts`
- Modify: `tests/ui/public-notices.test.ts`
- Modify: `e2e/polish.spec.ts`

**Interfaces:**
- Consumes: `session.currentNotice`, `session.noticeHistory`, `formatNotice()`.
- Produces: `noticeToGameEvent(notice, youId): GameEvent | null` compatibility adapter.

- [ ] **Step 1: Write failing formatting/effect tests**

Add:

```ts
it('formats a stacked penalty without claiming it was drawn', () => {
  const players = [{ id: 'p0', name: 'Ada' }, { id: 'p1', name: 'Bob' }];
  expect(formatNotice(
    { id: 2, kind: 'penalty', actorId: 'p0', targetId: 'p1', pendingDraw: 4, stacked: true },
    players, 'p0'
  )).toBe('You stacked the penalty · Bob now faces 4');
});

it('maps a three-card opponent draw to one draw event carrying n=3', () => {
  expect(noticeToGameEvent(
    { id: 4, kind: 'draw', actorId: 'p1', count: 3 }, 'p0'
  )).toEqual({ kind: 'draw', playerId: 'p1', n: 3, toSelf: false });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/ui/public-notices.test.ts`

Expected: FAIL until formatting and adapter exports exist.

- [ ] **Step 3: Implement complete notice formatting**

Implement a total formatter. It accepts only public player names and never inspects
`PlayerView.you.hand`:

```ts
export function formatNotice(
  notice: PublicNotice,
  players: Array<{ id: string; name: string }>,
  youId: string
): string {
  const name = (id?: string) => id === youId
    ? 'You'
    : players.find((p) => p.id === id)?.name ?? 'A player';
  const actor = name(notice.actorId);
  const targetName = name(notice.targetId);
  const target = targetName === 'You' ? 'you' : targetName;
  const faces = targetName === 'You'
    ? `You now face ${notice.pendingDraw}`
    : `${targetName} now faces ${notice.pendingDraw}`;
  const n = notice.count ?? 0;
  const card = notice.card
    ? `${notice.card.color ? notice.card.color + ' ' : ''}${notice.card.value}`
    : 'a card';

  switch (notice.kind) {
    case 'play': return `${actor} played ${card}`;
    case 'draw': return `${actor} drew ${n} ${n === 1 ? 'card' : 'cards'}`;
    case 'pass': return `${actor} kept the drawn card`;
    case 'penalty': return notice.stacked
      ? `${actor} stacked the penalty · ${faces}`
      : `${actor} played a draw card · ${faces}`;
    case 'color': return `${actor} chose ${notice.color?.toUpperCase()}`;
    case 'skip': return `${actor} skipped ${target}`;
    case 'reverse': return `${actor} reversed play`;
    case 'uno': return `${actor} called last card`;
    case 'catch': return `${actor} caught ${target} · draw ${n}`;
    case 'jumpIn': return `${actor} jumped in with ${card}`;
    case 'swap': return `${actor} swapped hands with ${target}`;
    case 'challenge': return notice.challengeSucceeded
      ? `${actor} won the +4 challenge`
      : `${actor} lost the +4 challenge`;
    case 'nextRound': return `${actor} dealt the next round`;
    case 'disconnect': return `${actor} lost connection`;
    case 'reconnect': return `${actor} rejoined`;
    case 'roundWin': return `${actor} won the round`;
  }
}
```

- [ ] **Step 4: Make Announce and history consume the same notices**

`Announce.svelte` derives text from `session.currentNotice` and the current public
player list. Keep the existing transition/reduced-motion behaviour. Remove direct
dependence on `session.banner` for the notice path, retaining it only for fallback.

Create `ActionHistory.svelte`:

```svelte
<script lang="ts">
  import { session } from '../session.svelte';
  import { formatNotice } from '../public-notices';
  const items = $derived(session.noticeHistory.slice().reverse());
</script>

{#if items.length}
  <ol class="action-history" aria-label="Recent actions">
    {#each items as notice (notice.id)}
      <li>{formatNotice(notice, session.view?.players ?? [], session.view?.you.id ?? '')}</li>
    {/each}
  </ol>
{/if}
```

Style it as a compact, low-contrast overlay below the announcement slot; three
one-line items maximum, no scrolling.

- [ ] **Step 5: Drive animations from notices and respect draw count**

When a new current notice appears, use `noticeToGameEvent()` to set the existing
`fxEvent` adapter. For opponent draws, spawn `Math.min(n, 4)` ghost backs with 55ms
stagger; the count pulse remains one animation. Reduced motion renders no ghosts
but still updates history and text.

- [ ] **Step 6: Add e2e assertions for queued compound events**

Use a deterministic rule-enabled game, play until a stack occurs, then assert:

```ts
await expect(host.getByLabel('Recent actions').locator('li')).toHaveCount(3);
await expect(host.getByText(/faces 4|faces 6|faces 8/)).toBeVisible();
```

Do not assert animation timing or pixel positions.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm test -- tests/ui/public-notices.test.ts tests/ui/notice-queue.test.ts
npm run check
npx playwright test e2e/polish.spec.ts
```

Expected: all pass, announcements queue, history retains three, and compound
events do not overwrite one another.

```bash
git add src/ui/public-notices.ts src/ui/components/Announce.svelte src/ui/components/AnimationLayer.svelte src/ui/components/ActionHistory.svelte src/ui/screens/Table.svelte tests/ui/public-notices.test.ts e2e/polish.spec.ts
git commit -m "feat: show queued game actions"
```

---

### Task 9: Add connection health and frozen-table recovery

**Files:**
- Create: `src/ui/connection-state.ts`
- Create: `tests/ui/connection-state.test.ts`
- Create: `src/ui/components/ReconnectOverlay.svelte`
- Modify: `src/net/transport.ts:1-57`
- Modify: `src/net/peer.ts:1-136`
- Modify: `src/net/guest.ts:1-56`
- Modify: `src/ui/session.svelte.ts:1-255`
- Modify: `src/ui/screens/Table.svelte`
- Modify: `tests/net/transport.test.ts:1-60`
- Modify: `tests/net/guest.test.ts:1-67`
- Modify: `e2e/game.spec.ts`
- Modify: `e2e/polish.spec.ts`

**Interfaces:**
- Produces: `ConnectionHealth = 'connecting' | 'connected' | 'unstable' | 'closed'`.
- Produces: `RecoveryState = 'idle' | 'unstable' | 'reconnecting' |
  'roomUnavailable' | 'networkUnavailable'`.
- Produces: `nextRecoveryState(state, event): RecoveryState`.
- Extends `Connection` with `onStatus(cb)`.

- [ ] **Step 1: Write failing reducer and transport tests**

Create:

```ts
it('keeps the table in recovery before declaring failure', () => {
  expect(nextRecoveryState('idle', { type: 'transportUnstable' })).toBe('unstable');
  expect(nextRecoveryState('unstable', { type: 'retryStarted' })).toBe('reconnecting');
  expect(nextRecoveryState('reconnecting', { type: 'rejoined' })).toBe('idle');
});

it('distinguishes unavailable room from unavailable network', () => {
  expect(nextRecoveryState('reconnecting', { type: 'roomMissing' }))
    .toBe('roomUnavailable');
  expect(nextRecoveryState('reconnecting', { type: 'networkFailed' }))
    .toBe('networkUnavailable');
});
```

Extend loopback transport tests to register `onStatus` and expect `connected` at
registration and `closed` after peer close.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm test -- tests/ui/connection-state.test.ts tests/net/transport.test.ts
```

Expected: FAIL because reducer and status callback do not exist.

- [ ] **Step 3: Implement the total recovery reducer**

Define explicit event union:

```ts
export type RecoveryEvent =
  | { type: 'transportUnstable' }
  | { type: 'retryStarted' }
  | { type: 'rejoined' }
  | { type: 'roomMissing' }
  | { type: 'networkFailed' }
  | { type: 'cancelled' };
```

Implement the reducer exactly:

```ts
export function nextRecoveryState(
  state: RecoveryState, event: RecoveryEvent
): RecoveryState {
  switch (event.type) {
    case 'transportUnstable': return state === 'idle' ? 'unstable' : state;
    case 'retryStarted': return 'reconnecting';
    case 'rejoined':
    case 'cancelled': return 'idle';
    case 'roomMissing':
      return state === 'reconnecting' ? 'roomUnavailable' : state;
    case 'networkFailed':
      return state === 'reconnecting' ? 'networkUnavailable' : state;
  }
}
```

- [ ] **Step 4: Extend transport health without changing close semantics**

Add to `Connection`:

```ts
onStatus(cb: (status: ConnectionHealth) => void): void;
```

Loopback returns `connected` when registered and `closed` on close. In `peer.ts`,
report:

- `connected` for ICE connected/completed;
- `unstable` immediately for ICE disconnected;
- `closed` only after the existing four-second grace expires or ICE fails/closes.

Status callbacks must not cause `onClose` more than once.

- [ ] **Step 5: Add bounded automatic rejoin orchestration**

GuestSession forwards `onConnectionStatus`. Session keeps `view` and `screen ===
'game'` while health is unstable. On terminal guest closure:

```ts
private async recoverGuest(): Promise<void> {
  if (!this.lastJoin || this.recovery !== 'reconnecting') return;
  for (const delay of [0, 1500]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const outcome = await this.tryRejoinOnce();
    if (outcome === 'joined') return;
    if (outcome === 'roomMissing') {
      this.recovery = 'roomUnavailable';
      return;
    }
  }
  this.recovery = 'networkUnavailable';
}
```

`tryRejoinOnce()` reuses the saved token and returns a typed outcome rather than
changing screens itself. Guard it with the existing `epoch` so Leave cancels late
results. Do not clear `view` during recovery.

Define its result explicitly:

```ts
type RejoinOutcome = 'joined' | 'roomMissing' | 'networkFailed';
```

`tryRejoinOnce()` calls `peerJoin(lastJoin.code)` through the existing 20-second
`withTimeout`, constructs a replacement `GuestSession` with the stored token, and
resolves `joined` on its first `view`. It resolves `roomMissing` only for the
PeerJS `not-found` error and `networkFailed` for timeout/network errors. It closes
and destroys every losing connection and checks `epoch` before installing the
replacement session.

- [ ] **Step 6: Render the reconnect overlay over the frozen table**

Create `ReconnectOverlay.svelte` with `role="status"` and exact copy:

- unstable: “Connection unstable…”;
- reconnecting: “Rejoining your seat…”;
- roomUnavailable: “Room unavailable. The host may have left.”;
- networkUnavailable: “Could not reconnect. Check your network.”

Terminal states offer Home; networkUnavailable also offers Retry. Disable table
actions whenever recovery is not `idle`, but keep cards, seats and last actions
visible behind the overlay.

- [ ] **Step 7: Verify reconnect and host-loss flows**

Run:

```bash
npm test -- tests/ui/connection-state.test.ts tests/net/transport.test.ts tests/net/guest.test.ts
npx playwright test e2e/game.spec.ts --grep "disconnected guest"
npx playwright test e2e/polish.spec.ts --grep "connection"
npm run check
```

Expected: exact hand restored; frozen table remains visible; host loss ends in
Room unavailable without a Rejoin loop.

- [ ] **Step 8: Commit**

```bash
git add src/ui/connection-state.ts src/ui/components/ReconnectOverlay.svelte src/net/transport.ts src/net/peer.ts src/net/guest.ts src/ui/session.svelte.ts src/ui/screens/Table.svelte tests/ui/connection-state.test.ts tests/net/transport.test.ts tests/net/guest.test.ts e2e/game.spec.ts e2e/polish.spec.ts
git commit -m "feat: recover dropped guest connections in context"
```

---

### Task 10: Add returning-player install and offline guidance

**Files:**
- Create: `src/ui/components/InstallPrompt.svelte`
- Modify: `src/ui/session.svelte.ts`
- Modify: `src/ui/App.svelte`
- Modify: `src/ui/screens/Home.svelte`
- Modify: `e2e/polish.spec.ts`

**Interfaces:**
- Produces session state: `installEvent`, `installDismissed`, `online`.
- Produces session methods: `captureInstallPrompt(event)`, `installApp()`,
  `dismissInstallPrompt()`.

- [ ] **Step 1: Write failing offline and install-eligibility e2e tests**

Append:

```ts
test('home explains offline multiplayer without hiding the shell', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText('You’re offline')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'WILDCARD' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
});

test('install prompt is absent when the browser does not offer installation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Install WILDCARD' })).toHaveCount(0);
});
```

- [ ] **Step 2: Run and verify the offline test fails**

Run: `npx playwright test e2e/polish.spec.ts --grep "offline|install prompt"`

Expected: offline explanation test fails; absence test passes.

- [ ] **Step 3: Track advisory online status**

In Session:

```ts
online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);

setOnline(value: boolean): void { this.online = value; }
```

In `App.svelte`:

```svelte
<svelte:window
  ononline={() => session.setOnline(true)}
  onoffline={() => session.setOnline(false)}
/>
```

Home renders a non-blocking status: “You’re offline. The app is available, but
creating or joining a room needs a network connection.” Do not disable buttons
solely from `navigator.onLine`; connection results remain authoritative.

- [ ] **Step 4: Capture and present install eligibility**

Define a minimal local interface for `BeforeInstallPromptEvent` with
`prompt(): Promise<void>` and `userChoice`:

```ts
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}
```

Capture `beforeinstallprompt`, call `preventDefault()`, and retain the event.
Expose it only when `localStorage.getItem('wildcard:returning') === '1'`. In
`handleView`, when phase changes from a non-round-end view to `roundEnd`, set that
returning key. This lets an event captured earlier become eligible after the game.

Use these session members:

```ts
installEvent = $state<BeforeInstallPromptEvent | null>(null);
installDismissed = $state(localStorage.getItem('wildcard:install-dismissed') === '1');
canOfferInstall = $derived(
  !!this.installEvent && !this.installDismissed
    && localStorage.getItem('wildcard:returning') === '1'
);

captureInstallPrompt(event: Event): void {
  event.preventDefault();
  this.installEvent = event as BeforeInstallPromptEvent;
}

async installApp(): Promise<void> {
  const event = this.installEvent;
  if (!event) return;
  await event.prompt();
  await event.userChoice;
  this.installEvent = null;
}

dismissInstallPrompt(): void {
  this.installDismissed = true;
  localStorage.setItem('wildcard:install-dismissed', '1');
}
```

Register the browser event in `App.svelte` with `onMount` so Svelte's event typing
does not need augmentation:

```ts
onMount(() => {
  const handler = (event: Event) => session.captureInstallPrompt(event);
  window.addEventListener('beforeinstallprompt', handler);
  return () => window.removeEventListener('beforeinstallprompt', handler);
});
```

`InstallPrompt.svelte` renders only when `installEvent` exists and dismissal is
false. “Install WILDCARD” calls `prompt()`, awaits `userChoice`, then clears the
event. “Not now” persists `wildcard:install-dismissed`.

Do not show generic iOS instructions in this task; unsupported browsers render
nothing, keeping the first-run Home uncluttered.

- [ ] **Step 5: Verify PWA behaviour**

Run:

```bash
npx playwright test e2e/polish.spec.ts --grep "offline|install prompt"
npm run build
npm run check
```

Expected: tests pass; build still generates `manifest.webmanifest`, `sw.js`, and a
precache containing the hashed Fraunces asset.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/InstallPrompt.svelte src/ui/session.svelte.ts src/ui/App.svelte src/ui/screens/Home.svelte e2e/polish.spec.ts
git commit -m "feat: add offline and install guidance"
```

---

### Task 11: Full release verification and documentation sync

**Files:**
- Modify only if verification exposes a release-blocking defect in files already
  listed by Tasks 1–10.
- Verify: `README.md`, `docs/superpowers/specs/2026-07-08-wildcard-clarity-first-polish-design.md`

**Interfaces:**
- Consumes every prior task.
- Produces no new runtime interface.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
npm test
npm run check
npm run build
npm run e2e
```

Expected:

- 116 original unit tests plus all new tests pass;
- zero Svelte diagnostics;
- production build succeeds without the unresolved-font warning;
- every Playwright test passes without a 240-second action wait.

- [ ] **Step 2: Run the release acceptance matrix on two browser contexts**

Verify each item manually against the deterministic local PeerJS setup:

```text
[ ] Create and join are understandable without README instructions
[ ] malformed, unavailable, full and started codes preserve useful context
[ ] Start and Leave remain visible at 390x844
[ ] normal, drawn-card, penalty, Jump-in, colour and swap prompts are accurate
[ ] stacking produces ordered play + penalty notices
[ ] last three public actions remain visible and redact hands/card IDs
[ ] missed last-card Catch and successful last-card call are announced
[ ] guest reconnect restores the exact hand under a frozen-table overlay
[ ] host disappearance ends at Room unavailable without a retry loop
[ ] reduced-motion mode retains every textual state
[ ] offline Home explains the shell/network distinction
```

- [ ] **Step 3: Compare implementation to the approved spec**

Read the acceptance criteria and explicit non-goals in
`docs/superpowers/specs/2026-07-08-wildcard-clarity-first-polish-design.md`.
Remove any implementation that introduces sound, haptics, spectator behaviour,
host migration, persistence, accounts, analytics or new rules.

- [ ] **Step 4: Commit any verification-only corrections**

If Step 1 or 2 required corrections, stage only those files and commit:

```bash
git add -u
git status --short
git commit -m "fix: close clarity polish acceptance gaps"
```

If no correction was needed, do not create an empty commit.

- [ ] **Step 5: Request final code review**

Invoke `superpowers:requesting-code-review` with the approved spec, this plan, and
the full test output. Resolve only findings that are in scope for the clarity-first
release.
