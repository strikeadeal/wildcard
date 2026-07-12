import { COLORS } from '../engine/deck';
import type { Action, Color, RuleConfig } from '../engine/types';
import { PROTOCOL_VERSION, type ClientMsg } from './protocol';

export type DecodeClientMsgResult =
  | { ok: true; msg: ClientMsg }
  | { ok: false; reason: 'shape' | 'version' | 'type' | 'payload' };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max = 128, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.length > 0);
}

function isColor(value: unknown): value is Color {
  return COLORS.includes(value as Color);
}

function optionalColor(value: unknown): value is Color | undefined {
  return value === undefined || isColor(value);
}

function optionalId(value: unknown): value is string | undefined {
  return value === undefined || boundedString(value);
}

function isCardId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function decodeAction(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  switch (value.type) {
    case 'playCard':
    case 'jumpIn':
      if (!isCardId(value.cardId) || !optionalColor(value.chosenColor) || !optionalId(value.swapTargetId)) return null;
      return {
        type: value.type,
        cardId: value.cardId,
        ...(value.chosenColor === undefined ? {} : { chosenColor: value.chosenColor }),
        ...(value.swapTargetId === undefined ? {} : { swapTargetId: value.swapTargetId })
      };
    case 'chooseColor':
      return isColor(value.color) ? { type: 'chooseColor', color: value.color } : null;
    case 'chooseSwapTarget':
      return boundedString(value.targetId) ? { type: 'chooseSwapTarget', targetId: value.targetId } : null;
    case 'catchUno':
      return boundedString(value.targetId) ? { type: 'catchUno', targetId: value.targetId } : null;
    case 'drawCard':
    case 'passTurn':
    case 'callUno':
    case 'challengeWildFour':
    case 'nextRound':
      return { type: value.type };
    default:
      return null;
  }
}

function decodeConfig(value: unknown): RuleConfig | null {
  if (!isRecord(value)) return null;
  const keys = ['stacking', 'jumpIn', 'drawUntilPlayable', 'sevenZero'] as const;
  if (!keys.every((key) => typeof value[key] === 'boolean')) return null;
  return {
    stacking: value.stacking as boolean,
    jumpIn: value.jumpIn as boolean,
    drawUntilPlayable: value.drawUntilPlayable as boolean,
    sevenZero: value.sevenZero as boolean
  };
}

export function decodeClientMsg(raw: unknown): DecodeClientMsgResult {
  if (!isRecord(raw)) return { ok: false, reason: 'shape' };
  if (raw.v !== PROTOCOL_VERSION) return { ok: false, reason: 'version' };
  if (typeof raw.type !== 'string') return { ok: false, reason: 'type' };

  switch (raw.type) {
    case 'hello': {
      if (!boundedString(raw.name, 100, true) ||
          !(raw.token === null || boundedString(raw.token, 256)) ||
          typeof raw.create !== 'boolean') {
        return { ok: false, reason: 'payload' };
      }
      return { ok: true, msg: { v: PROTOCOL_VERSION, type: 'hello', name: raw.name, token: raw.token, create: raw.create } };
    }
    case 'intent': {
      const action = decodeAction(raw.action);
      if (!action || !(raw.intentId === undefined || boundedString(raw.intentId))) {
        return { ok: false, reason: 'payload' };
      }
      return {
        ok: true,
        msg: {
          v: PROTOCOL_VERSION,
          type: 'intent',
          action,
          ...(raw.intentId === undefined ? {} : { intentId: raw.intentId })
        }
      };
    }
    case 'config': {
      const config = decodeConfig(raw.config);
      return config
        ? { ok: true, msg: { v: PROTOCOL_VERSION, type: 'config', config } }
        : { ok: false, reason: 'payload' };
    }
    case 'skipTurn':
    case 'removeSeat':
      return boundedString(raw.playerId)
        ? { ok: true, msg: { v: PROTOCOL_VERSION, type: raw.type, playerId: raw.playerId } }
        : { ok: false, reason: 'payload' };
    case 'leave':
    case 'start':
      return { ok: true, msg: { v: PROTOCOL_VERSION, type: raw.type } };
    default:
      return { ok: false, reason: 'type' };
  }
}
