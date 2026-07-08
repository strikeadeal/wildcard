import { DEFAULT_RULES, type Action, type PlayerView, type RuleConfig } from '../engine/types';
import { deriveViewChange, type GameEvent } from './events';
import { newRoomCode, normalizeCode } from '../net/codes';
import { GuestSession } from '../net/guest';
import { HostSession } from '../net/host';
import { hostRoom, joinRoom as peerJoin } from '../net/peer';
import type { LobbyInfo } from '../net/protocol';
import type { FatalReason } from './fatal-state';

export type Screen = 'home' | 'connecting' | 'lobby' | 'game' | 'fatal';
export type Operation = 'create' | 'join' | 'rejoin' | null;

const NAME_KEY = 'wildcard:name';
const tokenKey = (code: string) => 'wildcard:token:' + code;

const configuredSeed = Number(import.meta.env.VITE_GAME_SEED);
const e2eSeed = Number.isFinite(configuredSeed) ? () => configuredSeed : undefined;

/**
 * A silent ICE failure can leave the underlying PeerJS promise pending
 * forever (no 'open' and no 'error' ever fires) — the spec forbids an
 * infinite spinner, so every awaited peer call is bounded.
 */
function withTimeout<T>(p: Promise<T>, ms = 20000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

class Session {
  screen = $state<Screen>('home');
  roomCode = $state<string | null>(null);
  lobby = $state<LobbyInfo | null>(null);
  view = $state<PlayerView | null>(null);
  toast = $state<string | null>(null);
  /** Transient game announcement (wild colour pick, +2/+4), separate from errors. */
  banner = $state<string | null>(null);
  /** True when the local player made the most recent play — drives fly direction. */
  lastPlayFromSelf = $state(false);
  /** Latest animation trigger (draw/special/uno/win); nonce bumps on every event. */
  fxEvent = $state<(GameEvent & { nonce: number }) | null>(null);
  /** Which connect flow is in flight — drives Connecting's operation-specific copy. */
  operation = $state<Operation>(null);
  fatal = $state<{ reason: FatalReason; code: string | null } | null>(null);
  isHost = $state(false);
  playerId = $state<string | null>(null);
  prefillCode = $state('');

  gameLive = $derived(this.isHost && this.view !== null && this.screen === 'game');

  private host: HostSession | null = null;
  private guest: GuestSession | null = null;
  private destroyPeer: (() => void) | null = null;
  private lastJoin: { code: string; name: string } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private bannerTimer: ReturnType<typeof setTimeout> | undefined;
  private fxNonce = 0;
  /**
   * Bumped by leave(). In-flight connects capture the epoch at entry and
   * bail (destroying any late-won peer) if it changed — a cancel during
   * connect must not resurrect the session, and a timeout-loser peer must
   * not leak.
   */
  private epoch = 0;

  constructor() {
    if (typeof location !== 'undefined') {
      const code = normalizeCode(location.hash);
      if (code) this.prefillCode = code;
    }
  }

  savedName(): string {
    return localStorage.getItem(NAME_KEY) ?? '';
  }

  private showToast(message: string): void {
    this.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), 3000);
  }

  private showBanner(message: string): void {
    this.banner = message;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => (this.banner = null), 2400);
  }

  /**
   * Both host and guest funnel incoming views here. The banner (wild colour,
   * +2/+4) and the animation event (draw/special/uno/win) are both derived by
   * diffing the previous view against the new one — the client has no event
   * stream — before the new view is stored.
   */
  private handleView(view: PlayerView): void {
    const { banner, fromSelf, event } = deriveViewChange(this.view, view);
    this.lastPlayFromSelf = fromSelf;
    if (banner) this.showBanner(banner);
    if (event) this.fxEvent = { ...event, nonce: ++this.fxNonce };
    this.view = view;
    this.operation = null;
    this.screen = 'game';
  }

  private fail(reason: FatalReason): void {
    this.operation = null;
    this.fatal = { reason, code: this.roomCode ?? this.lastJoin?.code ?? null };
    this.screen = 'fatal';
  }

  async createRoom(name: string): Promise<void> {
    localStorage.setItem(NAME_KEY, name);
    this.operation = 'create';
    this.screen = 'connecting';
    this.isHost = true;
    this.playerId = 'p0';
    const events = {
      onLobby: (lobby: LobbyInfo) => {
        this.operation = null;
        this.lobby = lobby;
        if (this.screen === 'connecting') this.screen = 'lobby';
      },
      onView: (view: PlayerView) => this.handleView(view),
      onError: (message: string) => this.showToast(message)
    };
    this.host = new HostSession(
      name.trim() || 'Host', DEFAULT_RULES, events, undefined, e2eSeed
    );
    const epoch = this.epoch;
    for (let attempt = 0; attempt < 2; attempt++) {
      const code = newRoomCode();
      const raw = hostRoom(code, (conn) => this.host?.attach(conn));
      try {
        const room = await withTimeout(raw);
        if (this.epoch !== epoch) {
          // User left while connecting — do not resurrect the session.
          room.destroy();
          return;
        }
        this.destroyPeer = room.destroy;
        this.roomCode = code;
        this.lobby = this.host.lobbyInfo();
        this.operation = null;
        this.screen = 'lobby';
        return;
      } catch (e) {
        // If the timeout lost the race but the peer opens later, reap it.
        raw.then((r) => r.destroy()).catch(() => {});
        if (this.epoch !== epoch) return;
        const message = (e as Error).message;
        if (message !== 'code-taken') {
          this.fail('networkUnavailable');
          return;
        }
      }
    }
    if (this.epoch !== epoch) return;
    this.fail('networkUnavailable');
  }

  async joinRoom(codeInput: string, name: string, isRejoin = false): Promise<void> {
    this.operation = isRejoin ? 'rejoin' : 'join';
    const code = normalizeCode(codeInput);
    if (!code) {
      this.operation = null;
      this.showToast('Room codes are 5 letters/numbers, like KP4XQ');
      return;
    }
    localStorage.setItem(NAME_KEY, name);
    this.lastJoin = { code, name };
    this.screen = 'connecting';
    this.isHost = false;
    const epoch = this.epoch;
    const raw = peerJoin(code);
    try {
      const { conn, destroy } = await withTimeout(raw);
      if (this.epoch !== epoch) {
        // User left while connecting — do not resurrect the session.
        destroy();
        return;
      }
      this.destroyPeer = destroy;
      this.roomCode = code;
      this.guest = new GuestSession(conn, name.trim() || 'Player', localStorage.getItem(tokenKey(code)), {
        onWelcome: (playerId, token) => {
          this.playerId = playerId;
          localStorage.setItem(tokenKey(code), token);
        },
        onLobby: (lobby) => {
          this.operation = null;
          this.lobby = lobby;
          this.screen = 'lobby';
        },
        onView: (view) => this.handleView(view),
        onRejected: (reason) => {
          if (reason === 'badToken') localStorage.removeItem(tokenKey(code));
          this.fail(reason);
        },
        onError: (message) => this.showToast(message),
        onClosed: () => {
          if (this.screen === 'fatal' || this.screen === 'home') return;
          this.fail('roomUnavailable');
        }
      });
    } catch (e) {
      // If the timeout lost the race but the peer opens later, reap it.
      raw.then((r) => r.destroy()).catch(() => {});
      if (this.epoch !== epoch) return;
      const message = (e as Error).message;
      this.fail(message === 'not-found' ? 'roomUnavailable' : 'networkUnavailable');
    }
  }

  retryLastJoin(): void {
    if (this.lastJoin) void this.joinRoom(this.lastJoin.code, this.lastJoin.name, true);
  }

  clearFatalToHome(): void {
    this.leave();
  }

  createFromSavedName(): void {
    const name = this.savedName();
    this.leave();
    void this.createRoom(name);
  }

  sendAction(action: Action): void {
    if (this.host) this.host.applyLocal(action);
    else this.guest?.send(action);
  }

  startGame(): void {
    this.host?.startGame();
  }

  setConfig(config: RuleConfig): void {
    this.host?.setConfig(config);
  }

  skipTurn(playerId: string): void {
    this.host?.skipTurn(playerId);
  }

  removeSeat(playerId: string): void {
    this.host?.removeSeat(playerId);
  }

  leave(): void {
    this.epoch++;
    this.destroyPeer?.();
    this.guest?.close();
    this.host = null;
    this.guest = null;
    this.destroyPeer = null;
    this.roomCode = null;
    this.lobby = null;
    this.view = null;
    this.banner = null;
    this.fxEvent = null;
    clearTimeout(this.bannerTimer);
    this.operation = null;
    this.fatal = null;
    this.isHost = false;
    this.playerId = null;
    this.screen = 'home';
  }
}

export const session = new Session();
