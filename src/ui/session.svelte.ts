import { DEFAULT_RULES, type Action, type PlayerView, type RuleConfig } from '../engine/types';
import { newRoomCode, normalizeCode } from '../net/codes';
import { GuestSession } from '../net/guest';
import { HostSession } from '../net/host';
import { hostRoom, joinRoom as peerJoin } from '../net/peer';
import type { LobbyInfo } from '../net/protocol';

export type Screen = 'home' | 'connecting' | 'lobby' | 'game' | 'fatal';

const NAME_KEY = 'wildcard:name';
const tokenKey = (code: string) => 'wildcard:token:' + code;

const REJECTION_TEXT: Record<string, { title: string; detail: string }> = {
  version: { title: 'Update needed', detail: 'Your app version differs from the host\'s. Refresh the page on both devices and try again.' },
  full: { title: 'Room full', detail: 'This room already has 6 players.' },
  started: { title: 'Game in progress', detail: 'This game already started without you. Ask the host for a new room after this round.' },
  badToken: { title: 'Seat not found', detail: 'Your old seat in this room is gone. Ask the host for a fresh invite.' }
};

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
  fatal = $state<{ title: string; detail: string; canRejoin: boolean } | null>(null);
  isHost = $state(false);
  playerId = $state<string | null>(null);
  prefillCode = $state('');

  gameLive = $derived(this.isHost && this.view !== null && this.screen === 'game');

  private host: HostSession | null = null;
  private guest: GuestSession | null = null;
  private destroyPeer: (() => void) | null = null;
  private lastJoin: { code: string; name: string } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
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

  private fail(title: string, detail: string, canRejoin = false): void {
    this.fatal = { title, detail, canRejoin };
    this.screen = 'fatal';
  }

  async createRoom(name: string): Promise<void> {
    localStorage.setItem(NAME_KEY, name);
    this.screen = 'connecting';
    this.isHost = true;
    this.playerId = 'p0';
    const events = {
      onLobby: (lobby: LobbyInfo) => {
        this.lobby = lobby;
        if (this.screen === 'connecting') this.screen = 'lobby';
      },
      onView: (view: PlayerView) => {
        this.view = view;
        this.screen = 'game';
      },
      onError: (message: string) => this.showToast(message)
    };
    this.host = new HostSession(name.trim() || 'Host', DEFAULT_RULES, events);
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
        this.screen = 'lobby';
        return;
      } catch (e) {
        // If the timeout lost the race but the peer opens later, reap it.
        raw.then((r) => r.destroy()).catch(() => {});
        if (this.epoch !== epoch) return;
        const message = (e as Error).message;
        if (message !== 'code-taken') {
          this.fail('Could not create a room', 'The connection service is unreachable. Check your internet connection — some strict networks (offices, schools) block game connections entirely.');
          return;
        }
      }
    }
    if (this.epoch !== epoch) return;
    this.fail('Could not create a room', 'Could not claim a room code. Please try again.');
  }

  async joinRoom(codeInput: string, name: string): Promise<void> {
    const code = normalizeCode(codeInput);
    if (!code) {
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
          this.lobby = lobby;
          this.screen = 'lobby';
        },
        onView: (view) => {
          this.view = view;
          this.screen = 'game';
        },
        onRejected: (reason) => {
          const text = REJECTION_TEXT[reason] ?? REJECTION_TEXT.version!;
          this.fail(text.title, text.detail);
        },
        onError: (message) => this.showToast(message),
        onClosed: () => {
          if (this.screen === 'fatal' || this.screen === 'home') return;
          this.fail('Connection lost', 'The link to the host dropped. If the host is still playing, you can try to rejoin your seat.', true);
        }
      });
    } catch (e) {
      // If the timeout lost the race but the peer opens later, reap it.
      raw.then((r) => r.destroy()).catch(() => {});
      if (this.epoch !== epoch) return;
      const message = (e as Error).message;
      this.fail(
        message === 'not-found' ? 'Room not found' : 'Could not connect',
        message === 'not-found'
          ? 'No room answers to code ' + code + '. Check the code with the host — rooms close when the host leaves.'
          : 'The connection service is unreachable. Check your internet connection — some strict networks block game connections.'
      );
    }
  }

  rejoin(): void {
    if (this.lastJoin) void this.joinRoom(this.lastJoin.code, this.lastJoin.name);
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
    this.fatal = null;
    this.isHost = false;
    this.playerId = null;
    this.screen = 'home';
  }
}

export const session = new Session();
