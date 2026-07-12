import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../../src/engine/types';
import { decodeClientMsg } from '../../src/net/decode-client-msg';
import { PROTOCOL_VERSION } from '../../src/net/protocol';

describe('decodeClientMsg', () => {
  it.each([
    { v: PROTOCOL_VERSION, type: 'hello', name: 'Ada', token: null, create: false },
    { v: PROTOCOL_VERSION, type: 'hello', name: 'Ada', token: 'seat-token', create: true },
    { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'drawCard' }, intentId: 'intent-1' },
    { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'playCard', cardId: 7, chosenColor: 'red', swapTargetId: 'p1' } },
    { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'chooseColor', color: 'blue' } },
    { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'chooseSwapTarget', targetId: 'p1' } },
    { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'catchUno', targetId: 'p1' } },
    { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'jumpIn', cardId: 9 } },
    { v: PROTOCOL_VERSION, type: 'config', config: DEFAULT_RULES },
    { v: PROTOCOL_VERSION, type: 'start' },
    { v: PROTOCOL_VERSION, type: 'leave' },
    { v: PROTOCOL_VERSION, type: 'skipTurn', playerId: 'p1' },
    { v: PROTOCOL_VERSION, type: 'removeSeat', playerId: 'p1' }
  ])('accepts a valid $type message', (raw) => {
    expect(decodeClientMsg(raw)).toEqual({ ok: true, msg: raw });
  });

  it('distinguishes version mismatches', () => {
    expect(decodeClientMsg({ v: 999, type: 'start' })).toEqual({ ok: false, reason: 'version' });
  });

  it.each([
    null,
    [],
    { v: PROTOCOL_VERSION },
    { v: PROTOCOL_VERSION, type: 'wat' },
    { v: PROTOCOL_VERSION, type: 'hello', name: 1, token: null, create: false },
    { v: PROTOCOL_VERSION, type: 'hello', name: 'Ada', token: 12, create: false },
    { v: PROTOCOL_VERSION, type: 'intent', action: null },
    { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'playCard', cardId: 1.5 } },
    { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'playCard', cardId: 1, chosenColor: 'orange' } },
    { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'chooseColor', color: 'orange' } },
    { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'chooseSwapTarget', targetId: '' } },
    { v: PROTOCOL_VERSION, type: 'intent', action: { type: 'drawCard' }, intentId: 'x'.repeat(129) },
    { v: PROTOCOL_VERSION, type: 'config', config: { stacking: true } },
    { v: PROTOCOL_VERSION, type: 'config', config: { ...DEFAULT_RULES, stacking: 'yes' } },
    { v: PROTOCOL_VERSION, type: 'skipTurn', playerId: '' },
    { v: PROTOCOL_VERSION, type: 'removeSeat', playerId: 3 }
  ])('rejects malformed input %#', (raw) => {
    expect(decodeClientMsg(raw).ok).toBe(false);
  });
});
