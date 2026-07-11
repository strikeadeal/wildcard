# iPhone Input Latency Improvement Plan and Verification Record

**Goal:** Acknowledge each game action locally within 50 ms while retaining the
Durable Object as the sole authority for cards, turns, penalties, and scores.

## Implemented plan

- Track a client-only pending action synchronously and clear it on the next
  authoritative view, server error, or leave.
- Warm Web Audio from the app shell before gameplay rather than during the
  first table action.
- Render `aria-busy` and `.action-pending` feedback, and disable duplicate
  action controls while authority is pending.
- Profile layout after those changes; change animation code only if actor-frame
  forced layout exceeds 8 ms.
- Verify unit, type/Svelte, build, browser, deterministic delayed-authority, laptop, and
  physical-iPhone behavior.

## Corrected automated verification — 2026-07-11

All required commands were run fresh from the feature worktree:

| Command | Result |
|---|---|
| `npm test` | exit 0; 24 files, 214 tests passed |
| `npm run check` | exit 0; 0 errors, 0 warnings |
| `npm run build` | exit 0; Vite production and PWA build completed |
| `npm run e2e` | exit 1; freshest run 14 passed, 2 randomized game simulations timed out |

Three fresh full E2E attempts were made. Attempt 1: 15 passed; the ordinary
full-round simulation timed out at 240 seconds. Attempt 2: 15 passed; the
house-rules simulation timed out. Attempt 3: 14 passed; both simulations timed
out. The acknowledgement, duplicate-action, reconnection, and other browser
tests passed on every attempt, but the full E2E gate is not green and is not
claimed. This correction pass did not alter production or E2E code.

The Playwright suite includes the Task 3 transport hold: local acknowledgement
must render under 50 ms, remain present while the real inbound WebSocket frame
is held, prevent duplicate controls, and clear when authority is released.

## Corrected repeatable Chromium measurements

Chrome was driven through Playwright/CDP against local Vite and Wrangler. Mobile
runs used a 390×844 touch viewport, 4× CPU slowdown, and actual
`page.touchscreen.tap()` input. CDP network emulation does not throttle WebSocket
frames, so the earlier Fast/Slow-4G labels and authority claims were invalid and
are superseded by this section.

The durable benchmark is `scripts/bench-input-latency.mjs`. “DOM mutation” is
the `pointerdown`-to-`aria-busy` mutation interval. “Second-rAF boundary” is the
time from `pointerdown` to the second `requestAnimationFrame` callback scheduled
after that mutation; this conservative paint-aware proxy ensures at least one
rendering opportunity has passed, though it is not a hardware display timestamp.

| Profile | Tap | DOM mutation | Second-rAF boundary | Authority from tap | Authority after release |
|---|---|---:|---:|---:|---:|
| Mobile 390×844, 4× CPU | first draw | 6.1 | 36.0 | 32.5 | — |
| Mobile 390×844, 4× CPU | warm draw | 9.3 | 33.0 | 25.9 | — |
| Same, inbound authority held 400 ms | first draw | 7.3 | 30.9 | 453.5 | 20.5 |
| Same, inbound authority held 400 ms | warm draw | 4.9 | 31.6 | 443.3 | 9.5 |
| Laptop 1440×900 | first draw | 1.6 | 34.9 | 21.9 | — |
| Laptop 1440×900 | warm draw | 1.5 | 28.0 | 14.1 | — |

The 400 ms case deterministically queues inbound WebSocket handler delivery. It
proves pending feedback renders before authority is released and the subsequent
authoritative view clears pending state; it is not a network-speed measurement.
Chromium exposed no usable Event Timing interaction IDs for these synthetic
touchscreen taps (`inpMs: 0`), so no INP result is claimed. Actual INP and real
adverse-network behavior remain physical-device gates.

Automated draw-pile taps are used because the current fanned-hand geometry can
fully occlude a randomized playable card from a genuine touchscreen hit point.
Playable-card touchscreen timing therefore remains explicitly outstanding.

### Exact corrected benchmark stdout

```text
{"scenario":"mobile-390x844-4x-cpu","code":"N6XZM","measurements":[{"phase":"first","action":"draw-card","holdMs":0,"domMutationMs":6.1,"secondRafPaintBoundaryMs":36,"inpMs":0,"authorityFromTapMs":32.5,"authorityAfterReleaseMs":null},{"phase":"warm","action":"draw-card","holdMs":0,"domMutationMs":9.3,"secondRafPaintBoundaryMs":33,"inpMs":0,"authorityFromTapMs":25.9,"authorityAfterReleaseMs":null}]}
{"scenario":"mobile-390x844-4x-cpu-inbound-held-400ms","code":"XU88V","measurements":[{"phase":"first","action":"draw-card","holdMs":400,"domMutationMs":7.3,"secondRafPaintBoundaryMs":30.9,"inpMs":0,"authorityFromTapMs":453.5,"authorityAfterReleaseMs":20.5},{"phase":"warm","action":"draw-card","holdMs":400,"domMutationMs":4.9,"secondRafPaintBoundaryMs":31.6,"inpMs":0,"authorityFromTapMs":443.3,"authorityAfterReleaseMs":9.5}]}
{"scenario":"laptop-1440x900","code":"2E2GY","measurements":[{"phase":"first","action":"draw-card","holdMs":0,"domMutationMs":1.6,"secondRafPaintBoundaryMs":34.9,"inpMs":0,"authorityFromTapMs":21.9,"authorityAfterReleaseMs":null},{"phase":"warm","action":"draw-card","holdMs":0,"domMutationMs":1.5,"secondRafPaintBoundaryMs":28,"inpMs":0,"authorityFromTapMs":14.1,"authorityAfterReleaseMs":null}]}
```

## Outstanding physical-iPhone acceptance gate

No physical iPhone is connected to this environment, so this gate is not
claimed. On the tester's iPhone and network class:

1. On macOS Safari enable **Develop > [iPhone] > [Wildcard tab]**, open the
   Timelines/Performance recording, and enable Network requests.
2. Record at least ten playable-card taps and ten draw-pile taps, including the
   first gameplay tap and warm taps.
3. For every tap, measure pointer/touch input to `.action-pending`/`aria-busy`
   paint; require under 50 ms. Record warm interaction latency; require under
   100 ms.
4. In Network/console and the table UI, confirm one outbound intent per tap, no
   duplicate action, and that each authoritative server view clears/replaces
   pending state.
5. Repeat on the tester-reported network class and once with degraded network;
   authoritative delay may increase, but local feedback must remain under
   50 ms and reconnect behavior must remain unchanged.

Final status: **DONE_WITH_CONCERNS** — corrected input measurements meet the
local paint-aware target, but the randomized full E2E gate is currently flaky
and physical iPhone Safari verification remains mandatory before release
acceptance.
