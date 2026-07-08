# WILDCARD TURN Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a hardened coturn relay at `168.144.160.100` and configure the production WILDCARD PWA to use it when direct WebRTC connectivity fails.

**Architecture:** Keep PeerJS signaling and host-authoritative game state unchanged. A pure environment parser builds an optional production `RTCConfiguration`; coturn supplies authenticated UDP/TCP relay candidates, while GitHub Actions injects the public browser credential at build time.

**Tech Stack:** TypeScript 6, PeerJS 1.5, Vitest 4, Vite 8, GitHub Actions/Pages, Ubuntu 24.04, coturn, UFW, Playwright/Chromium.

## Global Constraints

- Preserve the static GitHub Pages deployment and existing PeerJS signaling.
- Prefer direct ICE connectivity; TURN is a fallback, not an application backend.
- Serve TURN on `168.144.160.100:3478` over UDP and TCP.
- Restrict relay allocations to ports 49160–49200 over UDP and TCP.
- Do not add TLS/DTLS listeners without a user-controlled hostname.
- Do not commit the generated TURN password.
- Treat every browser-delivered TURN credential as public and replaceable.
- Preserve local PeerServer overrides used by Playwright e2e tests.
- Follow red-green-refactor for application behavior and run verification before completion.

## File Map

- Create `src/net/ice.ts`: pure conversion from Vite environment strings to an optional `RTCConfiguration`.
- Create `tests/net/ice.test.ts`: unit coverage for disabled, incomplete, and complete TURN configuration.
- Modify `src/net/peer.ts`: pass the optional ICE configuration into each PeerJS instance.
- Modify `src/vite-env.d.ts`: type the three production TURN environment variables.
- Modify `.github/workflows/deploy.yml`: inject repository variables and the credential secret into the production build.
- Modify `README.md`: document TURN fallback, public browser credentials, and required deployment settings.
- Create `scripts/verify-turn.mjs`: external Chromium relay-candidate check using the installed Playwright dependency.
- Modify `/etc/turnserver.conf` on the droplet: coturn listener, authentication, quotas, denied peers, and relay range.
- Modify `/etc/default/coturn` and `/var/lib/turn/turndb` on the droplet: enable the service and store the dedicated application account.
- Modify droplet UFW state: allow SSH, TURN listeners, and the bounded relay range.

---

### Task 1: Build and test production ICE configuration

**Files:**
- Create: `src/net/ice.ts`
- Create: `tests/net/ice.test.ts`
- Modify: `src/net/peer.ts`
- Modify: `src/vite-env.d.ts`

**Interfaces:**
- Consumes: Vite environment keys `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL`.
- Produces: `buildIceConfig(env: TurnEnvironment): RTCConfiguration | undefined` and `peerOptions(env?: PeerEnvironment): PeerOptions`.
- PeerJS consumes the result as `PeerOptions.config` for both hosts and guests.

- [ ] **Step 1: Write failing parser tests**

Create `tests/net/ice.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildIceConfig } from '../../src/net/ice';

describe('TURN ICE configuration', () => {
  it('leaves PeerJS defaults unchanged when TURN is not configured', () => {
    expect(buildIceConfig({})).toBeUndefined();
  });

  it('rejects incomplete TURN configuration', () => {
    expect(buildIceConfig({ VITE_TURN_URLS: 'turn:192.0.2.1:3478' })).toBeUndefined();
    expect(buildIceConfig({
      VITE_TURN_URLS: 'turn:192.0.2.1:3478',
      VITE_TURN_USERNAME: 'wildcard'
    })).toBeUndefined();
  });

  it('builds STUN followed by trimmed UDP and TCP TURN URLs', () => {
    expect(buildIceConfig({
      VITE_TURN_URLS: ' turn:168.144.160.100:3478?transport=udp, turn:168.144.160.100:3478?transport=tcp ',
      VITE_TURN_USERNAME: ' wildcard ',
      VITE_TURN_CREDENTIAL: ' relay-password '
    })).toEqual({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: [
            'turn:168.144.160.100:3478?transport=udp',
            'turn:168.144.160.100:3478?transport=tcp'
          ],
          username: 'wildcard',
          credential: 'relay-password'
        }
      ]
    });
  });
});
```

- [ ] **Step 2: Verify the tests fail for the missing module**

Run:

```bash
npx vitest run tests/net/ice.test.ts
```

Expected: FAIL because `../../src/net/ice` does not exist.

- [ ] **Step 3: Implement the minimal pure parser**

Create `src/net/ice.ts`:

```ts
export interface TurnEnvironment {
  VITE_TURN_URLS?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
}

export function buildIceConfig(env: TurnEnvironment): RTCConfiguration | undefined {
  const urls = env.VITE_TURN_URLS?.split(',').map((url) => url.trim()).filter(Boolean) ?? [];
  const username = env.VITE_TURN_USERNAME?.trim();
  const credential = env.VITE_TURN_CREDENTIAL?.trim();
  if (urls.length === 0 || !username || !credential) return undefined;

  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls, username, credential }
    ]
  };
}
```

- [ ] **Step 4: Verify parser tests pass**

Run:

```bash
npx vitest run tests/net/ice.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Add a failing PeerJS-options integration test**

Create `tests/net/peer-options.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { peerOptions } from '../../src/net/peer';

describe('PeerJS options', () => {
  it('preserves local broker overrides and adds production ICE configuration', () => {
    expect(peerOptions({
      VITE_PEER_HOST: 'localhost',
      VITE_PEER_PORT: '9099',
      VITE_TURN_URLS: 'turn:168.144.160.100:3478?transport=udp',
      VITE_TURN_USERNAME: 'wildcard',
      VITE_TURN_CREDENTIAL: 'relay-password'
    })).toEqual({
      host: 'localhost',
      port: 9099,
      path: '/',
      secure: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          {
            urls: ['turn:168.144.160.100:3478?transport=udp'],
            username: 'wildcard',
            credential: 'relay-password'
          }
        ]
      }
    });
  });
});
```

Run:

```bash
npx vitest run tests/net/peer-options.test.ts
```

Expected: FAIL because `peerOptions` is not exported and does not accept an environment argument.

- [ ] **Step 6: Wire the configuration into PeerJS without changing local signaling overrides**

In `src/net/peer.ts`, add:

```ts
import { buildIceConfig, type TurnEnvironment } from './ice';
```

Replace `peerOptions()` with:

```ts
interface PeerEnvironment extends TurnEnvironment {
  VITE_PEER_HOST?: string;
  VITE_PEER_PORT?: string;
}

export function peerOptions(env: PeerEnvironment = import.meta.env): PeerOptions {
  const host = env.VITE_PEER_HOST;
  const config = buildIceConfig(env);
  return {
    ...(host ? {
      host,
      port: Number(env.VITE_PEER_PORT ?? 9000),
      path: '/',
      secure: false
    } : {}),
    ...(config ? { config } : {})
  };
}
```

Add to `src/vite-env.d.ts`:

```ts
interface ImportMetaEnv {
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 7: Verify the focused and full application suites**

Run:

```bash
npx vitest run tests/net/ice.test.ts
npx vitest run tests/net/peer-options.test.ts
npm test
npm run check
npm run build
```

Expected: all tests PASS, Svelte/type checking reports 0 errors, and Vite produces `dist/`.

- [ ] **Step 8: Commit application behavior**

```bash
git add src/net/ice.ts src/net/peer.ts src/vite-env.d.ts tests/net/ice.test.ts tests/net/peer-options.test.ts
git commit -m "feat(net): configure TURN fallback for PeerJS"
```

---

### Task 2: Configure and document production build inputs

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: GitHub repository variables `VITE_TURN_URLS`, `VITE_TURN_USERNAME` and Actions secret `VITE_TURN_CREDENTIAL`.
- Produces: a Pages bundle containing the production `RTCConfiguration`.

- [ ] **Step 1: Add exact build-time environment mapping**

Replace the deploy workflow's build step with:

```yaml
      - name: Build with production TURN fallback
        run: npm run build
        env:
          VITE_TURN_URLS: ${{ vars.VITE_TURN_URLS }}
          VITE_TURN_USERNAME: ${{ vars.VITE_TURN_USERNAME }}
          VITE_TURN_CREDENTIAL: ${{ secrets.VITE_TURN_CREDENTIAL }}
```

- [ ] **Step 2: Document network behavior and deployment settings**

Add to `README.md` after “A note on how rooms work”:

```md
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
```

- [ ] **Step 3: Prove the production values are embedded and defaults still build**

Run:

```bash
rm -rf dist
VITE_TURN_URLS='turn:168.144.160.100:3478?transport=udp,turn:168.144.160.100:3478?transport=tcp' \
VITE_TURN_USERNAME='wildcard' \
VITE_TURN_CREDENTIAL='build-verification-only' \
npm run build
rg -F '168.144.160.100:3478' dist
rm -rf dist
npm run build
```

Expected: the first build succeeds and `rg` finds the TURN address; the second build also succeeds without TURN variables.

- [ ] **Step 4: Commit deployment configuration**

```bash
git add .github/workflows/deploy.yml README.md
git commit -m "docs: configure TURN values for Pages deployment"
```

---

### Task 3: Provision and harden coturn on the droplet

**Files:**
- Modify remotely: `/etc/turnserver.conf`
- Modify remotely: `/etc/default/coturn`
- Modify remotely: `/var/lib/turn/turndb`
- Modify remotely: UFW configuration

**Interfaces:**
- Consumes: SSH key `~/.ssh/wildcard_turn_droplet` and one generated 32-byte credential.
- Produces: authenticated TURN at `168.144.160.100:3478` and a temporary macOS Keychain item for Tasks 4–5.

- [ ] **Step 1: Capture the failing pre-provision state**

Run:

```bash
ssh -i ~/.ssh/wildcard_turn_droplet -o IdentitiesOnly=yes root@168.144.160.100 \
  'dpkg-query -W coturn 2>/dev/null || true; ss -lntup | grep 3478 || true; ufw status verbose'
```

Expected: coturn absent, no listener on 3478, UFW inactive.

- [ ] **Step 2: Install coturn and UFW packages**

```bash
ssh -i ~/.ssh/wildcard_turn_droplet -o IdentitiesOnly=yes root@168.144.160.100 \
  'export DEBIAN_FRONTEND=noninteractive; apt-get update; apt-get install -y coturn ufw'
```

Expected: package installation exits 0 and installs `turnserver`, `turnadmin`, and `turnutils_uclient`.

- [ ] **Step 3: Generate the credential and install the hardened configuration**

Generate the credential and retain it in macOS Keychain so separate verification shells do not print it or write it to the repository:

```bash
TURN_PASSWORD="$(openssl rand -hex 32)"
test "${#TURN_PASSWORD}" -eq 64
security add-generic-password -U -a wildcard -s wildcard-turn-168.144.160.100 -w "$TURN_PASSWORD"
ssh -i ~/.ssh/wildcard_turn_droplet -o IdentitiesOnly=yes root@168.144.160.100 \
  "bash -s -- '$TURN_PASSWORD'" <<'REMOTE'
set -euo pipefail
turn_password="$1"
install -o root -g turnserver -m 640 /dev/stdin /etc/turnserver.conf <<'CONFIG'
listening-port=3478
listening-ip=168.144.160.100
relay-ip=168.144.160.100
min-port=49160
max-port=49200
fingerprint
lt-cred-mech
realm=wildcard
userdb=/var/lib/turn/turndb
user-quota=12
total-quota=60
max-bps=262144
bps-capacity=8388608
stale-nonce=600
no-cli
no-tls
no-dtls
no-multicast-peers
no-loopback-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
denied-peer-ip=::-::ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
log-file=stdout
simple-log
CONFIG
sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
grep -q '^TURNSERVER_ENABLED=' /etc/default/coturn || echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn
rm -f /var/lib/turn/turndb
turnadmin -a -b /var/lib/turn/turndb -u wildcard -r wildcard -p "$turn_password"
chown turnserver:turnserver /var/lib/turn/turndb
chmod 600 /var/lib/turn/turndb
systemctl enable --now coturn
REMOTE
```

Expected: `systemctl enable --now coturn` exits 0. Do not print `TURN_PASSWORD`.

- [ ] **Step 4: Verify service health before changing the firewall**

```bash
ssh -i ~/.ssh/wildcard_turn_droplet -o IdentitiesOnly=yes root@168.144.160.100 \
  'systemctl is-enabled coturn; systemctl is-active coturn; ss -lntup | grep 3478; journalctl -u coturn -n 50 --no-pager'
```

Expected: `enabled`, `active`, UDP and TCP listeners on 3478, and no fatal configuration errors.

- [ ] **Step 5: Enable UFW without risking SSH access**

```bash
ssh -i ~/.ssh/wildcard_turn_droplet -o IdentitiesOnly=yes root@168.144.160.100 <<'REMOTE'
set -euo pipefail
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 3478/tcp comment 'TURN TCP'
ufw allow 3478/udp comment 'TURN UDP'
ufw allow 49160:49200/tcp comment 'TURN TCP relay'
ufw allow 49160:49200/udp comment 'TURN UDP relay'
ufw --force enable
ufw status verbose
REMOTE
```

Expected: UFW active with exactly the documented inbound services.

- [ ] **Step 6: Prove SSH survives and authenticated UDP/TCP allocations work**

```bash
TURN_PASSWORD="$(security find-generic-password -w -a wildcard -s wildcard-turn-168.144.160.100)"
ssh -i ~/.ssh/wildcard_turn_droplet -o IdentitiesOnly=yes root@168.144.160.100 'true'
ssh -i ~/.ssh/wildcard_turn_droplet -o IdentitiesOnly=yes root@168.144.160.100 \
  "turnutils_uclient -v -y -u wildcard -w '$TURN_PASSWORD' 168.144.160.100"
ssh -i ~/.ssh/wildcard_turn_droplet -o IdentitiesOnly=yes root@168.144.160.100 \
  "turnutils_uclient -v -t -y -u wildcard -w '$TURN_PASSWORD' 168.144.160.100"
```

Expected: SSH exits 0; both TURN client runs authenticate and create allocations without packet loss or authorization errors.

---

### Task 4: Add an external browser relay verifier

**Files:**
- Create: `scripts/verify-turn.mjs`

**Interfaces:**
- Consumes: `TURN_URLS`, `TURN_USERNAME`, and `TURN_CREDENTIAL` process environment variables.
- Produces: exit 0 plus a selected relay candidate, or a bounded nonzero failure.

- [ ] **Step 1: Create the Playwright relay verifier**

Create `scripts/verify-turn.mjs`:

```js
import { chromium } from '@playwright/test';

const urls = process.env.TURN_URLS?.split(',').map((url) => url.trim()).filter(Boolean);
const username = process.env.TURN_USERNAME;
const credential = process.env.TURN_CREDENTIAL;
if (!urls?.length || !username || !credential) {
  throw new Error('TURN_URLS, TURN_USERNAME and TURN_CREDENTIAL are required');
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const candidate = await page.evaluate(async ({ urls, username, credential }) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls, username, credential }],
      iceTransportPolicy: 'relay'
    });
    try {
      pc.createDataChannel('verify');
      await pc.setLocalDescription(await pc.createOffer());
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('No relay candidate within 15 seconds')), 15_000);
        pc.addEventListener('icecandidate', (event) => {
          if (event.candidate?.type !== 'relay') return;
          clearTimeout(timeout);
          resolve(event.candidate.candidate);
        });
        pc.addEventListener('icecandidateerror', (event) => {
          if (event.errorCode >= 400) {
            clearTimeout(timeout);
            reject(new Error(`ICE ${event.errorCode}: ${event.errorText}`));
          }
        });
      });
    } finally {
      pc.close();
    }
  }, { urls, username, credential });
  console.log(`TURN relay candidate gathered: ${candidate}`);
} finally {
  await browser.close();
}
```

- [ ] **Step 2: Verify missing credentials fail clearly**

Run:

```bash
node scripts/verify-turn.mjs
```

Expected: nonzero exit with `TURN_URLS, TURN_USERNAME and TURN_CREDENTIAL are required`.

- [ ] **Step 3: Verify the droplet externally with forced relay policy**

Retrieve the temporary credential and run from the workstation:

```bash
TURN_PASSWORD="$(security find-generic-password -w -a wildcard -s wildcard-turn-168.144.160.100)"
TURN_URLS='turn:168.144.160.100:3478?transport=udp,turn:168.144.160.100:3478?transport=tcp' \
TURN_USERNAME='wildcard' \
TURN_CREDENTIAL="$TURN_PASSWORD" \
node scripts/verify-turn.mjs
```

Expected: exit 0 and `TURN relay candidate gathered:` containing `typ relay` and `168.144.160.100`.

- [ ] **Step 4: Commit the verifier**

```bash
git add scripts/verify-turn.mjs
git commit -m "test(net): add external TURN relay verifier"
```

---

### Task 5: Configure GitHub, deploy, and verify the production PWA

**Files:**
- External state: GitHub repository variables, Actions secret, Pages deployment.

**Interfaces:**
- Consumes: the TURN password retrieved from macOS Keychain and committed workflow changes.
- Produces: production Pages bundle configured with the live relay.

- [ ] **Step 1: Store production build settings in GitHub**

```bash
TURN_PASSWORD="$(security find-generic-password -w -a wildcard -s wildcard-turn-168.144.160.100)"
gh variable set VITE_TURN_URLS --repo strikeadeal/wildcard \
  --body 'turn:168.144.160.100:3478?transport=udp,turn:168.144.160.100:3478?transport=tcp'
gh variable set VITE_TURN_USERNAME --repo strikeadeal/wildcard --body 'wildcard'
gh secret set VITE_TURN_CREDENTIAL --repo strikeadeal/wildcard --body "$TURN_PASSWORD"
gh variable list --repo strikeadeal/wildcard
gh secret list --repo strikeadeal/wildcard
```

Expected: both variables and the credential secret are listed by name; the password value is not printed.

- [ ] **Step 2: Run the complete local verification suite**

```bash
npm test
npm run check
npm run build
npm run e2e
git status --short
```

Expected: unit tests, Svelte/type check, build, and real-WebRTC e2e all pass; worktree is clean.

- [ ] **Step 3: Push the committed main branch and follow deployment**

```bash
git push origin main
gh run list --repo strikeadeal/wildcard --workflow deploy.yml --limit 1
gh run watch --repo strikeadeal/wildcard "$(gh run list --repo strikeadeal/wildcard --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Expected: push succeeds and the Pages workflow completes successfully.

- [ ] **Step 4: Verify the deployed bundle and relay service remain healthy**

```bash
curl -fsSL https://strikeadeal.github.io/wildcard/ | grep -F '<div id="app"></div>'
ssh -i ~/.ssh/wildcard_turn_droplet -o IdentitiesOnly=yes root@168.144.160.100 \
  'systemctl is-active coturn; ufw status; journalctl -u coturn --since "10 minutes ago" --no-pager | tail -n 80'
TURN_PASSWORD="$(security find-generic-password -w -a wildcard -s wildcard-turn-168.144.160.100)"
TURN_URLS='turn:168.144.160.100:3478?transport=udp,turn:168.144.160.100:3478?transport=tcp' \
TURN_USERNAME='wildcard' \
TURN_CREDENTIAL="$TURN_PASSWORD" \
node scripts/verify-turn.mjs
```

Expected: deployed HTML is reachable, coturn is active, UFW is active, logs contain no fatal errors, and a fresh external relay candidate is gathered.

- [ ] **Step 5: Remove the temporary local credential copy**

```bash
unset TURN_PASSWORD
security delete-generic-password -a wildcard -s wildcard-turn-168.144.160.100
```

Expected: `test -z "${TURN_PASSWORD:-}"` exits 0 and Keychain reports that the item was deleted.
