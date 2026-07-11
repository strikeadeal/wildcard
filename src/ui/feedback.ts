import type { PublicNotice } from './public-notices';

/**
 * Haptics + synthesized sound, gated behind a mute toggle. Pure helpers
 * (`cueForNotice`, `vibrationFor`, `readMuted`) are unit-tested; the impure
 * shell below (AudioContext, `navigator.vibrate`) mirrors the untested,
 * try/catch-wrapped DOM bits in `motion.ts` — no assets, everything is
 * synthesized on the fly, kept deliberately quiet (max gain ~0.15).
 */

export type Cue = 'play' | 'draw' | 'yourTurn' | 'win' | 'uno' | 'error';

export const MUTED_KEY = 'wildcard:muted';

/**
 * Maps a public notice to a feedback cue. Every `PublicNoticeKind` is
 * covered explicitly: played cards (including jump-ins) get the card-slap,
 * draws and draw penalties get the tick, uno/round-win get their own voice,
 * a dropped connection gets a sparing error blip, and the quiet, book-keeping
 * kinds (pass, color, swap, challenge, nextRound, skip, reverse, reconnect)
 * stay silent so the feedback layer doesn't chatter.
 */
export function cueForNotice(notice: PublicNotice, youId: string): Cue | null {
  switch (notice.kind) {
    case 'play':
    case 'jumpIn':
      return 'play';
    case 'draw':
    case 'penalty':
      return 'draw';
    case 'catch':
      // Being caught without a uno call stings a little; catching someone
      // else is just another draw.
      return notice.targetId === youId ? 'error' : 'draw';
    case 'uno':
      return 'uno';
    case 'roundWin':
      return 'win';
    case 'disconnect':
      return 'error';
    case 'reconnect':
    case 'pass':
    case 'color':
    case 'swap':
    case 'challenge':
    case 'nextRound':
    case 'skip':
    case 'reverse':
      return null;
  }
  // Compiler-enforced exhaustiveness: adding a PublicNoticeKind without a
  // case above fails the build here instead of going silently muted.
  const exhaustive: never = notice.kind;
  return exhaustive;
}

/** Vibration pattern (ms) per cue — short and understated throughout. */
export function vibrationFor(cue: Cue): number | number[] {
  switch (cue) {
    case 'play':
      return 15;
    case 'draw':
      return 8;
    case 'yourTurn':
      return [20, 30, 20];
    case 'win':
      return [25, 40, 25, 40, 70];
    case 'uno':
      return 25;
    case 'error':
      return [40, 30, 40];
  }
}

type StorageLike = Pick<Storage, 'getItem'>;

/** Reads the persisted mute flag; tolerant of a missing/unavailable storage. */
export function readMuted(storage: StorageLike | null | undefined): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Impure shell below — no unit tests (like the DOM bits in motion.ts).

function localStorageOrNull(): StorageLike | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

let muted = readMuted(localStorageOrNull());
let audioCtx: AudioContext | null = null;
let gestureBound = false;

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(MUTED_KEY, value ? '1' : '0');
  } catch {
    /* ignore persistence failures (private mode, quota, ...) */
  }
}

function createAudioContext(): AudioContext | null {
  try {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

/**
 * Registers an app-shell gesture listener that lazily creates the
 * AudioContext — browsers block audio until a user gesture, so nothing
 * happens on load. Safe to call more than once; only the first call binds,
 * and the listener is removed even when audio initialization fails.
 */
export function initFeedback(): void {
  if (gestureBound || typeof window === 'undefined') return;
  gestureBound = true;
  const onGesture = () => {
    try {
      if (!audioCtx) audioCtx = createAudioContext();
      // Some browsers create the context suspended even inside a gesture —
      // resume here or sound stays dead for the whole session (the listener
      // is one-shot and playCue no-ops on a suspended context).
      if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
    } catch {
      /* ignore */
    }
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
  };
  try {
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
  } catch {
    /* ignore */
  }
}

function tone(
  ctx: AudioContext,
  opts: { freq: number; start: number; duration: number; type?: OscillatorType; gain: number }
): void {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.value = opts.freq;
  const t0 = ctx.currentTime + opts.start;
  const t1 = t0 + opts.duration;
  gainNode.gain.setValueAtTime(0, t0);
  gainNode.gain.linearRampToValueAtTime(opts.gain, t0 + Math.min(0.01, opts.duration / 4));
  gainNode.gain.linearRampToValueAtTime(0, t1);
  osc.connect(gainNode).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

function noiseSlap(ctx: AudioContext, start: number, duration: number, gain: number): void {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1400;
  filter.Q.value = 0.8;
  const gainNode = ctx.createGain();
  const t0 = ctx.currentTime + start;
  gainNode.gain.setValueAtTime(gain, t0);
  gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  src.connect(filter).connect(gainNode).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + duration + 0.01);
}

/** Synthesizes one short voice per cue. Kept modest — feedback, not a score. */
function synthesize(ctx: AudioContext, cue: Cue): void {
  const MAX = 0.15;
  switch (cue) {
    case 'play':
      noiseSlap(ctx, 0, 0.05, MAX);
      tone(ctx, { freq: 90, start: 0, duration: 0.09, type: 'sine', gain: MAX * 0.8 });
      break;
    case 'draw':
      tone(ctx, { freq: 1200, start: 0, duration: 0.005, type: 'square', gain: MAX * 0.6 });
      break;
    case 'yourTurn':
      tone(ctx, { freq: 659.25, start: 0, duration: 0.11, type: 'sine', gain: MAX });
      tone(ctx, { freq: 880, start: 0.12, duration: 0.14, type: 'sine', gain: MAX });
      break;
    case 'win':
      for (const [i, freq] of [523.25, 659.25, 783.99, 1046.5].entries()) {
        tone(ctx, { freq, start: i * 0.09, duration: 0.11, type: 'sine', gain: MAX });
      }
      break;
    case 'uno':
      tone(ctx, { freq: 1046.5, start: 0, duration: 0.13, type: 'triangle', gain: MAX });
      break;
    case 'error':
      tone(ctx, { freq: 180, start: 0, duration: 0.14, type: 'square', gain: MAX * 0.7 });
      break;
  }
}

/**
 * Plays a cue's sound + vibration. No-ops when muted, the tab is hidden, or
 * the AudioContext is missing/suspended (autoplay policy before the first
 * gesture) — every impure call is try/catch-wrapped so a synthesis or
 * permissions failure never surfaces to the game.
 */
export function playCue(cue: Cue): void {
  try {
    if (isMuted()) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!audioCtx || audioCtx.state === 'suspended') return;
    synthesize(audioCtx, cue);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(vibrationFor(cue));
    }
  } catch {
    /* ignore — feedback is best-effort */
  }
}
