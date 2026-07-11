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
| `npm run e2e` | exit 0; 17 Playwright tests passed in 17.7 s |

The earlier randomized simulation timeouts were diagnosed as a test-driver
assumption, not server state or a production `pendingAction` failure.
`actIfPossible()` selected `.playable.first()`, which can be fully covered in the
fanned hand. A direct test-driver dispatch also needed one reactive settle
boundary so the duplicate guard could update controls before the next simulated
move. A focused regression failed before the helper fix and passes afterward;
both formerly timing-out tests then passed individually (2.1 s and 2.5 s), and
the fresh full suite passed 17/17. Production code was unchanged.

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
| Mobile 390×844, 4× CPU | card | 7.7 | 32.7 | 25.3 | — |
| Mobile 390×844, 4× CPU | draw | 7.9 | 32.7 | 28.3 | — |
| Same, authority released 400 ms from tap | card | 8.8 | 30.1 | 414.8 | 12.9 |
| Same, authority released 400 ms from tap | draw | 4.5 | 30.8 | 412.5 | 10.3 |
| Laptop 1440×900 | card | 1.2 | 30.8 | 17.5 | — |
| Laptop 1440×900 | draw | 1.2 | 29.9 | 16.2 | — |

The held cases queue inbound WebSocket handler delivery and schedule release
400 ms from recorded `pointerdown` (observed 401.9–402.2 ms), not 400 ms after
the second-rAF boundary. Pending feedback renders before release and authority
then clears it; this is not a network-speed measurement. A deliberate second
touchscreen tap while pending left outbound intent delta exactly 1 for both
actions. Event Timing was inconsistent for synthetic taps, so no automated INP
claim is made. Actual INP and real adverse-network behavior remain physical
device gates.

The benchmark scans all playable non-wild cards for a real `elementFromPoint`
hit and uses `page.touchscreen.tap()` at that coordinate. A deterministic setup
fallback advances legal actions until a measurable card exists. Draw taps use
the visible enabled draw pile. Both action types are measured normally and with
authority held.

### Exact corrected benchmark stdout

```text
{"scenario":"mobile-390x844-4x-cpu","code":"SE4YZ","measurements":[{"phase":"card","action":"play-card","holdMs":0,"domMutationMs":7.7,"secondRafPaintBoundaryMs":32.7,"inpMs":0,"authorityFromTapMs":25.3,"releaseFromTapMs":null,"authorityAfterReleaseMs":null,"outboundIntentDelta":1},{"phase":"draw","action":"draw-card","holdMs":0,"domMutationMs":7.9,"secondRafPaintBoundaryMs":32.7,"inpMs":0,"authorityFromTapMs":28.3,"releaseFromTapMs":null,"authorityAfterReleaseMs":null,"outboundIntentDelta":1}]}
{"scenario":"mobile-390x844-4x-cpu-inbound-held-400ms","code":"CW74R","measurements":[{"phase":"card","action":"play-card","holdMs":400,"domMutationMs":8.8,"secondRafPaintBoundaryMs":30.1,"inpMs":88,"authorityFromTapMs":414.8,"releaseFromTapMs":401.9,"authorityAfterReleaseMs":12.9,"outboundIntentDelta":1},{"phase":"draw","action":"draw-card","holdMs":400,"domMutationMs":4.5,"secondRafPaintBoundaryMs":30.8,"inpMs":88,"authorityFromTapMs":412.5,"releaseFromTapMs":402.2,"authorityAfterReleaseMs":10.3,"outboundIntentDelta":1}]}
{"scenario":"laptop-1440x900","code":"2WZK9","measurements":[{"phase":"card","action":"play-card","holdMs":0,"domMutationMs":1.2,"secondRafPaintBoundaryMs":30.8,"inpMs":0,"authorityFromTapMs":17.5,"releaseFromTapMs":null,"authorityAfterReleaseMs":null,"outboundIntentDelta":1},{"phase":"draw","action":"draw-card","holdMs":0,"domMutationMs":1.2,"secondRafPaintBoundaryMs":29.9,"inpMs":0,"authorityFromTapMs":16.2,"releaseFromTapMs":null,"authorityAfterReleaseMs":null,"outboundIntentDelta":1}]}
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

Final status: **DONE_WITH_CONCERNS** — all automated gates pass; physical iPhone
Safari verification remains mandatory before release acceptance.
