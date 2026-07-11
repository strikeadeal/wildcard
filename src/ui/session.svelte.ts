import { type Action, type Card, type PlayerView, type RuleConfig } from '../engine/types';
import { deriveViewChange, type GameEvent } from './events';
import { newRoomCode, normalizeCode } from '../net/codes';
import { GuestSession } from '../net/guest';
import { connectRoom } from '../net/socket';
import type { LobbyInfo, RejectReason } from '../net/protocol';
import type { FatalReason } from './fatal-state';
import { nextRecoveryState, type RecoveryState } from './connection-state';
import { appendNoticeQueue, mergeNoticeHistory } from './notice-queue';
import { nextDiscardPile } from './discard-pile';
import type { PublicNotice } from './public-notices';

export type Screen = 'home' | 'connecting' | 'lobby' | 'game' | 'fatal';
export type Operation = 'create' | 'join' | 'rejoin' | null;
type RejoinOutcome = 'joined' | 'seatUnavailable' | 'roomMissing' | 'networkFailed';
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

/** A rejection that ends the attempt, mapped onto the fatal screen's copy. */
function fatalFromRejection(reason: RejectReason): FatalReason {
  if (reason === 'notFound' || reason === 'codeTaken') return 'roomUnavailable';
  return reason;
}

/**
 * A stalled handshake must not leave an infinite spinner —
 * every awaited connect is bounded.
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
  pendingAction = $state<{ type: Action['type']; action: Action; startedAt: number; intentId: string } | null>(null);
  toast = $state<string | null>(null);
  noticeHistory = $state<PublicNotice[]>([]);
  noticeQueue = $state<PublicNotice[]>([]);
  /** True when the local player made the most recent play — drives fly direction. */
  lastPlayFromSelf = $state(false);
  /** True when the current view is a fresh multi-card deal — drives the opening deal stagger. */
  freshDeal = $state(false);
  /** Trailing discard tops (oldest first, current top last) — client-side pile depth, since
   * `PlayerView` only ever exposes `discardTop`. */
  recentDiscards = $state<Card[]>([]);
  /** Latest animation trigger (draw/special/uno/win); nonce bumps on every event. */
  fxEvent = $state<(GameEvent & { nonce: number }) | null>(null);
  /** Which connect flow is in flight — drives Connecting's operation-specific copy. */
  operation = $state<Operation>(null);
  fatal = $state<{ reason: FatalReason; code: string | null } | null>(null);
  playerId = $state<string | null>(null);
  /** Seat p0 is the room's creator and carries the host powers. */
  isHost = $derived(this.playerId === 'p0');
  prefillCode = $state('');
  recovery = $state<RecoveryState>('idle');
  selectionEpoch = $state(0);
  online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  installEvent = $state<BeforeInstallPromptEvent | null>(null);
  installDismissed = $state(readStorage(INSTALL_DISMISSED_KEY) === '1');
  returningPlayer = $state(readStorage(RETURNING_KEY) === '1');
  currentNotice = $derived(this.noticeQueue[0] ?? null);
  canOfferInstall = $derived(
    !!this.installEvent && !this.installDismissed && this.returningPlayer
  );

  gameLive = $derived(this.view !== null && this.screen === 'game');

  private guest: GuestSession | null = null;
  private destroyPeer: (() => void) | null = null;
  private lastJoin: { code: string; name: string } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
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

  /** Fired by the `appinstalled` event once the OS finishes installing the PWA —
   * the prompt is spent and the card must never resurface for this browser. */
  markInstalled(): void {
    this.installEvent = null;
    this.installDismissed = true;
    writeStorage(INSTALL_DISMISSED_KEY, '1');
  }

  private markReturningPlayer(): void {
    this.returningPlayer = true;
    writeStorage(RETURNING_KEY, '1');
  }

  private showToast(message: string): void {
    this.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), 3000);
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
   * deriving animation changes by diffing consecutive views.
   */
  private handleView(view: PlayerView, notices: PublicNotice[] = [], intentId?: string): void {
    if (this.pendingAction?.intentId === intentId) this.pendingAction = null;
    if (this.view && this.view.phase !== 'roundEnd' && view.phase === 'roundEnd') {
      this.markReturningPlayer();
    }
    const change = deriveViewChange(this.view, view);
    this.lastPlayFromSelf = change.fromSelf;
    this.freshDeal = change.freshDeal;
    this.recentDiscards = nextDiscardPile(this.recentDiscards, view.discardTop, change.freshDeal);
    const seenNotices = [...this.noticeHistory, ...this.noticeQueue];
    const nextQueue = appendNoticeQueue(this.noticeQueue, notices, [
      ...seenNotices
    ]);
    this.noticeHistory = mergeNoticeHistory(this.noticeHistory, notices);
    const shouldScheduleNotice = this.noticeQueue.length === 0 && nextQueue.length > 0;
    this.noticeQueue = nextQueue;
    if (shouldScheduleNotice) this.scheduleNoticeDismissal();

    if (notices.length === 0) {
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
    if (this.screen !== 'game' && this.screen !== 'lobby') return;
    if (status === 'unstable') {
      this.recovery = nextRecoveryState(this.recovery, { type: 'transportUnstable' });
    } else if (status === 'connected' && this.recovery === 'unstable') {
      this.recovery = nextRecoveryState(this.recovery, { type: 'rejoined' });
    }
  }

  private handleGuestError(message: string, intentId?: string): void {
    if (this.pendingAction?.intentId === intentId) this.pendingAction = null;
    this.showToast(message);
  }

  private handleGuestClosed(): void {
    if (this.screen === 'fatal' || this.screen === 'home') return;
    // Both the lobby and the table recover in place — the room lives on the
    // server now, so any player (host included) can drop and slot back in.
    if ((this.screen !== 'game' && this.screen !== 'lobby') || !this.lastJoin) {
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
      if (outcome === 'seatUnavailable') {
        this.recovery = nextRecoveryState(this.recovery, { type: 'seatMissing' });
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
    const raw = connectRoom(code);
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
        let replayedPending = false;
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
        const adopt = (): boolean => {
          if (this.epoch !== epoch || this.recovery !== 'reconnecting') {
            finish('networkFailed');
            return false;
          }
          this.destroyPeer = destroy;
          this.guest = candidate;
          if (nextPlayerId) this.playerId = nextPlayerId;
          if (nextToken) writeStorage(tokenKey(code), nextToken);
          return true;
        };
        candidate = new GuestSession(conn, name.trim() || 'Player', token, false, {
          onWelcome: (playerId, freshToken) => {
            nextPlayerId = playerId;
            nextToken = freshToken;
          },
          onLobby: (lobby) => {
            // A pre-game drop lands back in the lobby (possibly on a fresh seat).
            if (!adopt()) return;
            this.lobby = lobby;
            this.screen = 'lobby';
            this.bumpSelectionEpoch();
            this.recovery = nextRecoveryState(this.recovery, { type: 'rejoined' });
            finish('joined');
          },
          onView: (view, notices, intentId) => {
            if (!adopt()) return;
            if (!replayedPending && this.pendingAction && intentId === undefined) {
              replayedPending = true;
              candidate!.send(this.pendingAction.action, this.pendingAction.intentId);
            }
            this.handleView(view, notices, intentId);
            finish('joined');
          },
          onRejected: (reason) => {
            if (typeof localStorage !== 'undefined' &&
                (reason === 'badToken' || reason === 'started')) {
              // The seat is gone for good (removed, or the game started
              // without a reclaimable token): stop retrying with it.
              localStorage.removeItem(tokenKey(code));
              finish('seatUnavailable');
              return;
            }
            if (reason === 'notFound') {
              finish('roomMissing');
              return;
            }
            finish('networkFailed');
          },
          onError: (_message, intentId) => {
            if (this.pendingAction?.intentId === intentId) this.pendingAction = null;
          },
          onClosed: () => finish('networkFailed'),
          onRoomClosed: () => finish('roomMissing'),
          onConnectionStatus: () => {}
        });
      });
    } catch {
      raw.then((r) => r.destroy()).catch(() => {});
      return 'networkFailed';
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
    const epoch = this.epoch;
    for (let attempt = 0; attempt < 2; attempt++) {
      const code = newRoomCode();
      const outcome = await this.tryCreateOnce(code, name, epoch);
      if (this.epoch !== epoch || outcome === 'created' || outcome === 'cancelled') return;
      if (outcome === 'failed') {
        this.fail('networkUnavailable');
        return;
      }
      // 'codeTaken' — roll another code and try again.
    }
    if (this.epoch !== epoch) return;
    this.fail('networkUnavailable');
  }

  private async tryCreateOnce(
    code: string, name: string, epoch: number
  ): Promise<'created' | 'codeTaken' | 'failed' | 'cancelled'> {
    const raw = connectRoom(code);
    try {
      const { conn, destroy } = await withTimeout(raw);
      if (this.epoch !== epoch) {
        conn.close();
        destroy();
        return 'cancelled';
      }
      return await new Promise((resolve) => {
        let settled = false;
        let candidate: GuestSession | null = null;
        const finish = (outcome: 'created' | 'codeTaken' | 'failed' | 'cancelled') => {
          if (settled) return;
          settled = true;
          if (outcome !== 'created') {
            candidate?.close();
            destroy();
          }
          resolve(outcome);
        };
        candidate = new GuestSession(conn, name.trim() || 'Host', null, true, {
          onWelcome: (playerId, token) => {
            this.playerId = playerId;
            writeStorage(tokenKey(code), token);
          },
          onLobby: (lobby) => {
            if (this.epoch !== epoch) {
              finish('cancelled');
              return;
            }
            this.destroyPeer = destroy;
            this.guest = candidate;
            this.roomCode = code;
            this.lastJoin = { code, name }; // hosts recover their seat too
            this.lobby = lobby;
            this.operation = null;
            this.screen = 'lobby';
            finish('created');
          },
          onView: (view, notices, intentId) => this.handleView(view, notices, intentId),
          onRejected: (reason) => finish(reason === 'codeTaken' ? 'codeTaken' : 'failed'),
          onError: (message, intentId) => this.handleGuestError(message, intentId),
          onClosed: () => {
            if (settled) this.handleGuestClosed();
            else finish('failed');
          },
          onRoomClosed: () => this.handleRoomClosed(),
          onConnectionStatus: (status) => this.handleGuestStatus(status)
        });
      });
    } catch {
      raw.then((r) => r.destroy()).catch(() => {});
      return this.epoch !== epoch ? 'cancelled' : 'failed';
    }
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
    const epoch = this.epoch;
    const raw = connectRoom(code);
    try {
      const { conn, destroy } = await withTimeout(raw);
      if (this.epoch !== epoch) {
        destroy();
        return;
      }
      this.destroyPeer = destroy;
      this.roomCode = code;
      this.guest = new GuestSession(conn, name.trim() || 'Player', readStorage(tokenKey(code)), false, {
        onWelcome: (playerId, token) => {
          this.playerId = playerId;
          writeStorage(tokenKey(code), token);
        },
        onLobby: (lobby) => {
          this.operation = null;
          this.lobby = lobby;
          this.screen = 'lobby';
        },
        onView: (view, notices, intentId) => this.handleView(view, notices, intentId),
        onRejected: (reason) => {
          if (typeof localStorage !== 'undefined' && (reason === 'badToken' || reason === 'notFound')) {
            localStorage.removeItem(tokenKey(code));
          }
          this.fail(fatalFromRejection(reason));
        },
        onError: (message, intentId) => this.handleGuestError(message, intentId),
        onClosed: () => this.handleGuestClosed(),
        onRoomClosed: () => this.handleRoomClosed(),
        onConnectionStatus: (status) => this.handleGuestStatus(status)
      });
    } catch {
      raw.then((r) => r.destroy()).catch(() => {});
      if (this.epoch !== epoch) return;
      this.fail('networkUnavailable');
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

  /** Sever this player's socket — host or guest — to exercise recovery. */
  dropConnectionForTest(): void {
    if (!import.meta.env.DEV || !this.guest) return;
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

  sendAction(action: Action): boolean {
    if (this.pendingAction || !this.guest) return false;
    const intentId = crypto.randomUUID();
    this.pendingAction = { type: action.type, action, startedAt: Date.now(), intentId };
    this.guest.send(action, intentId);
    return true;
  }

  startGame(): void {
    if (this.isHost) this.guest?.startGame();
  }

  setConfig(config: RuleConfig): void {
    if (this.isHost) this.guest?.setConfig(config);
  }

  skipTurn(playerId: string): void {
    if (this.isHost) this.guest?.skipTurn(playerId);
  }

  removeSeat(playerId: string): void {
    if (this.isHost) this.guest?.removeSeat(playerId);
  }

  /** The host ended the room: everyone else lands on the fatal screen. */
  private handleRoomClosed(): void {
    const code = this.roomCode ?? this.lastJoin?.code;
    if (code && typeof localStorage !== 'undefined') {
      localStorage.removeItem(tokenKey(code)); // the seat died with the room
    }
    this.fail('roomUnavailable');
  }

  leave(): void {
    this.epoch++;
    if (this.guest && this.roomCode) {
      // Deliberate exit: the host frees the seat immediately, so the stored
      // token now points at nothing — drop it or a later rejoin of the same
      // room would be rejected with badToken instead of seated fresh.
      this.guest.leave();
      if (typeof localStorage !== 'undefined') localStorage.removeItem(tokenKey(this.roomCode));
    }
    this.destroyPeer?.();
    this.guest?.close();
    this.guest = null;
    this.destroyPeer = null;
    this.roomCode = null;
    this.lobby = null;
    this.view = null;
    this.pendingAction = null;
    this.noticeHistory = [];
    this.noticeQueue = [];
    this.fxEvent = null;
    this.freshDeal = false;
    this.recentDiscards = [];
    clearTimeout(this.noticeTimer);
    this.operation = null;
    this.fatal = null;
    this.recovery = nextRecoveryState(this.recovery, { type: 'cancelled' });
    this.lastFailWasCreate = false;
    this.playerId = null;
    this.screen = 'home';
  }
}

export const session = new Session();
