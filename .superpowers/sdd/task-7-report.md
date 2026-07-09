# Task 7 Report: Transport, deduplicate and queue public notices

## Summary

Implemented public notice transport on `view` messages, added queue/history helpers in `src/ui/notice-queue.ts`, and wired session-level notice history, queue, current notice, and dismissal timing into `src/ui/session.svelte.ts`.

## Files Changed

- `src/net/protocol.ts`
- `src/net/host.ts`
- `src/net/guest.ts`
- `src/ui/notice-queue.ts`
- `src/ui/session.svelte.ts`
- `tests/ui/notice-queue.test.ts`
- `tests/net/host.test.ts`
- `tests/net/guest.test.ts`

## TDD Workflow

1. Added failing tests first:
   - `tests/ui/notice-queue.test.ts`
   - host transport assertion in `tests/net/host.test.ts`
   - guest optional-notices assertion in `tests/net/guest.test.ts`
2. Ran the required red command:
   - `npm test -- tests/ui/notice-queue.test.ts tests/net/host.test.ts tests/net/guest.test.ts`
3. Confirmed RED for the expected reasons:
   - missing `src/ui/notice-queue.ts`
   - missing optional `notices` transport on `view`
4. Implemented the minimal protocol, transport, queue, and session changes.
5. Re-ran the focused suite to GREEN:
   - `npm test -- tests/ui/notice-queue.test.ts tests/net/host.test.ts tests/net/guest.test.ts`
6. Ran required broader verification:
   - `npm run check`

## Implementation Notes

### Protocol and transport

- Added optional `notices?: PublicNotice[]` to `ServerMsg` for `type: 'view'`.
- Kept `PROTOCOL_VERSION` at `1` because the field is additive and optional.
- Updated `HostEvents.onView` and `GuestEvents.onView` to accept optional notices.
- Updated `GuestSession` to pass `msg.notices` through unchanged.

### Host broadcast behavior

- `handleIntent()` now derives notices, stores them in `lastNotices`, and broadcasts them with the resulting views.
- `skipTurn()` now broadcasts the accumulated notices it already derives through forced actions.
- `removeSeat()` now broadcasts any resulting state notices, including `roundWin`.
- `setConnected()` now emits a single `disconnect` or `reconnect` notice only when the connection flag actually changes, then broadcasts that notice with the redacted views.
- `broadcastViews(notices = [])` now sends the same public notices to every seat while still redacting each player’s `PlayerView` independently.

### Queue helpers

- Added `mergeNoticeHistory(current, incoming, limit = 3)`:
  - deduplicates by notice id
  - sorts by id
  - retains only the newest `limit` notices
- Added `appendNoticeQueue(current, incoming)`:
  - preserves queue order
  - appends only notices whose ids are not already queued

### Session queue state

- Added session state:
  - `noticeHistory`
  - `noticeQueue`
  - `currentNotice`
  - `noticeTimer`
- `handleView(view, notices = [])` now:
  - merges bounded history
  - appends deduplicated queue items
  - starts the 2400ms dismissal timer when a queue becomes non-empty
  - preserves the older `deriveViewChange()` banner/effects path only when no notices are supplied, so older hosts still work
- Added `dismissCurrentNotice()` to pop the queue and reschedule the next dismissal.
- `leave()` now clears notice history, queue, and timer state.

## Tests Added or Updated

### `tests/ui/notice-queue.test.ts`

- verifies merge history deduplicates by id and keeps the latest three notices

### `tests/net/host.test.ts`

- verifies `view` messages carry public notices with integer ids after a successful action

### `tests/net/guest.test.ts`

- verifies `GuestSession` forwards optional `notices` to `onView`

## Verification

### Focused test command

```bash
npm test -- tests/ui/notice-queue.test.ts tests/net/host.test.ts tests/net/guest.test.ts
```

### Focused test result

```text
Test Files  3 passed (3)
Tests  21 passed (21)
```

### Type/check command

```bash
npm run check
```

### Type/check result

```text
svelte-check found 0 errors and 0 warnings
```

## Self-Review

- Confirmed only the eight Task 7 code/test files were changed for implementation.
- Left the dirty requirement docs in `docs/superpowers/...` untouched and unstaged.
- Verified the optional protocol field remains backward-compatible.
- Checked that connection notices do not fire on token-takeover reconnects unless the seat’s connected state truly changed.
- Checked that queue deduplication is id-based and history remains bounded to three entries.

## Concerns

- Session queue timing and dismissal are covered indirectly through typecheck and helper/transport tests, but there is not yet a dedicated session-level test around timer-driven dismissal behavior.
