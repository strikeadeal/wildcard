# Multiplayer Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve reconnectable seats through transient outages, keep browser recovery active until a definitive outcome, reject malformed protocol traffic safely, and expose token-safe Worker diagnostics.

**Architecture:** Keep the Durable Object and `RoomSession` authoritative. Add a pure decoder at the protocol boundary, change lobby disconnects from deletion to presence changes, and isolate retry scheduling in a small recovery helper consumed by the Svelte session. Worker logging observes categorical session events without exposing tokens or game contents.

**Tech Stack:** TypeScript 6, Svelte 5 runes, Vitest 4, Playwright 1.61, Cloudflare Workers and SQLite-backed Durable Objects, Vite 8.

## Global Constraints

- Preserve the one-Durable-Object-per-room architecture and protocol version 2.
- Do not add runtime dependencies.
- Do not change game rules, scoring, six-player capacity, or twelve-hour room expiry.
- A deliberate guest leave remains permanent; a deliberate host leave closes the room.
- Never log seat tokens, names, hands, card contents, or raw messages.
- Every behavior change starts with a failing automated test.
- Do not stage or modify the unrelated `.agents/` directory.

---

## File Map

- Create `src/net/decode-client-msg.ts`: pure runtime decoder for untrusted client messages.
- Create `tests/net/decode-client-msg.test.ts`: decoder acceptance and rejection matrix.
- Create `src/ui/reconnect-policy.ts`: pure retry-delay and online-wake coordination primitives.
- Create `tests/ui/reconnect-policy.test.ts`: deterministic policy tests.
- Modify `src/net/room.ts`: validated message ingress, retained lobby seats, start eligibility, and categorical lifecycle events.
- Modify `src/net/protocol.ts`: stable protocol error text/type support if required by the decoder.
- Modify `src/ui/session.svelte.ts`: persistent recovery loop, cancellation generation, and online wake-up.
- Modify `src/ui/App.svelte`: route online/offline events through the session recovery API.
- Modify `worker/src/room-do.ts`: token-safe structured lifecycle logging.
- Modify `tests/net/room.test.ts`: lobby reservation, reclaim, explicit removal, and malformed-input behavior.
- Modify `tests/ui/session.test.ts`: recovery timing, online wake-up, definitive outcomes, and cancellation.
- Modify `e2e/game.spec.ts`: lobby disconnect/start/reclaim and malformed-message scenarios.
- Modify `e2e/polish.spec.ts`: long outage and offline-to-online recovery behavior.

---

### Task 1: Decode Untrusted Client Messages

**Files:**
- Create: `src/net/decode-client-msg.ts`
- Create: `tests/net/decode-client-msg.test.ts`
- Modify: `src/net/protocol.ts`

**Interfaces:**
- Consumes: `PROTOCOL_VERSION`, `ClientMsg`, `Action`, `RuleConfig`, and legal colors.
- Produces: `decodeClientMsg(raw: unknown): DecodeClientMsgResult`, where the result is `{ ok: true; msg: ClientMsg }` or `{ ok: false; reason: 'shape' | 'version' | 'type' | 'payload' }`.

- [ ] **Step 1: Write the failing decoder tests**

Cover one valid example of every `ClientMsg` variant, then table-drive malformed values including `null`, arrays, missing `v`, wrong version, unknown type, null action, non-integer card id, illegal color, overlong intent id, partial config, non-boolean config values, and invalid player ids.

```ts
import { describe, expect, it } from 'vitest';
import { decodeClientMsg } from '../../src/net/decode-client-msg';
import { DEFAULT_RULES } from '../../src/engine/types';
import { PROTOCOL_VERSION } from '../../src/net/protocol';

it.each([
  { v: PROTOCOL_VERSION, type: 'hello', name: 'Ada', token: null, create: false },
  { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'drawCard' }, intentId: 'intent-1' },
  { v: PROTOCOL_VERSION, type: 'config', config: DEFAULT_RULES },
  { v: PROTOCOL_VERSION, type: 'start' },
  { v: PROTOCOL_VERSION, type: 'leave' },
  { v: PROTOCOL_VERSION, type: 'skipTurn', playerId: 'p1' },
  { v: PROTOCOL_VERSION, type: 'removeSeat', playerId: 'p1' }
])('accepts $type', (raw) => {
  expect(decodeClientMsg(raw)).toEqual({ ok: true, msg: raw });
});

it.each([
  null,
  [],
  { v: PROTOCOL_VERSION, type: 'intent', action: null },
  { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'playCard', cardId: 1.5 } },
  { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'chooseColor', color: 'orange' } },
  { v: PROTOCOL_VERSION, type: 'config', config: { stacking: true } },
  { v: PROTOCOL_VERSION, type: 'skipTurn', playerId: '' }
])('rejects malformed payload %#', (raw) => {
  expect(decodeClientMsg(raw).ok).toBe(false);
});
```

- [ ] **Step 2: Run the decoder test to verify it fails**

Run: `npx vitest run tests/net/decode-client-msg.test.ts`

Expected: FAIL because `src/net/decode-client-msg.ts` does not exist.

- [ ] **Step 3: Implement the pure decoder**

Use small type guards for records, bounded strings, finite integer card ids, colors, rule config, and each action discriminant. Return categorical failures; never throw and never clone or mutate the input.

```ts
export type DecodeClientMsgResult =
  | { ok: true; msg: ClientMsg }
  | { ok: false; reason: 'shape' | 'version' | 'type' | 'payload' };

export function decodeClientMsg(raw: unknown): DecodeClientMsgResult {
  if (!isRecord(raw)) return { ok: false, reason: 'shape' };
  if (raw.v !== PROTOCOL_VERSION) return { ok: false, reason: 'version' };
  if (typeof raw.type !== 'string') return { ok: false, reason: 'type' };
  // Switch by type and return a newly constructed, validated ClientMsg.
}
```

- [ ] **Step 4: Run decoder tests and the TypeScript checks**

Run: `npx vitest run tests/net/decode-client-msg.test.ts && npm run check`

Expected: decoder tests PASS and both frontend/Worker type checks PASS.

- [ ] **Step 5: Commit the decoder**

```bash
git add src/net/decode-client-msg.ts src/net/protocol.ts tests/net/decode-client-msg.test.ts
git commit -m "fix: validate multiplayer client messages"
```

---

### Task 2: Retain and Reclaim Lobby Seats

**Files:**
- Modify: `src/net/room.ts`
- Modify: `tests/net/room.test.ts`

**Interfaces:**
- Consumes: `decodeClientMsg(raw)` from Task 1.
- Produces: retained disconnected lobby seats, `canStart === false` whenever any retained seat is disconnected, and optional categorical `RoomEvent` callbacks for Task 5.

- [ ] **Step 1: Write failing room lifecycle tests**

Add tests proving:

1. Closing a lobby guest connection leaves `{ id: 'p1', connected: false }` in `lobbyInfo()`.
2. `canStart` becomes false and a host `start` command returns an explanatory error while a retained seat is away.
3. Rejoining with the original token restores `p1`, does not create `p2`, and sets `connected: true`.
4. An explicit guest `leave` and host `removeSeat` still remove the retained seat.
5. `null` actions and malformed configs do not throw or mutate the snapshot.

```ts
it('reserves a disconnected lobby seat and reclaims the same id by token', async () => {
  const host = await createdRoom(room);
  const guest = new Wire(room);
  guest.hello('Ada');
  await flush();
  const token = guest.last('welcome')!.token;

  guest.close();
  await flush();
  expect(room.lobbyInfo().players).toContainEqual({ id: 'p1', name: 'Ada', connected: false });
  expect(room.lobbyInfo().canStart).toBe(false);

  const back = new Wire(room);
  back.hello('Ada', token);
  await flush();
  expect(back.last('welcome')?.playerId).toBe('p1');
  expect(room.lobbyInfo().players).toHaveLength(2);
});
```

- [ ] **Step 2: Run focused room tests to verify failure**

Run: `npx vitest run tests/net/room.test.ts`

Expected: FAIL because the disconnected lobby guest is currently spliced from `seats` and malformed nested payloads can throw.

- [ ] **Step 3: Route all room ingress through the decoder**

Decode before dispatch. Send `rejected/version` for a version mismatch. For other malformed seated traffic, send a stable `error` such as `Invalid message`; for malformed pre-hello traffic, close the connection. Do not call game or seat methods for rejected input.

- [ ] **Step 4: Change lobby disconnect semantics**

Replace the pre-game guest splice branch with `seat.conn = null` followed by `broadcastLobby()`. Compute start eligibility as at least two seats with every retained seat connected.

```ts
const allPresent = this.seats.length >= 2 && this.seats.every((seat) => seat.conn !== null);
// lobbyInfo().canStart = allPresent
```

In `startGame`, reject when any retained seat is away rather than filtering `this.seats` to live connections. Deal all retained, connected seats only after the invariant succeeds.

- [ ] **Step 5: Preserve explicit removal behavior**

Keep `leave` and `removeSeat` as destructive operations. Verify the existing lobby host controls can remove a disconnected guest; do not create a new command.

- [ ] **Step 6: Run focused and complete network unit tests**

Run: `npx vitest run tests/net/room.test.ts tests/net/guest.test.ts tests/net/decode-client-msg.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit lobby reliability**

```bash
git add src/net/room.ts tests/net/room.test.ts
git commit -m "fix: reserve lobby seats through disconnects"
```

---

### Task 3: Extract a Deterministic Reconnect Policy

**Files:**
- Create: `src/ui/reconnect-policy.ts`
- Create: `tests/ui/reconnect-policy.test.ts`

**Interfaces:**
- Produces: `reconnectDelay(attempt: number): number` and `waitForReconnectWindow(options): Promise<'ready' | 'cancelled'>`.
- `waitForReconnectWindow` consumes delay, online status, cancellation predicate, and an online-wake subscription supplied by `Session`.

- [ ] **Step 1: Write failing policy tests with fake timers**

```ts
it('backs off at 0, 1, 2, 4, then caps at 8 seconds', () => {
  expect([0, 1, 2, 3, 4, 5, 10].map(reconnectDelay))
    .toEqual([0, 1000, 2000, 4000, 8000, 8000, 8000]);
});

it('waits while offline and wakes immediately on online', async () => {
  let online = false;
  let wake = () => {};
  const waiting = waitForReconnectWindow({
    delayMs: 8000,
    isOnline: () => online,
    isCancelled: () => false,
    onOnline: (callback) => { wake = callback; return () => {}; }
  });
  online = true;
  wake();
  await expect(waiting).resolves.toBe('ready');
});
```

- [ ] **Step 2: Run policy tests to verify failure**

Run: `npx vitest run tests/ui/reconnect-policy.test.ts`

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement the policy without Svelte or browser globals**

Keep all timing injectable or compatible with Vitest fake timers. Always unsubscribe and clear timers on ready or cancellation.

- [ ] **Step 4: Run policy tests**

Run: `npx vitest run tests/ui/reconnect-policy.test.ts`

Expected: PASS with no pending-timer warnings.

- [ ] **Step 5: Commit the policy**

```bash
git add src/ui/reconnect-policy.ts tests/ui/reconnect-policy.test.ts
git commit -m "test: define persistent reconnect policy"
```

---

### Task 4: Make Session Recovery Persistent and Online-Aware

**Files:**
- Modify: `src/ui/session.svelte.ts`
- Modify: `src/ui/App.svelte`
- Modify: `src/ui/components/ReconnectOverlay.svelte`
- Modify: `tests/ui/session.test.ts`

**Interfaces:**
- Consumes: Task 3 reconnect policy and the existing `tryRejoinOnce(): Promise<RejoinOutcome>`.
- Produces: `setOnline(value: boolean)` that both updates UI state and wakes recovery; a single cancellable recovery loop per session epoch.

- [ ] **Step 1: Write failing session recovery tests**

Use fake timers and mocked `tryRejoinOnce` to prove:

- three or more network failures do not end recovery;
- delays follow the policy and cap at eight seconds;
- offline state opens no sockets;
- `setOnline(true)` wakes recovery immediately;
- `roomMissing` and `seatUnavailable` terminate with their definitive states;
- `leave()` cancels waits and prevents late adoption;
- two close notifications cannot start two loops.

```ts
it('keeps retrying recoverable failures until a later attempt joins', async () => {
  vi.useFakeTimers();
  const attempt = vi.fn()
    .mockResolvedValueOnce('networkFailed')
    .mockResolvedValueOnce('networkFailed')
    .mockResolvedValueOnce('joined');
  (session as any).tryRejoinOnce = attempt;
  session.screen = 'game';
  session.recovery = 'reconnecting';
  (session as any).lastJoin = { code: 'KP4XQ', name: 'Ada' };

  const recovery = (session as any).recoverGuest();
  await vi.advanceTimersByTimeAsync(3000);
  await recovery;
  expect(attempt).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 2: Run session tests to verify failure**

Run: `npx vitest run tests/ui/session.test.ts tests/ui/reconnect-policy.test.ts`

Expected: FAIL because recovery stops after two attempts and online events only change display state.

- [ ] **Step 3: Implement one cancellable recovery loop**

Track a private recovery generation or reuse the captured `epoch` plus a `recoveryTask` guard. Continue after `networkFailed`; stop only after adoption, a definitive server outcome, or cancellation. Clear candidate connections after every failed attempt.

- [ ] **Step 4: Wake recovery from online state changes**

Extend `setOnline` to notify the policy waiter when `value` changes to true. Keep `App.svelte` listeners, but ensure they invoke this active behavior. Avoid starting a second loop from the event.

- [ ] **Step 5: Align overlay behavior**

Keep `unstable` and `reconnecting` progress copy. Do not show a terminal network-failure state while automatic retry remains active. Home remains an explicit cancellation; definitive room/seat outcomes remain terminal.

- [ ] **Step 6: Run session and UI tests**

Run: `npx vitest run tests/ui/session.test.ts tests/ui/connection-state.test.ts tests/ui/reconnect-policy.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit persistent recovery**

```bash
git add src/ui/session.svelte.ts src/ui/App.svelte src/ui/components/ReconnectOverlay.svelte src/ui/reconnect-policy.ts tests/ui/session.test.ts tests/ui/reconnect-policy.test.ts
git commit -m "fix: keep seat recovery active through outages"
```

---

### Task 5: Add Token-Safe Room Diagnostics

**Files:**
- Modify: `src/net/room.ts`
- Modify: `worker/src/room-do.ts`
- Modify: `tests/net/room.test.ts`

**Interfaces:**
- Produces from `RoomSession`: optional `onEvent(event: RoomEvent): void` constructor callback.
- `RoomEvent` is a closed union containing categorical fields only: event kind, player id where applicable, message type, and reason.
- Worker consumes events and emits `console.info(JSON.stringify({ component: 'room', ...event }))` or `console.warn` for rejected traffic.

- [ ] **Step 1: Write failing event tests**

Assert room creation, disconnect, reclaim, game start, deliberate closure, and protocol rejection events. Serialize captured events and assert they contain neither a known token nor player name.

```ts
expect(JSON.stringify(events)).not.toContain(token);
expect(JSON.stringify(events)).not.toContain('Ada');
expect(events).toContainEqual({ kind: 'seatReclaimed', playerId: 'p1' });
```

- [ ] **Step 2: Run room tests to verify failure**

Run: `npx vitest run tests/net/room.test.ts`

Expected: FAIL because `RoomSession` has no event sink.

- [ ] **Step 3: Add the closed event union and optional sink**

Default to a no-op so existing callers and restore paths remain compatible. Emit after authoritative state transitions, never before them.

- [ ] **Step 4: Log events in the Durable Object**

Pass a sink when constructing and restoring `RoomSession`. Add Worker-owned events for expiry and socket errors. Log categorical JSON only; do not log raw request paths unless a room code is explicitly passed safely from `index.ts`.

- [ ] **Step 5: Run tests and type checks**

Run: `npx vitest run tests/net/room.test.ts && npm run check`

Expected: PASS.

- [ ] **Step 6: Commit diagnostics**

```bash
git add src/net/room.ts worker/src/room-do.ts tests/net/room.test.ts
git commit -m "chore: log multiplayer lifecycle outcomes"
```

---

### Task 6: Verify the Failure Modes Against the Real Worker

**Files:**
- Modify: `e2e/game.spec.ts`
- Modify: `e2e/polish.spec.ts`
- Modify: `e2e/helpers.ts` only if a reusable helper is required by two or more tests.

**Interfaces:**
- Consumes: existing `createRoom`, `joinRoom`, `expectLobbyPlayer`, `dropConnection`, and Playwright browser contexts.
- Produces: real-Worker regression coverage for lobby reservation, extended recovery, online wake, and malformed traffic isolation.

- [ ] **Step 1: Add the lobby reservation E2E test**

Create host and guest, capture the guest's visible lobby row, drop the guest connection, assert the host sees Away and Start is disabled, wait for automatic reclaim, then assert Start becomes enabled and both receive seven cards.

- [ ] **Step 2: Add an extended outage test**

Set the guest context offline long enough to exceed the old two-attempt window, assert the table remains in recovery, restore connectivity, and assert the same hand and seat return without clicking Retry.

- [ ] **Step 3: Add malformed WebSocket isolation coverage**

Open a third raw WebSocket to the room, send valid hello if needed followed by malformed intent/config frames, then prove the host and guest can still perform a legal action and receive authoritative views.

- [ ] **Step 4: Run the new E2E tests and verify any failure is behavioral**

Run: `npx playwright test e2e/game.spec.ts e2e/polish.spec.ts --grep "lobby seat|extended outage|malformed" --reporter=list`

Expected: PASS after Tasks 1–5. If a test fails, capture the page state and Worker output, identify the violated invariant, and fix only that root cause.

- [ ] **Step 5: Commit E2E coverage**

```bash
git add e2e/game.spec.ts e2e/polish.spec.ts e2e/helpers.ts
git commit -m "test: cover multiplayer recovery edge cases"
```

---

### Task 7: Full Verification and Documentation Reconciliation

**Files:**
- Modify: `README.md` only if user-visible reconnect or lobby-start behavior is currently described differently.

**Interfaces:**
- Consumes all prior tasks.
- Produces release-ready evidence that the PWA, Worker, and full game flow still function.

- [ ] **Step 1: Run all unit tests**

Run: `npm test`

Expected: all test files and tests PASS.

- [ ] **Step 2: Run static checks**

Run: `npm run check`

Expected: Svelte and Worker TypeScript checks report zero errors.

- [ ] **Step 3: Build the production PWA**

Run: `npm run build`

Expected: Vite exits zero and generates `dist/manifest.webmanifest`, `dist/sw.js`, and the application assets.

- [ ] **Step 4: Run the complete real-Worker E2E suite**

Run: `npm run e2e`

Expected: all Playwright tests PASS against local Wrangler on port 8787.

- [ ] **Step 5: Complete a final seeded round in two browser tabs**

Launch exactly:

```bash
cd worker && npx wrangler dev --port 8787 --var GAME_SEED:1337
VITE_WS_URL=ws://127.0.0.1:8787 VITE_GAME_SEED=1337 npm run dev -- --port 5199 --strictPort
```

Drive create → join → start → legal actions until `roundEnd`. Assert a visible winner and no reconnect overlay or Worker exception.

- [ ] **Step 6: Reconcile README wording**

If needed, state that accidental disconnects reserve lobby seats and block Start until the player returns or the host removes them. Preserve the existing distinction that deliberate host leave closes the room.

- [ ] **Step 7: Review the final diff and worktree**

Run: `git diff --check && git status --short && git log --oneline -8`

Expected: no whitespace errors, only intended project files changed, and `.agents/` remains untracked and untouched.

- [ ] **Step 8: Commit final documentation if changed**

```bash
git add README.md
git commit -m "docs: clarify reconnectable lobby seats"
```

Skip this commit when README requires no change.

---

## Final Review Checklist

- Every accepted requirement maps to a task and automated test.
- No task introduces accounts, cross-device recovery, a new lease service, or protocol-version churn.
- Explicit leave remains destructive while transport loss remains recoverable.
- Runtime validation happens before room mutation.
- Recovery has exactly one active loop and is cancellable.
- Worker logs remain categorical and token-safe.
- Unit, check, build, complete E2E, and final full-round evidence are recorded before claiming completion.
