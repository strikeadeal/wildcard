# WILDCARD Clarity-First Polish Design

**Date:** 2026-07-08  
**Status:** Approved design  
**Target:** A focused professional-polish release, followed by a separately prioritised roadmap

## Summary

WILDCARD is functionally complete. Its host-authoritative engine, redaction boundary,
PeerJS room model, house rules, PWA shell, and core multiplayer loop all work. No
material UI component inspected is a placeholder or stub.

The next release should therefore improve clarity rather than add more game rules.
It should make three outcomes reliable:

1. A new player understands “name, then host or join” within three seconds.
2. During play, every player can identify whose turn it is, what just happened,
   and what they can do next at a glance.
3. Connection failures preserve context, explain what happened, and offer only
   actions that can realistically succeed.

The release preserves the no-backend P2P architecture, existing rules and scoring,
the free/no-account/no-ad positioning, and the current visual direction.

## Evidence gathered

The review used the current `main` branch at commit `4d2f6fb` and included:

- installation and local Vite execution;
- two complete two-player rounds over PeerJS;
- an additional partial round to force a wild-colour choice;
- real Jump-in, stacking, 7-0 hand swap, missed-last-card Catch, correct last-card
  call, guest disconnect/rejoin, host tab closure, late join, malformed code, and
  wild-colour flows;
- desktop and 390×844 mobile inspection;
- complete reads of `src/engine/*`, `src/net/*`, `src/ui/screens/*`,
  `src/ui/components/*`, plus session, motion, event and PWA configuration;
- unit, type/Svelte, production-build and real-WebRTC e2e verification.

Observed outcomes:

- guest rejoin restored the exact six-card hand;
- a host closure was eventually detected by the guest, after roughly 15 seconds;
- the first two complete rounds both ended normally;
- the 390×844 game table fit without document overflow;
- a two-player mobile lobby measured 917px high in an 844px viewport, putting
  Start/Leave below the initial fold;
- the offline build generated a 17-entry Workbox precache;
- 116 unit tests passed, `svelte-check` reported no diagnostics, and production
  build succeeded;
- one of three e2e tests passed; two timed out because the test helper observed
  the draw button enabled, then waited indefinitely after it became disabled
  before `click()` completed.

## What already works well

### Engine and network

- `src/engine/apply.ts` is the single authoritative action validator.
- `src/engine/redact.ts` gives peers only their own hand and public table data.
- `PlayerView` exposes precomputed affordances, keeping rules out of UI code.
- room codes avoid ambiguous characters and accept lowercase, separators and
  pasted join links.
- token-based guest rejoin preserves the original seat and hand.
- disconnected guests remain represented rather than being silently deleted.
- host powers already exist to skip an absent player or remove their seat.
- a 20-second bound prevents an infinite PeerJS connection spinner.

### UI and motion

- the felt/card-stock visual direction is coherent and distinctive;
- touch targets are generally 44–48px or larger;
- cards are legible, playable cards lift clearly, and horizontal hand scrolling
  works on a 390px-wide phone;
- current effects include initial dealing, play-to-discard motion, opponent draw
  ghosts, card-count pulses, skip and reverse beats, penalty pops, UNO pops,
  round-end count-up and confetti;
- reduced-motion handling covers CSS, Svelte transitions, Web Animations and
  canvas effects;
- the manifest, icons, portrait preference, viewport-fit metadata and offline
  app shell are present.

These foundations should be refined rather than replaced.

## Concrete gaps

### First impressions and onboarding

| Gap | Evidence | Files |
| --- | --- | --- |
| Host and join are visually adjacent actions beneath one shared name field, but neither path explains what will happen next. | The screen is attractive, yet relies on button labels alone for the room model. | `src/ui/screens/Home.svelte` |
| Malformed codes are reported in a transient global toast rather than beside the field. | `O0I1L` produced “Room codes are 5 letters/numbers…” while leaving the field unchanged. | `Home.svelte`, `src/ui/App.svelte`, `src/ui/session.svelte.ts` |
| Busy state removes affordance but does not identify the active operation. | Both actions become disabled while the screen changes to a generic spinner. | `Home.svelte`, `Connecting.svelte` |
| Fatal join outcomes have only Back to start, even when Create a room or Check code is the natural recovery. | Confirmed for Game in progress and Room not found. | `Fatal.svelte`, `session.svelte.ts` |

### Feedback and “juice”

| Gap | Evidence | Files |
| --- | --- | --- |
| Only one animation event can survive each view transition. | `deriveEvent()` deliberately returns the “single most salient” event, so compound events lose information. | `src/ui/events.ts` |
| Penalty banner semantics are misleading. | When pending draw rises, copy is based on the next turn holder: “Bob draws +2” can appear before Bob has drawn and when Alice actually played the card. | `events.ts` |
| Announcement replacement can hide rapid events. | `showBanner()` stores one string and resets one timer. | `session.svelte.ts`, `Announce.svelte` |
| Multiple-card opponent draws animate as one ghost. | The event contains `n`, but `ghostDraw()` spawns one card back. | `AnimationLayer.svelte` |
| Jump-in is visual but unexplained. | An out-of-turn matching card lifts as playable, with no accompanying “Jump in now” prompt. | `Table.svelte`, `CardFace.svelte` |
| No recent public action remains after transient effects disappear. | Half-watching players cannot reconstruct the previous turn. | `Table.svelte`, `events.ts` |

### Error and edge-case handling

| Gap | Evidence | Files |
| --- | --- | --- |
| Connecting is a dead-simple spinner with no operation, elapsed-state or expected delay. | Room discovery may legally take up to 20 seconds. | `Connecting.svelte`, `session.svelte.ts` |
| All guest connection closures initially offer Rejoin, even when the host has gone. | Closing the host produced Connection lost → Rejoin my seat → Room not found. | `Fatal.svelte`, `session.svelte.ts` |
| The frozen game gives no early warning while ICE failure detection settles. | Host closure took about 15 seconds to become Fatal. | `src/net/peer.ts`, `transport.ts`, `session.svelte.ts` |
| Host removal controls appear only when the disconnected player owns the turn. | `stuckPlayer` gates both Skip and Remove. | `Table.svelte` |
| Permanent seat removal has no confirmation. | One tap can deal a guest out permanently. | `Table.svelte`, `host.ts` |
| Rejection screens discard useful recovery choices. | Full, started, bad-token and not-found have accurate copy but a single generic exit. | `Fatal.svelte`, `session.svelte.ts` |
| A stale action is only a generic toast. | The UI does not distinguish harmless resync from connection failure. | `session.svelte.ts`, `App.svelte` |

### Mobile and PWA feel

| Gap | Evidence | Files |
| --- | --- | --- |
| Safe-area padding is incomplete. | The table bottom and toast account for it; Home, Lobby, Connecting, Fatal and the table top do not. | screen styles, `Table.svelte`, `App.svelte`, `app.css` |
| Primary lobby controls can begin below the fold. | Two-player lobby: 917px content at 844px viewport height. | `Lobby.svelte`, `RuleToggles.svelte` |
| Installation has no in-app affordance. | The manifest is installable, but there is no `beforeinstallprompt` flow or iOS guidance. | `App.svelte`, `Home.svelte`, new install component/state |
| Offline shell and offline multiplayer are not distinguished in UI. | Workbox precaches the shell, but Create/Join still lead into connection failure copy. | `session.svelte.ts`, `Home.svelte` |
| No haptic feedback exists. | No vibration API use was found. | none currently |

Haptics are intentionally deferred from this release unless paired with a user
control. They are enhancement, not clarity.

### Visual and typographic polish

| Gap | Evidence | Files |
| --- | --- | --- |
| Spacing values are independently hard-coded across screens. | Similar structures use 14, 16, 18 and 22px gaps without shared rhythm tokens. | `app.css`, screen/component styles |
| The font works but produces a build-resolution warning. | Production build leaves `./fonts/Fraunces.woff2` unresolved at build time, then relies on runtime public-path resolution. | `index.html`, font asset placement |
| Active-turn emphasis competes with the centre status pill. | Opponent glow and central copy are separated, requiring two glances. | `Table.svelte`, `OpponentSeat.svelte` |
| Scores are hidden during the round despite being present in every view. | `OpponentView.score` is rendered only in RoundEnd. | `OpponentSeat.svelte`, `Table.svelte` |

The existing contrast palette, card-face treatment and display/body type pairing
should remain. They are not the source of the unfinished feeling.

### Social and party-game clarity

- Turn ownership should be obvious from across a table, not only to the person
  holding the phone.
- Every transient event needs a short textual equivalent because players will
  look away.
- Pending penalties need to say who created them, who faces them and what the
  recipient can do.
- Jump-in needs an explicit time-sensitive cue.
- Disconnect status should remain visible on the player seat, with host recovery
  actions collected in one place.
- The latest two or three public actions should remain available without turning
  the game into a dense activity log.

## Approved release design

### 1. Home and joining

Retain one shared name field, then present two unmistakable paths:

- **Host a game** — “Create a code and choose the house rules.”
- **Join a game** — code field and “Join room.”

Validation appears beneath the code field before navigation. The selected action
shows progress text such as “Creating room…” or “Finding room…”. Deep-link code
prefill and saved-name behaviour remain unchanged.

The page keeps the current fan, wordmark and no-account positioning. It does not
add a tutorial carousel or rules manual.

### 2. Connecting and recovery

Replace the generic connecting screen with operation-specific states:

- creating a room;
- finding a room;
- joining the host;
- reconnecting to an existing seat.

Cancel remains available. Copy may change after a reasonable threshold to explain
that some networks block peer connections, but the existing hard timeout remains.

Fatal outcomes use a typed reason rather than only arbitrary title/detail strings.
Each reason maps to relevant actions:

- malformed code: edit code;
- not found/room unavailable: check code, retry once, create room, Home;
- full: create room, Home;
- started: Home, with spectator mode clearly unavailable;
- version mismatch: refresh;
- network unavailable: retry, Home;
- stale seat: delete `tokenKey(code)` immediately after a `badToken` rejection,
  then offer Home. If the game is already running, a tokenless retry will still
  receive the accurate “Game already started” outcome rather than looping.

### 3. Lobby

The lobby emphasises:

- room code and sharing;
- player readiness/count;
- that only the host can change rules and start;
- a persistent mobile footer containing Start/Waiting and Leave.

The rule list remains unchanged. It may collapse behind a “House rules” summary on
short screens, provided every rule remains editable before starting and visible to
guests.

### 4. Table clarity

Replace the generic status sentence with a pure, affordance-derived prompt:

- “Your turn — play a raised card or draw.”
- “Stack a +2 or draw 4.”
- “You drew a playable card — play it or keep it.”
- “Jump in now — you have an identical card.”
- “Choose the new colour.”
- “Choose someone to swap hands with.”
- “Waiting for Bob.”

The active seat and prompt use the same accent treatment. On the local turn, the
hand area also receives a restrained state cue so the eye moves from prompt to
available cards.

Opponent seats add compact running scores without becoming scoreboard cards.
Away state remains visible at all times. Host recovery controls are available from
the away seat; Skip once appears only when appropriate, while Remove requires
confirmation.

### 5. Public notices and action history

The current snapshot-diff effects remain as a compatibility fallback. The preferred
path introduces an explicit public notice generated by the host after a successful
engine action.

```text
player intent -> engine apply -> authoritative state
                            \-> public notice(s) -> redacted view broadcast
```

The engine rules remain unchanged. `HostSession` compares the accepted action and
before/after state to produce only facts already visible at the table.

Suggested notice shape:

```ts
type PublicNotice = {
  id: number;
  kind:
    | 'play' | 'draw' | 'penalty' | 'color' | 'skip' | 'reverse'
    | 'uno' | 'catch' | 'jumpIn' | 'swap' | 'disconnect'
    | 'reconnect' | 'roundWin';
  actorId?: string;
  targetId?: string;
  card?: { color: Color | null; value: CardValue };
  count?: number;
  color?: Color;
  pendingDraw?: number;
};
```

Notice payloads must never contain another player’s hand, drawn-card identity, or
stable private card IDs. A draw notice contains only player and count.

The view message accepts optional notices during rollout. Old clients ignore the
field; new clients fall back to `deriveViewChange()` when it is absent. This avoids
a brittle forced protocol cutover for cached PWAs.

`session.svelte.ts` owns a deduplicated queue keyed by notice ID. `Announce.svelte`
renders notices sequentially. `AnimationLayer.svelte` consumes the same notice so
copy and motion cannot contradict one another. The table retains the latest three
notices in compact form, with older entries discarded.

### 6. Connection state

`transport.ts` gains a connection-health callback distinct from terminal closure.
Expected states are connecting, connected, unstable, reconnecting and closed.

When a guest link degrades:

1. keep the last authoritative table visible;
2. overlay “Connection unstable” or “Reconnecting…”;
3. make a small bounded number of token-based rejoin attempts;
4. restore the table immediately on success;
5. otherwise end at either “Room unavailable” or “Network unavailable.”

Without a backend, an unreachable room ID cannot prove whether the host deliberately
closed the tab or became unreachable. The UI must say the room is unavailable and
explain that the host may have left; it must not claim certainty it does not have.

No game action is optimistically applied during recovery. The host remains the
authority. Host migration is not part of this release.

### 7. Mobile, PWA and accessibility

- Define reusable spacing and safe-area tokens in `app.css`.
- Apply top, inline and bottom safe-area padding to every full-screen surface.
- Keep the game table at `100dvh` and the hand internally scrollable.
- Keep lobby primary controls sticky on short portrait screens.
- Preserve the 44px minimum target and 48px primary control defaults.
- Preserve portrait as the installed-app preference without blocking browser
  landscape use.
- Show a small offline status on Home; explain that the installed shell works
  offline but room discovery and WebRTC play require connectivity.
- Treat `navigator.onLine` as an advisory signal, not a definitive gate; PeerJS
  connection results remain authoritative.
- Offer installation only to returning players or after a completed round. On
  unsupported browsers, show nothing; iOS guidance must be dismissible.
- Every animated event retains a static text/state equivalent.
- Keep `aria-live` polite for turn and notice changes; urgent connection loss may
  use assertive announcement once, without repeated screen-reader chatter.

Sound and vibration are excluded from the focused release.

## Component boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `deriveActionPrompt.ts` | Pure prompt derivation from `PlayerView` affordances | engine types only |
| `public-notices.ts` | Convert accepted public action outcomes into redaction-safe notices | action and before/after public state |
| notice queue in session | Deduplicate, order, expire and retain last three notices | optional notice stream, diff fallback |
| `Announce.svelte` | Present one queued notice accessibly | session notice queue |
| `ActionHistory.svelte` | Render the last three notices compactly | formatted public notices |
| reconnect overlay | Present connection health while retaining table context | typed session recovery state |
| install prompt | Capture install eligibility and dismissal state | browser capability only |

Each unit has one purpose and can be tested without rendering the whole game.

## Priority

### Quick wins

1. Correct penalty wording so it never says a player drew before they did.
2. Add Home hierarchy, inline code validation and operation-specific busy copy.
3. Add recovery-specific actions to Connecting/Fatal.
4. Make lobby actions sticky on short mobile screens.
5. Apply safe-area padding across all screens.
6. Add affordance-derived turn instructions, including Jump-in and stacking.
7. Expose compact scores during play.
8. Add shared spacing/motion tokens and preserve reduced-motion static states.
9. Remove the font build-resolution warning while preserving offline font loading.
10. Fix the e2e helper race and remove unbounded action-level waiting.

### Medium

1. Add the optional redaction-safe public notice pipeline.
2. Queue announcements and add the last-three-actions history.
3. Unify active-seat and local-turn emphasis.
4. Add connection-health states and frozen-table reconnect overlay.
5. Add host away-player controls with removal confirmation.
6. Add a returning-player install prompt and offline Home status.

### Larger roadmap

1. **Sound and optional haptics:** local assets and user-controlled settings; no
   backend required.
2. **Spectator mode:** a redacted, non-playing peer role; P2P-compatible but it
   expands protocol, lobby capacity semantics and host bandwidth.
3. **Host refresh persistence:** store authoritative host state locally and reclaim
   the same room ID after refresh; P2P-compatible, but recovery and stale-state
   safety need careful design.
4. **Recent-action replay:** build on public notices to re-run the last few public
   beats without exposing hands.
5. **Host migration:** designate a trusted replica, transfer full authoritative
   state, elect a successor and reclaim the room code. This is possible without a
   backend only while another peer remains connected and signalling is available.
   It also changes the trust model because a backup peer receives all hands.

None of these roadmap items should delay the clarity-first release.

## Testing strategy

### Unit

- prompt derivation for normal turns, drawn-card choice, penalties, Jump-in,
  colour and swap phases;
- notice generation for every accepted action and compound outcome;
- proof that notices contain no private hand/card identity;
- notice ordering, deduplication, expiry and three-item retention;
- typed recovery-state transitions and error-to-action mapping;
- code validation and stale-token clearing.

### Host/guest integration

- optional notices propagate through loopback transport;
- old-message fallback still drives existing effects;
- disconnect health appears before terminal closure;
- token rejoin restores the exact state and clears recovery UI;
- room-unavailable and temporary-network outcomes produce different actions;
- host skip-once and confirmed removal update every view.

### End to end

- inject or otherwise control game seeds so full-round tests are deterministic;
- scope actions to the current player and give race-prone clicks short bounds;
- if a control changes between observation and click, return “no action” and let
  the loop re-evaluate instead of waiting until the whole test times out;
- cover create/join, malformed/not-found/full/started, reconnect, host closure,
  wild colour, stacking, Jump-in, 7-0, missed and successful last-card calls;
- run at 390×844 and at least one larger phone viewport;
- verify sticky lobby controls, safe areas, horizontal hand access, keyboard use,
  reduced motion and the offline shell.

## Acceptance criteria

- A first-time tester can host or join without instruction.
- Invalid code feedback appears inline and preserves entered data.
- Lobby Start and Leave are visible without initial scrolling at 390×844.
- Every turn state produces one accurate action prompt.
- Penalty copy identifies the action and current total without claiming a draw that
  has not occurred.
- Rapid compound actions are queued and the last three public events remain visible.
- No notice reveals another player’s hand or drawn-card identity.
- Guest recovery preserves the table and seat; an unavailable room ends in a
  truthful, non-looping recovery screen that explains the host may have left.
- All screens respect safe-area insets and 44px touch targets.
- Unit, Svelte/type, build and deterministic e2e suites pass.
- Core rules, scoring and house-rule behaviour remain unchanged.

## Explicit non-goals

- accounts, analytics, ads, matchmaking or a backend;
- new game rules or scoring changes;
- chat, avatars, cosmetics or progression;
- a full tutorial or rules encyclopedia;
- sound, haptics, spectator mode, host migration or persistent rooms in this release;
- unrelated engine or styling refactors.
