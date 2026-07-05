# UNO PWA — Design

**Date:** 2026-07-05
**Status:** Approved

## Goal

A free, installable web app for playing UNO online with friends, hosted entirely on
GitHub Pages. Motivation: existing UNO apps are poorly reviewed (ads, disconnects,
missing house rules). Success means a friend group can open the GitHub Pages link,
share a room code, and play a full, correct game of UNO on their phones.

## Scope

- **In:** private rooms (2–6 players), official UNO rules, host-configurable house
  rules, round scoring with session running totals, PWA install + offline shell,
  guest reconnection.
- **Out (v1):** public matchmaking, bots/offline play, accounts, host migration,
  chat, spectators.

## Architecture

Static site, no backend. Vite + TypeScript, deployed to GitHub Pages by GitHub
Actions on push to `main`. Three layers with strict boundaries:

### 1. Game engine (`src/engine/`)

Pure TypeScript, no dependencies, no DOM, no networking. The complete UNO ruleset
as a deterministic state machine:

- `GameState` — deck, discard pile, per-player hands, turn order/direction, current
  color, pending draw stack, UNO-call flags, scores, rule config.
- `Action` — discriminated union of player intents: `playCard`, `drawCard`,
  `chooseColor`, `callUno`, `catchUno`, `challengeWildFour`, `jumpIn`, `passTurn`.
- `apply(state, playerId, action) → newState | RuleError` — validates and applies.
- `redact(state, playerId) → PlayerView` — the state a given player is allowed to
  see (own hand, opponents' card *counts* only, top of discard, whose turn).
- Seeded shuffle for deterministic tests.

### 2. Networking (`src/net/`)

WebRTC star topology using PeerJS with its free public broker for signaling.

- **Host-authoritative:** the room creator's browser owns the single true
  `GameState`. Guests connect directly to the host.
- Room code = short human-friendly code (e.g. 4–5 chars) mapped onto the PeerJS
  peer ID; joining via typed code or `#/join/CODE` link.
- Guests send intents; host validates via the engine and broadcasts each player
  their own redacted `PlayerView`. Guests never receive other players' hands, so
  dev-tools snooping cannot reveal them.
- Message protocol versioned (`{v, type, payload}`) so stale cached clients fail
  loudly rather than desync.

### 3. UI (`src/ui/`)

Svelte 5 components. Renders `PlayerView` + lobby state; contains **no game
rules** — every affordance (playable-card highlighting etc.) comes from engine
helper functions so UI and host can never disagree.

## Game flow

1. **Home:** Create room / Join room.
2. **Lobby:** players pick a display name; host sees house-rule toggles and a
   Start button (enabled at 2+ players). Room code and share link shown large.
3. **Round:** normal UNO play. Round ends when a player empties their hand.
4. **Scoreboard:** official UNO scoring (number cards face value, action cards 20,
   wilds 50) summed from opponents' remaining hands. Session running totals shown.
   "Play again" starts a new round in the same room.

## Rules

**Official baseline:** 108-card deck; 7 cards dealt each; match color/number/symbol;
skip, reverse (acts as skip in 2-player), draw-two, wild, wild-draw-four;
draw one card if unable to play (playable drawn card may be played immediately);
wild-draw-four legal only with no matching-color card, challengeable; "UNO" must be
called at one card — opponents may catch a missed call (2-card penalty).

**House-rule toggles (host-set, per room):**

- **Stacking:** +2 stacks on +2, +4 on +4; accumulated total passes on.
- **Jump-in:** an identical card (color and face) may be played out of turn.
- **Draw-until-playable:** instead of drawing one, draw until you can play.
- **7-0:** playing a 7 swaps hands with a chosen player; playing a 0 rotates all
  hands in direction of play.

## Error handling & resilience

- **Guest disconnect:** host holds the seat. Guest rejoins with the room code plus
  a session token stored in `localStorage`, and receives their hand and current
  state. While a player is disconnected the host may **wait** or **skip their
  turns**; a seat vacated permanently is dealt out (cards returned to the deck).
- **Host disconnect:** game over — remaining players see a clear "host left" screen.
  Host's browser shows a leave-confirmation warning while a game is live.
- **WebRTC unavailable/blocked:** detected at connection time; plain-language
  message explaining the network is blocking the connection (no infinite spinner).
- **Invalid intents** (double-click races, stale turns): host rejects; guest UI
  reconciles to the next broadcast view. UI is optimistic only for the local
  player's obviously-legal plays.

## PWA

`vite-plugin-pwa`: web manifest, icon set, service worker precaching the app shell
(instant load, works offline to the home screen; play requires a connection).
Update flow: the service worker auto-updates on next load (no toast) — protocol
version mismatch between host and guest surfaces an explicit "update your app"
error.

## Visual design

Built with the frontend-design skill. Requirements: mobile-first table layout
(portrait phone is the primary device); distinctive, deliberate art direction —
not template gradients or stock AI-slop styling; readable custom card faces
(no Mattel assets — original design, generic name treatment); satisfying
play/draw animations; `prefers-reduced-motion` respected; touch targets ≥ 44px.

## Testing

- **Engine:** Vitest unit tests for every rule and every house-rule toggle,
  including edge cases (deck exhaustion → reshuffle discard, reverse-as-skip in
  2-player, wild-draw-four challenge outcomes, stacking totals, catching UNO).
  Seeded decks make every scenario reproducible.
- **E2E:** Playwright with multiple browser contexts playing real games over the
  actual networking layer: create → join → full round to a win; guest disconnect
  and rejoin; house rules honored end-to-end.
- **Live verification:** after deploy, load the production GitHub Pages URL,
  create a room, and confirm a second context can join.
