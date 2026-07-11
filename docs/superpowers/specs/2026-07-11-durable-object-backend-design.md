# Durable Object backend design

**Date:** 2026-07-11
**Status:** Implemented
**Supersedes:** the networking section of `2026-07-05-uno-pwa-design.md` and all of `2026-07-08-turn-server-design.md`

## Goal

Eliminate the connectivity failure modes inherent to the P2P WebRTC
architecture — NAT/firewall traversal, the free public PeerJS broker, public
TURN credentials in the client bundle, and the structural weakness that the
host's browser tab *is* the server — by moving the authoritative game room
into a Cloudflare Durable Object reached over plain WebSockets.

## Architecture

- **One Durable Object per room code** (`worker/src/room-do.ts`, class
  `RoomDO`, addressed via `idFromName(code)`). The Worker entry
  (`worker/src/index.ts`) routes `GET /room/:code` WebSocket upgrades to it
  and serves `/` as a health check.
- **Every player is a client.** The first `hello` with `create: true` claims
  seat `p0` and its host powers (start, rules, skip, remove — enforced
  server-side). Protocol v2 lives in `src/net/protocol.ts` and is shared by
  bundling; the room logic (`src/net/room.ts`, `RoomSession`) is the old
  host-browser `HostSession` made transport-agnostic, still unit-tested over
  in-memory loopback pairs.
- **Hibernation-first.** Sockets are accepted through the WebSocket
  Hibernation API; `"ping"` frames are answered by an auto-response pair
  without waking the object. After every event the room state is snapshotted
  to storage (`RoomSession.snapshot()`); on wake it is restored and live
  sockets are re-bound to their seats via a serialized seat token
  (`reattach`). An alarm purges rooms with no live sockets after ~12h.
- **Identity is the seat token** (unchanged): minted per seat, persisted
  client-side per room code, and used to reclaim the seat after any drop —
  which now works for the host too, because the room outlives everyone's
  tabs. Pre-game guest drops free the seat (auto-rejoin seats them fresh);
  the p0 seat is always reserved since it is the room's identity. A
  deliberate host leave broadcasts `closed` and purges the room.
- **Client transport** is `src/net/socket.ts`: a `Connection` wrapper over a
  browser WebSocket with app-level ping health (silence → `unstable` →
  cut), feeding the existing recovery state machine. Lobby drops now recover
  in place instead of being fatal.

## Deployment

Frontend stays on GitHub Pages; `VITE_WS_URL` (repo variable) points it at
the deployed worker. CI deploys the worker with `wrangler deploy` using
`CLOUDFLARE_API_TOKEN` (secret) and `CLOUDFLARE_ACCOUNT_ID` (variable).
SQLite-backed DO classes (`new_sqlite_classes`) keep it on the free plan.
Dev and e2e run against a local `wrangler dev` on `:8787` (the Playwright
config boots it as a webServer, with `GAME_SEED` for deterministic deals).

## Removed

PeerJS (+ the `peer` broker devDep), all WebRTC/ICE/TURN code
(`src/net/peer.ts`, `src/net/ice.ts`, `scripts/verify-turn.mjs`), the
`VITE_TURN_*` build settings, and the host-side special path in
`src/ui/session.svelte.ts` (`HostSession` in the browser).
