# Final review fixes report

## Implementation

- Centralized the duplicate-action guard in `Session.sendAction`, which now returns `false` when an action is already pending or no guest transport exists.
- Kept the RoundEnd “Next round” button natively disabled while any action is pending and added a visible `Dealing…` pending label.
- Added monotonically increasing client intent IDs. The room echoes an ID only on the acting player's successful view or error; broadcasts to other players carry no acknowledgement.
- Passed optional intent IDs through `GuestSession` and clear `Session.pendingAction` only when the inbound acknowledgement matches the pending ID.

## RED evidence

Before production changes:

```text
npm test -- tests/ui/session.test.ts tests/net/guest.test.ts tests/net/room.test.ts
Test Files  3 failed (3)
Tests       5 failed | 44 passed (49)
```

The failures demonstrated duplicate `nextRound` sends, pending state without a guest, missing GuestSession acknowledgement forwarding, missing actor-only room acknowledgement, and missing error acknowledgement.

## GREEN evidence

```text
npm test -- tests/ui/session.test.ts tests/net/guest.test.ts tests/net/room.test.ts
Test Files  3 passed (3)
Tests       49 passed (49)

npm test
Test Files  24 passed (24)
Tests       219 passed (219)

npm run check
svelte-check found 0 errors and 0 warnings

npm run build
vite build: exit 0

npm run e2e
17 passed
```

## Protocol compatibility

The protocol remains version 2 and `intentId` is optional on both client intents and server views/errors. This supports a Worker-first rollout: older clients can omit the field and continue operating without crashes, while an upgraded Worker echoes IDs for upgraded clients. Unknown, malformed, negative, or unsafe IDs are treated as absent. Successful acknowledgements are attached only to the acting player's redacted view; other players receive the same authoritative broadcast without that ID.

The upgraded frontend requires an upgraded Worker to receive correlated acknowledgements, so deployment order is Worker first, frontend second. Keeping the field optional avoids disconnecting older clients during that interval.

## Recovery and concerns

- Unrelated queued broadcasts and unrelated errors no longer clear pending controls.
- Explicit session teardown still clears pending state. A transport loss preserves the pending intent through recovery rather than guessing whether it was applied; without a matching acknowledgement, the user must leave/rejoin to abandon that uncertain action. This is conservative but can leave controls pending if an acknowledgement is permanently lost.
- `GuestSession.sendMsg` still intentionally swallows synchronous transport-send errors; connection recovery remains responsible for surfacing channel failure.
- The optional audio retry and source-regex mount-test findings were not expanded into this fix wave.

Implementation commit: `47efebf711b1c37885d444b57e11add15cd76121`
