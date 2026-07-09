import { DEFAULT_RULES, type Action, type PlayerView, type RuleConfig } from '../engine/types';
import { deriveViewChange, type GameEvent } from './events';
import { newRoomCode, normalizeCode } from '../net/codes';
import { GuestSession } from '../net/guest';
import { HostSession } from '../net/host';
import { hostRoom, joinRoom as peerJoin } from '../net/peer';
import type { LobbyInfo } from '../net/protocol';
import type { FatalReason } from './fatal-state';
import { nextRecoveryState, type RecoveryState } from './connection-state';
import { appendNoticeQueue, mergeNoticeHistory } from './notice-queue';
import type { PublicNotice } from './public-notices';

export type Screen = 'home' | 'connecting' | 'lobby' | 'game' | 'fatal';
export type Operation = 'create' | 'join' | 'rejoin' | null;
type RejoinOutcome = 'joined' | 'roomMissing' | 'networkFailed';
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const NAME_KEY = 'wildcard:name';
const RETURNING_KEY = 'wildcard:returning';
const INSTALL_DISMISSED_KEY = 'wildcard:install-dismissed';
const tokenKey = (code: string) => 'wildcard:token:' + code;

function readStorage(key: string): string | null {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
}

function writeStorage(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, value);
}

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
  noticeHistory = $state<PublicNotice[]>([]);
  noticeQueue = $state<PublicNotice[]>([]);
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
  recovery = $state<RecoveryState>('idle');
  selectionEpoch = $state(0);
  online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  installEvent = $state<BeforeInstallPromptEvent | null>(null);
  installDismissed = $state(readStorage(INSTALL_DISMISSED_KEY) === '1');
  currentNotice = $derived(this.noticeQueue[0] ?? null);
  canOfferInstall = $derived(
    !!this.installEvent && !this.installDismissed && readStorage(RETURNING_KEY) === '1'
  );

  gameLive = $derived(this.isHost && this.view !== null && this.screen === 'game');

  private host: HostSession | null = null;
  private guest: GuestSession | null = null;
  private destroyPeer: (() => void) | null = null;
  private lastJoin: { code: string; name: string } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private bannerTimer: ReturnType<typeof setTimeout> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private fxNonce = 0;
  /** True when the most recent fail() happened during a create, not a join. */
  private lastFailWasCreate = false;
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
    return readStorage(NAME_KEY) ?? '';
  }

  setOnline(value: boolean): void {
    this.online = value;
  }

  captureInstallPrompt(event: Event): void {
    event.preventDefault();
    this.installEvent = event as BeforeInstallPromptEvent;
  }

  async installApp(): Promise<void> {
    const event = this.installEvent;
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    this.installEvent = null;
  }

  dismissInstallPrompt(): void {
    this.installDismissed = true;
    writeStorage(INSTALL_DISMISSED_KEY, '1');
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

  private scheduleNoticeDismissal(): void {
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.dismissCurrentNotice(), 2400);
  }

  private bumpSelectionEpoch(): void {
    this.selectionEpoch++;
  }

  /**
   * Both host and guest funnel incoming views here. Transported notices drive
   * queue/history state when present; otherwise older hosts still fall back to
   * deriving banner and animation changes by diffing consecutive views.
   */
  private handleView(view: PlayerView, notices: PublicNotice[] = []): void {
    if (this.view && this.view.phase !== 'roundEnd' && view.phase === 'roundEnd') {
      writeStorage(RETURNING_KEY, '1');
    }
    const change = deriveViewChange(this.view, view);
    this.lastPlayFromSelf = change.fromSelf;
    this.noticeHistory = mergeNoticeHistory(this.noticeHistory, notices);
    const nextQueue = appendNoticeQueue(this.noticeQueue, notices, [
      ...this.noticeHistory,
      ...this.noticeQueue
    ]);
    const shouldScheduleNotice = this.noticeQueue.length === 0 && nextQueue.length > 0;
    this.noticeQueue = nextQueue;
    if (shouldScheduleNotice) this.scheduleNoticeDismissal();

    if (notices.length === 0) {
      if (change.banner) this.showBanner(change.banner);
      if (change.event) this.fxEvent = { ...change.event, nonce: ++this.fxNonce };
    }
    this.view = view;
    if (this.recovery !== 'idle') {
      this.bumpSelectionEpoch();
      this.recovery = nextRecoveryState(this.recovery, { type: 'rejoined' });
    }
    this.operation = null;
    this.screen = 'game';
  }

  private handleGuestStatus(status: 'connecting' | 'connected' | 'unstable' | 'closed'): void {
    if (this.isHost || this.screen !== 'game' || !this.view) return;
    if (status === 'unstable') {
      this.recovery = nextRecoveryState(this.recovery, { type: 'transportUnstable' });
    } else if (status === 'connected' && this.recovery === 'unstable') {
      this.recovery = nextRecoveryState(this.recovery, { type: 'rejoined' });
    }
  }

  private handleGuestClosed(): void {
    if (this.screen === 'fatal' || this.screen === 'home') return;
    if (this.screen !== 'game' || !this.view || !this.lastJoin) {
      this.fail('roomUnavailable');
      return;
    }
    if (this.recovery === 'reconnecting') return;
    this.bumpSelectionEpoch();
    this.recovery = nextRecoveryState(this.recovery, { type: 'retryStarted' });
    const destroyPeer = this.destroyPeer;
    this.destroyPeer = null;
    destroyPeer?.();
    this.guest = null;
    void this.recoverGuest();
  }

  private async recoverGuest(): Promise<void> {
    if (!this.lastJoin || this.recovery !== 'reconnecting') return;
    for (const delay of [0, 1500]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (!this.lastJoin || this.recovery !== 'reconnecting') return;
      const outcome = await this.tryRejoinOnce();
      if (!this.lastJoin || this.recovery !== 'reconnecting') return;
      if (outcome === 'joined') return;
      if (outcome === 'roomMissing') {
        this.recovery = nextRecoveryState(this.recovery, { type: 'roomMissing' });
        return;
      }
    }
    if (this.recovery === 'reconnecting') {
      this.recovery = nextRecoveryState(this.recovery, { type: 'networkFailed' });
    }
  }

  private async tryRejoinOnce(): Promise<RejoinOutcome> {
    if (!this.lastJoin) return 'networkFailed';
    const epoch = this.epoch;
    const { code, name } = this.lastJoin;
    const token = readStorage(tokenKey(code));
    const raw = peerJoin(code);
    try {
      const { conn, destroy } = await withTimeout(raw);
      if (this.epoch !== epoch || this.recovery !== 'reconnecting') {
        conn.close();
        destroy();
        return 'networkFailed';
      }
      return await new Promise<RejoinOutcome>((resolve) => {
        let settled = false;
        let nextPlayerId: string | null = null;
        let nextToken: string | null = token;
        let candidate: GuestSession | null = null;
        const dispose = () => {
          candidate?.close();
          destroy();
        };
        const finish = (outcome: RejoinOutcome) => {
          if (settled) return;
          settled = true;
          if (outcome !== 'joined') dispose();
          resolve(outcome);
        };
        candidate = new GuestSession(conn, name.trim() || 'Player', token, {
          onWelcome: (playerId, freshToken) => {
            nextPlayerId = playerId;
            nextToken = freshToken;
          },
          onLobby: () => {},
          onView: (view, notices) => {
            if (this.epoch !== epoch || this.recovery !== 'reconnecting') {
              finish('networkFailed');
              return;
            }
            this.destroyPeer = destroy;
            this.guest = candidate;
            if (nextPlayerId) this.playerId = nextPlayerId;
            if (nextToken) writeStorage(tokenKey(code), nextToken);
            this.handleView(view, notices);
            finish('joined');
          },
          onRejected: (reason) => {
            if (reason === 'badToken' && typeof localStorage !== 'undefined') {
              localStorage.removeItem(tokenKey(code));
            }
            finish('networkFailed');
          },
          onError: () => {},
          onClosed: () => finish('networkFailed'),
          onConnectionStatus: () => {}
        });
      });
    } catch (e) {
      raw.then((r) => r.destroy()).catch(() => {});
      return (e as Error).message === 'not-found' ? 'roomMissing' : 'networkFailed';
    }
  }

  dismissCurrentNotice(): void {
    this.noticeQueue = this.noticeQueue.slice(1);
    clearTimeout(this.noticeTimer);
    if (this.noticeQueue.length) this.scheduleNoticeDismissal();
  }

  private fail(reason: FatalReason): void {
    this.lastFailWasCreate = this.operation === 'create';
    this.operation = null;
    this.recovery = nextRecoveryState(this.recovery, { type: 'cancelled' });
    this.fatal = { reason, code: this.roomCode ?? this.lastJoin?.code ?? null };
    this.screen = 'fatal';
  }

  async createRoom(name: string): Promise<void> {
    this.lastJoin = null;
    this.recovery = nextRecoveryState(this.recovery, { type: 'cancelled' });
    writeStorage(NAME_KEY, name);
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
      onView: (view: PlayerView, notices?: PublicNotice[]) => this.handleView(view, notices),
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
    this.recovery = nextRecoveryState(this.recovery, { type: 'cancelled' });
    this.operation = isRejoin ? 'rejoin' : 'join';
    const code = normalizeCode(codeInput);
    if (!code) {
      this.operation = null;
      this.showToast('Room codes are 5 letters/numbers, like KP4XQ');
      return;
    }
    writeStorage(NAME_KEY, name);
    this.lastJoin = { code, name };
    this.screen = 'connecting';
    this.isHost = false;
    const epoch = this.epoch;
    const raw = peerJoin(code);
    try {
      const { conn, destroy } = await withTimeout(raw);
      if (this.epoch !== epoch) {
        destroy();
        return;
      }
      this.destroyPeer = destroy;
      this.roomCode = code;
      this.guest = new GuestSession(conn, name.trim() || 'Player', readStorage(tokenKey(code)), {
        onWelcome: (playerId, token) => {
          this.playerId = playerId;
          writeStorage(tokenKey(code), token);
        },
        onLobby: (lobby) => {
          this.operation = null;
          this.lobby = lobby;
          this.screen = 'lobby';
        },
        onView: (view, notices) => this.handleView(view, notices),
        onRejected: (reason) => {
          if (reason === 'badToken' && typeof localStorage !== 'undefined') {
            localStorage.removeItem(tokenKey(code));
          }
          this.fail(reason);
        },
        onError: (message) => this.showToast(message),
        onClosed: () => this.handleGuestClosed(),
        onConnectionStatus: (status) => this.handleGuestStatus(status)
      });
    } catch (e) {
      raw.then((r) => r.destroy()).catch(() => {});
      if (this.epoch !== epoch) return;
      const message = (e as Error).message;
      this.fail(message === 'not-found' ? 'roomUnavailable' : 'networkUnavailable');
    }
  }

  retryLastJoin(): void {
    if (this.lastFailWasCreate) {
      this.createFromSavedName();
      return;
    }
    if (this.lastJoin) void this.joinRoom(this.lastJoin.code, this.lastJoin.name, true);
  }

  retryRecovery(): void {
    if (this.recovery !== 'networkUnavailable') return;
    this.bumpSelectionEpoch();
    this.recovery = nextRecoveryState(this.recovery, { type: 'retryStarted' });
    void this.recoverGuest();
  }

  dropGuestConnectionForTest(): void {
    if (!import.meta.env.DEV || this.isHost || !this.guest) return;
    this.handleGuestStatus('unstable');
    setTimeout(() => this.guest?.close(), 60);
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
    if (!this.isHost) return;
    this.host?.skipTurn(playerId);
  }

  removeSeat(playerId: string): void {
    if (!this.isHost) return;
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
    this.noticeHistory = [];
    this.noticeQueue = [];
    this.fxEvent = null;
    clearTimeout(this.bannerTimer);
    clearTimeout(this.noticeTimer);
    this.operation = null;
    this.fatal = null;
    this.recovery = nextRecoveryState(this.recovery, { type: 'cancelled' });
    this.lastFailWasCreate = false;
    this.isHost = false;
    this.playerId = null;
    this.screen = 'home';
  }
}

export const session = new Session();
