# Task 3 report: immediate authoritative-safe tap acknowledgement

## Result

The table now reflects `session.pendingAction` with `aria-busy`, disables duplicate game-action controls, and retains a pressed/pulsing state on the selected card until the next authoritative view or error clears the session state. No `PlayerView` data is mutated locally.

## RED evidence

Command:

`npx playwright test e2e/game.spec.ts --grep "acknowledges a tap immediately"`

Result before production changes: **1 failed**. The regression timed out with `pending acknowledgement not rendered`, demonstrating that neither `aria-busy` nor persistent selected-card feedback existed.

## GREEN evidence

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: 24 files passed, 214 tests passed.
- Focused regression repeated three times: 3 passed.
- `git diff --check`: clean.

## Timing evidence

The browser test measures `performance.now()` from the synchronous card click until a `MutationObserver` sees both `aria-busy="true"` and `.action-pending`, and asserts the elapsed time is below 50 ms. This passed in all three fresh repeated runs. The test then holds the real server response for 150 ms and confirms pending UI persists before releasing the queued frame and observing authoritative cleanup.

## Delayed-response harness choice

The existing browser transport assigns `WebSocket.onmessage`. A Playwright init script subclasses the native WebSocket and queues calls to that assigned incoming-message handler while the test hold is active. This is test-only, keeps the real Worker/Durable Object and outbound action path intact, and delays the actual authoritative response without adding a production hook.

## Files

- `e2e/game.spec.ts`
- `src/ui/screens/Table.svelte`
- `src/ui/components/CardFace.svelte`
- `src/app.css`

## Commit

Pending at report creation; final SHA recorded in the handoff.

## Self-review / concerns

- Pending presentation is derived from session state; the only local value is the clicked card ID used for visual targeting, and it is cleared when pending session state clears.
- Wild cards acknowledge after color selection, when the action is actually sent, rather than when the color picker is opened.
- The WebSocket shim is intentionally confined to this Playwright test and does not alter production transport behavior.

## Review fixes

Follow-up review identified that color and swap-target picker controls could remain accessibly enabled during their pending actions. Both picker APIs now accept a `disabled` state, Table passes `actionPending`, and the swap callback also guards against a duplicate send.

The expanded Playwright regression covers:

- draw acknowledgement using the guaranteed enabled draw pile rather than a randomized non-wild card;
- native disabled semantics for all color choices during `chooseColor` pending state;
- native disabled semantics for the swap target during `chooseSwapTarget` pending state;
- outbound intent counts remaining unchanged after forced duplicate clicks;
- pending state persisting while inbound authority is held and clearing only after the real server view/error is released;
- browser context cleanup through `try/finally`.

Follow-up RED:

`npx playwright test e2e/game.spec.ts --grep "color and swap choices"` failed on the behavioral assertion: all four color buttons remained enabled (`Expected: true`, `Received: false` for every button being disabled). This RED was verified with the picker-disable production changes temporarily removed while retaining the completed real-game harness.

Fresh GREEN verification:

- `git diff --check`: clean.
- `npm run check`: 0 errors and 0 warnings.
- `npm test`: 24 files passed, 214 tests passed.
- `npx playwright test e2e/game.spec.ts --grep "acknowledges a tap immediately|color and swap choices" --repeat-each=3`: 6 passed.

The fix commit SHA is recorded in the task handoff because the report must be staged before that SHA exists.
