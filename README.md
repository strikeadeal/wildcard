# WILDCARD

WILDCARD is the classic card game, playable free in your browser with friends —
no accounts, no ads, no app store. One person creates a room, everyone else
joins with a short code, and you play a normal hand of the game you already
know: match color or number, stack draw cards, skip and reverse, press UNO on
your last card, and slap down a wild when you're stuck.

**Play now: https://strikeadeal.github.io/wildcard/**

## How to play

1. Open the link above and enter your name.
2. One player taps **Create a room** — this gives you a short room code.
3. Share that code with everyone else. They enter their name and the code,
   then tap **Join**.
4. Once everyone's in, the host starts the round. Play proceeds like the
   card game you grew up with: match the top card's color or number, and draw
   when you can't play. The UNO button is always on the table — nothing will
   remind you to press it when you're down to your last card, and an opponent
   who catches you un-called makes you draw two.

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

Each room lives in a [Cloudflare Durable Object](https://developers.cloudflare.com/durable-objects/)
— a tiny per-room game server addressed by the room code. Every player,
including the person who created the room, connects to it over a WebSocket.
The room owns the authoritative game state, so briefly losing your
connection (or refreshing the page) doesn't lose your seat: you're slotted
back in with the same hand, and that goes for the host too. If the host
deliberately leaves, the room closes for everyone. Idle rooms are purged
automatically after several hours.

### Backend deployment (Cloudflare Workers)

The frontend is a static PWA on GitHub Pages; the backend is a single Worker
(`worker/`) with the `RoomDO` Durable Object class. SQLite-backed Durable
Objects work on the Workers free plan. CI deploys both on every push to
`main`, and expects these GitHub Actions settings:

- repository secret `CLOUDFLARE_API_TOKEN` — an API token with the
  *Edit Cloudflare Workers* template permissions;
- repository variable `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account id;
- repository variable `VITE_WS_URL` — the deployed worker's WebSocket URL,
  e.g. `wss://wildcard-api.<your-subdomain>.workers.dev` (Vite bakes it into
  the frontend bundle).

To bootstrap the first deploy manually: `npx wrangler login` then
`npm run deploy:worker` — the command prints the worker URL to use for
`VITE_WS_URL`.

Because it's a PWA, you can install WILDCARD to your home screen for a more
app-like feel, and the app shell will still load if you open it again while
offline (you'll need a connection to actually create or join a room, since
that's how players find each other).

## Development

WILDCARD is a Svelte 5 app built with Vite, plus a small Cloudflare Worker
backend (`worker/`) that runs one Durable Object per room.

```bash
npm install        # install dependencies
npm run dev:worker # local game server (wrangler dev on :8787)
npm run dev        # local dev server (frontend; talks to :8787 by default)
npm test           # unit tests (vitest)
npm run e2e        # end-to-end tests (playwright, against a real local Worker)
```

Other useful scripts: `npm run check` (svelte-check), `npm run build`
(production build to `dist/`).

Deploys automatically on every push to `main`, gated on the unit test suite:
the Worker via `wrangler deploy`, then the frontend to GitHub Pages. The
end-to-end suite runs in its own workflow, spinning up the Vite dev server and
a local `wrangler dev` Worker; it's informational and does not block deploys.
