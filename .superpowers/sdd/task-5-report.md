# Task 5 final verification report

## Status

**DONE_WITH_CONCERNS.** All fresh automated, Chromium emulation, adverse-network,
and laptop checks passed their stated thresholds. A physical iPhone was not
connected, so Safari Web Inspector acceptance remains outstanding and is not
claimed.

## Revision and evidence

- Production revision verified: `de7f82f` (`fix: disable pending action pickers`).
- Required commands: `npm test` exit 0 (24 files/214 tests); `npm run check`
  exit 0 (0 errors/0 warnings); `npm run build` exit 0; `npm run e2e` exit 0
  (16 tests).
- Task 3 evidence was revalidated by the full Playwright run: the measured
  acknowledgement test passed and verifies under-50-ms pending UI, persistence
  while authority is held, disabled duplicate actions, and authoritative clear.
- Fresh Task 4 trace: 390×844 touch, 4× CPU, Fast 4G; card action; actor-frame
  Layout 0.532 ms total/max; UpdateLayoutTree 9.194 ms total, 1.408 ms max; raw
  trace 888,067 bytes at `.superpowers/sdd/task-4-trace.json`.
- Fresh Task 5 measurement harness: `.superpowers/sdd/task-5-profile.mjs`.

## Timing metrics (ms)

| Profile | Tap | Local | INP | Authority |
|---|---|---:|---:|---:|
| Mobile Fast 4G, 4× CPU | first card | 5.3 | 56 | 33.9 |
| Mobile Fast 4G, 4× CPU | warm card | 4.1 | 72 | 21.9 |
| Mobile Slow 4G, 4× CPU | first card | 4.0 | 56 | 31.7 |
| Mobile Slow 4G, 4× CPU | warm card | 4.6 | 80 | 51.2 |
| Laptop | first card | 1.9 | 56 | 16.2 |
| Laptop | warm card | 0.8 | 56 | 18.3 |

The Slow-4G run is automated adverse-network coverage with real local
Vite/Worker/WebSocket flows. Pending state cleared authoritatively on every
measured action. The full E2E suite separately passed reconnection cases.

## Outstanding physical-device gate

Use macOS Safari **Develop > [iPhone] > [Wildcard tab]** and record Timelines for
at least ten playable-card and ten draw-pile taps on the tester-reported device
and network. Require every local pending paint under 50 ms, warm interaction
latency under 100 ms, exactly one outbound intent per tap, authoritative state
always replacing pending state, and unchanged reconnection behavior. Repeat
once under degraded network. This work cannot be certified without the device.

## Concerns

- Chromium/CDP emulation cannot represent Mobile Safari, device thermals, GPU
  behavior, radio scheduling, or the tester's real internet path.
- The measurement harness selected playable cards in these randomized games;
  the existing full E2E suite covers draw-pile pending behavior, but physical
  acceptance must explicitly measure both card and draw taps.
- Documentation commit SHA will be recorded after the commit is created.
