# Multiplayer Reliability Design

## Purpose

Make WILDCARD recover reliably from ordinary mobile and browser network interruptions, prevent a lobby disconnect from silently destroying a player's ability to rejoin, and ensure malformed client traffic cannot destabilize a room.

The existing architecture remains intact: one Cloudflare Durable Object is authoritative for each room, and every player—including the host—is a WebSocket client identified by a server-issued seat token.

## Confirmed Problems

### Lobby seats are discarded too early

The server currently removes a disconnected non-host seat immediately while the game is still in the lobby. Reconnection normally creates a fresh seat, but there is a race: if the host starts before the player reconnects, the game is created without that seat and the old token is rejected. The disconnected player then cannot reclaim their place.

### Browser recovery stops after two attempts

The client attempts recovery immediately and once more after 1.5 seconds. A mobile radio transition, captive network, backgrounded browser, or temporary Worker reachability problem can outlast that window. Recovery then requires manual intervention even though the room and seat remain valid.

### Protocol payloads are trusted too deeply

The room checks the protocol version and top-level message type but casts nested payloads to TypeScript types without runtime validation. Malformed actions, rule configurations, or player identifiers can reach code that assumes valid objects. Invalid client input must be rejected locally at the protocol boundary and must never throw from a room event.

### Production failures lack diagnostic context

Cloudflare observability is enabled, but reconnect and rejection paths do not emit structured, token-safe lifecycle information. Production reports cannot currently distinguish transport loss, missing rooms, missing seats, malformed traffic, or exhausted browser recovery.

## Required Behavior

### Lobby seat reservation

- An accidental WebSocket close marks a lobby guest disconnected instead of deleting their seat.
- The player's existing token reclaims the same seat and player id.
- A room cannot start while any retained lobby seat is disconnected. This avoids silently beginning without a temporarily absent player.
- The host can explicitly remove a disconnected lobby seat using the existing host removal command and UI.
- A deliberate guest leave continues to remove the seat immediately.
- A deliberate host leave continues to close the room.
- Room expiry remains the final cleanup mechanism for abandoned rooms.

This deliberately avoids adding timers or a second seat-lease system. The room already has explicit host removal and twelve-hour abandoned-room expiry, so retaining lobby seats is the smallest consistent model.

### Recovery policy

- Recovery starts immediately after a confirmed transport close.
- Failed network attempts use bounded exponential delays of 0, 1, 2, 4, and 8 seconds, capped at 8 seconds for subsequent attempts.
- Automatic attempts continue while the session remains on the lobby or table and the seat outcome is unknown.
- When the browser reports offline, recovery waits rather than opening repeated sockets.
- The browser `online` event wakes a waiting recovery attempt immediately.
- Definitive server outcomes stop recovery: `notFound` becomes room unavailable; `badToken` or `started` becomes seat unavailable.
- Home, Leave, room closure, and a newer session epoch cancel pending waits and connections.
- Existing pending-action replay keeps the same intent id so recovery remains idempotent.
- The recovery overlay continues to show progress. It offers manual Retry only after a connection-attempt timeout or other recoverable transport failure; automatic recovery remains active unless the player cancels.

### Protocol validation

Introduce a focused decoder at the network boundary. It returns a validated `ClientMsg` or a stable validation failure without throwing.

Validation covers:

- protocol version and known message type;
- `hello` name, token, and create fields;
- every action discriminant and its required nested values;
- legal colors and finite integer card ids;
- complete boolean `RuleConfig` fields;
- bounded non-empty intent ids and player ids;
- commands with no payload, which reject unexpected malformed shapes only where those shapes affect behavior.

Unknown or malformed messages receive a protocol error when the socket has a seat; malformed pre-hello traffic is ignored or closed after a validation rejection. No malformed message mutates state, persists a new snapshot, or throws from the Durable Object event.

### Structured diagnostics

Emit concise JSON-compatible log records from the Worker for:

- room creation, game start, deliberate room closure, and expiry;
- socket close/error and successful seat reclaim;
- protocol rejection category;
- missing-room and missing-seat outcomes.

Records may include room code only if it is already present in the request path context, player id, protocol message type, and categorical reason. They must never include seat tokens, hands, card contents, names, or full raw messages.

Browser-side recovery exhaustion should log one development-only diagnostic with attempt count and categorical outcome. Production UI copy remains user-oriented.

## Component Boundaries

### `src/net/protocol.ts`

Owns wire types and runtime client-message decoding. Game engine code continues to consume typed actions and does not perform transport validation.

### `src/net/room.ts`

Owns seat lifecycle semantics. Disconnect marks presence; explicit leave/removal destroys a seat. Lobby start eligibility reflects retained disconnected seats.

### `src/ui/session.svelte.ts`

Owns recovery scheduling, online/offline coordination, cancellation, and adoption of a recovered `GuestSession`.

### `src/ui/App.svelte`

Forwards browser online/offline events into session recovery, not merely the home-screen status indicator.

### `worker/src/room-do.ts`

Owns Worker lifecycle diagnostics and keeps persistence behavior tied to validated session events.

## Error Handling

- Network failures are provisional and retryable.
- Server statements that a room or seat does not exist are definitive.
- Invalid client traffic is isolated to the offending connection and never affects other players.
- A reconnecting socket cannot overwrite a newer adopted connection because every asynchronous recovery step checks the session epoch and recovery generation.
- Superseded sockets remain harmless: the authoritative seat is rebound before the old connection closes.

## Test Strategy

### Unit tests

- Protocol decoder accepts every valid message variant and rejects malformed nested payloads without throwing.
- Room tests prove that an accidental lobby disconnect retains the seat, blocks start, and reclaims the same id with the same token.
- Room tests prove explicit guest leave and host removal still destroy retained seats.
- Session tests use fake timers to verify backoff, offline waiting, online wake-up, definitive rejection handling, and cancellation.
- Existing idempotent pending-action replay tests remain green.

### Real Worker end-to-end tests

- Guest disconnects in the lobby, host cannot start while the seat is away, guest reconnects to the same seat, and the game then starts.
- Guest and host recover after an outage longer than the previous two-attempt window.
- Recovery resumes when browser connectivity changes from offline to online.
- Malformed WebSocket messages do not prevent valid players from continuing.
- Deliberate guest and host leave semantics remain unchanged.
- Two players complete a seeded full round after the reliability changes.

### Completion checks

Run, in order:

1. Focused unit tests for each red-green change.
2. `npm test`.
3. `npm run check`.
4. `npm run build`.
5. Focused reconnect and malformed-message Playwright tests.
6. The complete Playwright suite.
7. A final seeded two-browser full round against local Wrangler.

## Non-Goals

- Replacing Durable Objects or WebSockets.
- Adding accounts, cross-device seat recovery, or user authentication.
- Allowing a player who explicitly left or was removed to re-enter a game already in progress.
- Protocol-level leave acknowledgements or a new reconnect-lease service.
- Changing game rules, scoring, room capacity, or the twelve-hour room expiry period.

## Acceptance Criteria

- A transient lobby disconnect cannot cause the host to unknowingly start without the reserved player.
- A player with a valid token automatically recovers from a temporary outage without manual Retry.
- Going offline and later online resumes recovery without reloading the PWA.
- Malformed client messages cannot throw, mutate room state, or interrupt valid players.
- Logs identify categorical lifecycle and rejection outcomes without exposing private game or token data.
- Intent deduplication, hibernation restore, deliberate leave behavior, house rules, and complete-round play continue to work.
