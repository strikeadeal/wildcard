---
name: verify
description: Build, launch, and drive WILDCARD end-to-end to observe a change working in real browsers against the real Worker backend.
---

# Verifying WILDCARD changes at runtime

## Launch the stack

Two dev servers (same pair the Playwright config boots):

```bash
cd worker && npx wrangler dev --port 8787 --var GAME_SEED:1337 &   # authoritative game server (DO)
VITE_WS_URL=ws://127.0.0.1:8787 VITE_GAME_SEED=1337 npm run dev -- --port 5199 --strictPort &
```

Probe readiness: `curl http://localhost:5199` and `curl http://127.0.0.1:8787/` both 200.

## Drive it

Multiplayer needs two pages in one Playwright browser (a standalone .mjs script
using `@playwright/test` as a library works; resolve it via
`createRequire('<repo>/package.json')('@playwright/test')` when the script lives
outside the repo). Launch with `executablePath: '/opt/pw-browsers/chromium'` on
remote runners where the pinned Playwright browser build is absent — never
`playwright install`. Viewport 390x844 matches the e2e suite.

Reusable flows (mirror `e2e/helpers.ts`):
- Create room: fill `Your name`, click `Create a room`, read `.code`.
- Join: fill name + `Room code`, click `Join`.
- Start: host clicks `Start game`, wait for `.hand .card` count 7.
- Make any legal move: click an enabled `.playable` card via `page.evaluate`
  (fanned cards occlude each other for pointer clicks), else `Face-down card`,
  else `Keep it`; pick `.swatches button` when a wild asks for a color.
- The action log is plain text (e.g. `You called UNO`); assert with `getByText`.

## Gotchas

- Dealing is deterministic only with the seed vars above; full rounds still
  take ~50-200 scripted moves, so loop with a generous cap.
- Two pages sharing one browser context is fine; the room DO keys on the
  session token, not cookies.
