# WILDCARD

WILDCARD is the classic card game, playable free in your browser with friends —
no accounts, no ads, no app store. One person creates a room, everyone else
joins with a short code, and you play a normal hand of the game you already
know: match color or number, stack draw cards, skip and reverse, call out your
last card, and slap down a wild when you're stuck.

**Play now: https://strikeadeal.github.io/wildcard/**

## How to play

1. Open the link above and enter your name.
2. One player taps **Create a room** — this gives you a short room code.
3. Share that code with everyone else. They enter their name and the code,
   then tap **Join**.
4. Once everyone's in, the host starts the round. Play proceeds like the
   card game you grew up with: match the top card's color or number, draw
   when you can't play, and don't forget to call out when you're down to
   one card.

### House rules

The host can toggle a few common house variants before the round starts:

- **Stacking** — answer a +2 with a +2 (and a +4 with a +4); the draw pile
  keeps passing on instead of stopping with you.
- **Jump-in** — holding the exact same card as the one just played? Slam it
  down out of turn.
- **Draw to match** — keep drawing until you can play, instead of drawing
  just one card and passing.
- **7-0** — playing a 7 swaps hands with someone; playing a 0 passes every
  hand around the table.

### A note on how rooms work

Rooms are peer-to-peer: the host's browser tab *is* the game. There's no
server keeping score in the background, which means if the host closes their
tab or loses their connection, the room closes with them. Everyone else just
needs to reconnect to a new room if that happens.

### Internet connectivity and TURN

Browsers first try to connect directly over WebRTC. Production builds also use
an authenticated TURN relay when NAT or firewall rules prevent a direct path.
The relay only forwards encrypted WebRTC packets; the host browser still owns
the room and game state.

Production deployment expects these GitHub Actions settings:

- repository variable `VITE_TURN_URLS` — comma-separated UDP and TCP TURN URLs;
- repository variable `VITE_TURN_USERNAME` — the coturn application user;
- repository secret `VITE_TURN_CREDENTIAL` — the matching password.

Vite embeds all three values in browser JavaScript. The secret setting prevents
accidental repository disclosure, but the resulting TURN credential is public
and must be dedicated, quota-limited, and replaceable.

Because it's a PWA, you can install WILDCARD to your home screen for a more
app-like feel, and the app shell will still load if you open it again while
offline (you'll need a connection to actually create or join a room, since
that's how players find each other).

## Development

WILDCARD is a Svelte 5 app built with Vite. No backend — rooms connect
directly between browsers over WebRTC.

```bash
npm install       # install dependencies
npm run dev       # local dev server
npm test          # unit tests (vitest)
npm run e2e       # end-to-end tests (playwright, real WebRTC)
```

Other useful scripts: `npm run check` (svelte-check), `npm run build`
(production build to `dist/`).

Deploys to GitHub Pages automatically on every push to `main`, gated on the
unit test suite. The end-to-end suite runs in its own workflow, spinning up a
local dev server and a local PeerJS broker, over real WebRTC; it's
informational and does not block deploys.
