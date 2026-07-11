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
- Verify unit, type/Svelte, build, browser, emulated-network, laptop, and
  physical-iPhone behavior.

## Automated verification — 2026-07-11

All required commands were run fresh from the feature worktree:

| Command | Result |
|---|---|
| `npm test` | exit 0; 24 files, 214 tests passed |
| `npm run check` | exit 0; 0 errors, 0 warnings |
| `npm run build` | exit 0; Vite production and PWA build completed |
| `npm run e2e` | exit 0; 16 Playwright tests passed |

The Playwright suite includes the Task 3 transport hold: local acknowledgement
must render under 50 ms, remain present while the real inbound WebSocket frame
is held, prevent duplicate controls, and clear when authority is released.

## Repeatable Chromium measurements

Chrome was driven through Playwright/CDP against local Vite and Wrangler. Mobile
runs used a 390×844 touch viewport and 4× CPU slowdown. Timings are milliseconds
from trusted `pointerdown`; local pending UI, Event Timing interaction duration
(INP candidate), and authoritative pending-state cleanup were recorded
separately.

| Profile | Tap | Action | Local | INP | Authoritative |
|---|---|---|---:|---:|---:|
| Mobile Fast 4G (60 ms, 4/3 Mbps) | first | card | 5.3 | 56 | 33.9 |
| Mobile Fast 4G | warm | card | 4.1 | 72 | 21.9 |
| Mobile Slow 4G (150 ms, 1.6/0.75 Mbps) | first | card | 4.0 | 56 | 31.7 |
| Mobile Slow 4G | warm | card | 4.6 | 80 | 51.2 |
| Laptop (1440×900, 1× CPU) | first | card | 1.9 | 56 | 16.2 |
| Laptop | warm | card | 0.8 | 56 | 18.3 |

This localhost throttling run proves local feedback remains independent of the
emulated adverse network and that authoritative state replaces pending state. It
does not model internet routing or a physical device.

The fresh Fast-4G warm-card trace (`.superpowers/sdd/task-4-trace.json`) was
filtered to actor frame `578F6C42061952C33272A2CE5FB1D43D`: `Layout` totaled
0.532 ms (largest 0.532 ms); `UpdateLayoutTree` totaled 9.194 ms (largest
1.408 ms). The forced-layout gate therefore remains below 8 ms and no animation
production change is warranted.

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

Final status: **DONE_WITH_CONCERNS** — automated/emulated gates pass; physical
iPhone Safari verification remains mandatory before release acceptance.
