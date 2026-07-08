# WILDCARD TURN Server Design

**Date:** 2026-07-08  
**Status:** Approved for implementation

## Goal

Allow WILDCARD players on different or restrictive networks to establish the
existing PeerJS data connection by relaying WebRTC traffic through a dedicated
TURN server when direct ICE connectivity fails.

The production PWA remains a static GitHub Pages deployment. The host browser
continues to own game state; the TURN server only relays encrypted WebRTC
packets and does not become an application backend.

## Current State

- Production PWA: `https://strikeadeal.github.io/wildcard/`
- TURN droplet: Ubuntu 24.04 at `168.144.160.100`
- Network layer: PeerJS with its public cloud broker for signaling
- ICE configuration: browser defaults only; no custom STUN or TURN servers
- Droplet state: clean host, coturn absent, UFW inactive, SSH on port 22
- DNS: no user-controlled TURN hostname is available

## Chosen Approach

Run coturn directly on the droplet and expose IP-based TURN on port 3478 over
both UDP and TCP. Configure PeerJS with a standard public STUN server followed
by the new TURN URLs. ICE will prefer direct connectivity and use the relay only
when necessary.

The first deployment will not expose `turns:` because a trusted TLS certificate
requires a stable hostname. This is acceptable for the immediate goal: browsers
can use `turn:` ICE servers from an HTTPS PWA, and UDP/TCP TURN covers the common
NAT and firewall failure modes. A user-controlled hostname and TLS listener can
be added later without changing the networking abstraction.

## Droplet Configuration

Install the Ubuntu `coturn` package and enable `coturn.service`. Use a dedicated
configuration with:

- listeners on UDP and TCP port 3478;
- relay ports 49160–49200, sufficient for this small card-game workload;
- the droplet's public IP as the advertised external address and its detected
  private interface address as the relay/listening address where required;
- long-term credential authentication with a dedicated WILDCARD realm and one
  generated application user;
- fingerprinting, stale nonces, and bounded per-user allocations;
- loopback, private, multicast, and otherwise unsafe peer destinations denied
  to reduce TURN-assisted access to internal services;
- no anonymous access, CLI listener, or unnecessary TLS/DTLS listener;
- service logs available through systemd journal without logging credentials.

Enable UFW with default-deny inbound policy and allow only:

- TCP 22 for SSH;
- UDP and TCP 3478 for TURN;
- UDP and TCP 49160–49200 for relay allocations.

Before enabling UFW, explicitly allow SSH and confirm the rule set so remote
administration is not locked out. DigitalOcean Cloud Firewall rules, if one is
attached outside the guest OS, must permit the same ports.

## Application Configuration

Extend `src/net/peer.ts` so `PeerOptions.config.iceServers` is assembled from
Vite environment variables. Production will provide:

- `VITE_TURN_URLS` as a comma-separated list containing UDP and TCP URLs;
- `VITE_TURN_USERNAME`;
- `VITE_TURN_CREDENTIAL`.

The resulting ICE list will include a STUN entry plus both
`turn:168.144.160.100:3478?transport=udp` and
`turn:168.144.160.100:3478?transport=tcp`. Local development and existing e2e
PeerServer overrides remain supported.

Because this is a static PWA, any credential compiled into the JavaScript is
public to users and must not be treated as a secret. The generated credential
will be dedicated to TURN only, replaceable without affecting SSH, and protected
primarily by coturn quotas and firewall restrictions. A future credential-minting
service would be required for genuinely private, short-lived TURN credentials.

Production values will be supplied through the GitHub Pages build workflow so
the repository does not contain the generated password. This avoids accidental
source disclosure but does not make the browser-delivered value confidential.

## Data Flow

1. Host and guest use the existing PeerJS broker to exchange signaling data.
2. Their browsers gather direct, server-reflexive, and relay ICE candidates.
3. ICE selects a direct path when possible.
4. If direct connectivity fails, each browser authenticates to coturn and uses
   a relay candidate.
5. Game messages continue through the existing encrypted WebRTC data channel;
   coturn cannot interpret application payloads.

## Failure Handling

- If TURN is unavailable but direct ICE works, games continue normally.
- If all candidate paths fail, existing connection timeout/error handling
  remains authoritative.
- coturn starts on boot and is supervised by systemd.
- Credentials can be rotated by adding the replacement server credential,
  deploying the matching PWA configuration, and then removing the old one.
- Journal and allocation statistics provide operational diagnosis without
  introducing a new application telemetry system.

## Testing and Verification

Application work follows test-driven development:

1. Add unit tests for ICE-server configuration parsing and the default/no-TURN
   behavior; observe the tests fail before implementation.
2. Implement the minimal PeerJS configuration change and run the complete unit,
   Svelte/type, and production-build suites.
3. Validate coturn configuration syntax and service health on the droplet.
4. Exercise TURN authentication and allocation using coturn client utilities.
5. Confirm UDP and TCP listeners and relay-port firewall rules.
6. Run a browser WebRTC connection with relay-only ICE policy and inspect the
   selected candidate pair to prove traffic traverses the droplet.
7. Re-run the normal direct-connect e2e path to ensure TURN remains a fallback
   and existing multiplayer behavior is unchanged.

## Out of Scope

- Replacing PeerJS signaling or hosting an application backend
- Moving game authority away from the host browser
- Account systems or per-player TURN credentials
- TLS/TURNS without a user-controlled hostname
- High-availability or multi-region TURN deployment

## Success Criteria

- coturn is enabled, hardened, and reachable on the documented UDP/TCP ports;
- the PWA supplies valid STUN and TURN ICE servers to every production PeerJS
  connection;
- a forced-relay WebRTC test succeeds through `168.144.160.100`;
- existing unit, type/Svelte, build, and normal WebRTC tests pass;
- SSH remains accessible after firewall activation.
