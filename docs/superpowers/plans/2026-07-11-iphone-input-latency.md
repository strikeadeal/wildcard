# iPhone Input Latency Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every game action acknowledge an iPhone tap within 50 ms while preserving the Durable Object as the authoritative game server.

**Architecture:** Separate immediate local acknowledgement from authoritative state application. Warm the Web Audio context before gameplay, expose a small client-only pending-action state as soon as an action is sent, and clear it on the next server view or error; never predict or mutate cards, turns, penalties, or scores locally.

**Tech Stack:** Svelte 5 runes, TypeScript, WebSocket protocol, Vitest, Playwright, Chrome DevTools performance traces, Safari Web Inspector on a physical iPhone.

## Global Constraints

- The Durable Object remains authoritative; do not optimistically modify `PlayerView`.
- Immediate visual acknowledgement target: under 50 ms from tap.
- Warm gameplay tap target: INP under 100 ms on a 4x CPU slowdown.
- Authoritative acknowledgement time must be measured separately from local input responsiveness.
- Sound initialization failure must never prevent or delay a game action.

---

### Task 1: Add action-latency state and regression coverage

**Files:**
- Modify: `src/ui/session.svelte.ts`
- Modify: `tests/ui/session.test.ts`

**Interfaces:**
- Produces: `pendingAction: { type: Action['type']; startedAt: number } | null`
- Consumes: existing `Session.sendAction`, `Session.handleView`, and guest error callbacks

- [ ] **Step 1: Write a failing session test**

Add a test which sends an action through the existing fake connection and asserts that `pendingAction` is set synchronously, then delivers the resulting server view and asserts that it is cleared. Add a second assertion that a server error also clears it.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/ui/session.test.ts`

Expected: FAIL because `pendingAction` does not exist.

- [ ] **Step 3: Implement the minimal pending state**

In `Session`, add:

```ts
pendingAction = $state<{ type: Action['type']; startedAt: number } | null>(null);
```

Set it immediately before `this.guest?.send(action)`. Clear it in `handleView`, in the active guest's `onError`, and in `leave`. Do not clear it from animation timers and do not alter `view` locally.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run tests/ui/session.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/session.svelte.ts tests/ui/session.test.ts
git commit -m "feat: track pending game actions"
```

### Task 2: Move audio initialization out of the first gameplay tap

**Files:**
- Modify: `src/ui/App.svelte`
- Modify: `src/ui/screens/Table.svelte`
- Modify: `src/ui/feedback.ts`
- Create: `tests/ui/feedback-browser.test.ts`

**Interfaces:**
- Consumes: `initFeedback(): void`
- Produces: one audio-unlock listener registered when the app mounts, allowing the Create or Join gesture to initialize audio before the table appears

- [ ] **Step 1: Write a failing browser-shell test**

Use a fake `AudioContext` constructor and fake window listeners. Assert that app-level initialization registers exactly one `pointerdown` listener, that the first gesture creates/resumes the context once, and that later gameplay gestures do no audio initialization work.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/ui/feedback-browser.test.ts`

Expected: FAIL because feedback is currently initialized only when `Table.svelte` mounts.

- [ ] **Step 3: Initialize feedback from the app shell**

Call `initFeedback()` once from `App.svelte` in browser context and remove the call from `Table.svelte`. Retain the one-shot listener and all existing exception handling in `feedback.ts`.

- [ ] **Step 4: Verify GREEN and measure the first gameplay tap**

Run: `npx vitest run tests/ui/feedback-browser.test.ts tests/ui/feedback.test.ts`

Then record a 4x CPU/Fast-4G trace beginning immediately before the first card tap. Expected: no `AudioContext` construction in the gameplay interaction and INP below 100 ms.

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.svelte src/ui/screens/Table.svelte src/ui/feedback.ts tests/ui/feedback-browser.test.ts
git commit -m "perf: warm audio before gameplay"
```

### Task 3: Render immediate, authoritative-safe tap acknowledgement

**Files:**
- Modify: `src/ui/screens/Table.svelte`
- Modify: `src/ui/components/CardFace.svelte`
- Modify: `src/app.css`
- Modify: `e2e/game.spec.ts`

**Interfaces:**
- Consumes: `session.pendingAction`
- Produces: `.action-pending` and `aria-busy` UI states without changing game data

- [ ] **Step 1: Write a failing Playwright test**

Intercept the client WebSocket's incoming message dispatch in the page test, click a playable card, and hold the authoritative response briefly. Assert within 50 ms that the table has `aria-busy="true"`, the selected action has pressed/pending styling, and duplicate action controls are disabled. Release the response and assert the pending state disappears with the authoritative view.

- [ ] **Step 2: Run the focused e2e test and verify RED**

Run: `npx playwright test e2e/game.spec.ts --grep "acknowledges a tap immediately"`

Expected: FAIL because the table currently shows no persistent feedback between click release and server broadcast.

- [ ] **Step 3: Add pending presentation**

Bind `aria-busy={session.pendingAction !== null}` on the table. While pending, retain the existing card/button pressed transform, add a short non-layout-changing opacity or box-shadow pulse, and block duplicate sends. Add `touch-action: manipulation` and `-webkit-tap-highlight-color: transparent` to actionable buttons as defensive mobile affordances; do not describe these rules as the root-cause fix.

- [ ] **Step 4: Verify GREEN**

Run: `npx playwright test e2e/game.spec.ts --grep "acknowledges a tap immediately"`

Expected: PASS with acknowledgement under 50 ms.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/Table.svelte src/ui/components/CardFace.svelte src/app.css e2e/game.spec.ts
git commit -m "perf: acknowledge game taps immediately"
```

### Task 4: Reduce transition layout cost only if it remains measurable

**Files:**
- Modify: `src/ui/screens/Table.svelte`
- Modify: `src/ui/motion.ts`
- Modify: `tests/ui/motion.test.ts`

**Interfaces:**
- Consumes: existing `land`, `dealIn`, `animate:flip`, and anchor rectangles
- Produces: the same visible motion with no forced-layout task exceeding 8 ms on the target trace

- [ ] **Step 1: Re-profile before changing animation code**

Record a warm gameplay tap at 4x CPU after Tasks 1–3. If forced reflow totals 8 ms or less, skip this task and record the evidence; the original trace showed only 14 ms and this is secondary.

- [ ] **Step 2: If necessary, write a failing motion test**

Extract pure rectangle-to-transform calculation from `land`/`dealIn` into `motion.ts` and test its output. This permits DOM rectangles to be read once before style writes.

- [ ] **Step 3: Verify RED, implement batched reads, and verify GREEN**

Run: `npx vitest run tests/ui/motion.test.ts`

Expected before implementation: FAIL for the missing helper. After implementation: PASS. Re-record the trace and require no forced-layout task over 8 ms.

- [ ] **Step 4: Commit only if the measured gate required changes**

```bash
git add src/ui/screens/Table.svelte src/ui/motion.ts tests/ui/motion.test.ts
git commit -m "perf: reduce card transition layout work"
```

### Task 5: Verify on emulation and physical iPhone

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-iphone-input-latency.md` (append measured results)

**Interfaces:**
- Consumes: Tasks 1–4
- Produces: recorded acceptance evidence

- [ ] **Step 1: Run automated verification**

```bash
npm test
npm run check
npm run build
npm run e2e
```

Expected: all commands exit 0.

- [ ] **Step 2: Capture repeatable Chromium measurements**

Test first and warm card taps with a 390x844 touch viewport, 4x CPU slowdown, and Fast 4G. Record local acknowledgement, INP, authoritative acknowledgement, and forced-layout duration separately.

- [ ] **Step 3: Test a physical iPhone**

Use Safari Web Inspector on the same iPhone/network class reported by testers. Run at least ten playable-card and draw-pile taps. Acceptance: every tap shows local feedback under 50 ms; warm INP stays under 100 ms; no action is duplicated; and authoritative state always replaces pending state.

- [ ] **Step 4: Test laptop parity and adverse network behavior**

Repeat on laptop and under Slow 4G. Slow network may delay authoritative results, but immediate pending feedback must remain under 50 ms and reconnection behavior must remain unchanged.

- [ ] **Step 5: Append the measurements and commit**

```bash
git add docs/superpowers/plans/2026-07-11-iphone-input-latency.md
git commit -m "docs: record mobile input latency verification"
```
