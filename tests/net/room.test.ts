import { describe, it, expect, beforeEach } from 'vitest';
import { RoomSession } from '../../src/net/room';
import { createLoopbackPair, type Connection } from '../../src/net/transport';
import { PROTOCOL_VERSION, type ServerMsg } from '../../src/net/protocol';
import { DEFAULT_RULES, type GameState } from '../../src/engine/types';
import { C, fixedState } from '../engine/fixtures';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Test client: a raw wire end that records everything the room sends it. */
class Wire {
  received: ServerMsg[] = [];
  closed = false;
  conn: Connection;
  constructor(room: RoomSession) {
    const [clientEnd, roomEnd] = createLoopbackPair();
    this.conn = clientEnd;
    this.conn.onMessage((m) => this.received.push(m as ServerMsg));
    this.conn.onClose(() => (this.closed = true));
    room.attach(roomEnd);
  }
  hello(name: string, token: string | null = null, create = false, v = PROTOCOL_VERSION) {
    this.conn.send({ v, type: 'hello', name, token, create });
  }
  intent(action: unknown) {
    this.conn.send({ v: PROTOCOL_VERSION, type: 'intent', action });
  }
  cmd(msg: object) {
    this.conn.send({ v: PROTOCOL_VERSION, ...msg });
  }
  last<T extends ServerMsg['type']>(type: T) {
    return [...this.received].reverse().find((m) => m.type === type) as
      | Extract<ServerMsg, { type: T }>
      | undefined;
  }
}

/** A room with its host already seated at p0 (the common starting point). */
async function createdRoom(room: RoomSession, hostName = 'Host'): Promise<Wire> {
  const host = new Wire(room);
  host.hello(hostName, null, true);
  await flush();
  return host;
}

describe('RoomSession', () => {
  let room: RoomSession;

  beforeEach(() => {
    let n = 0;
    room = new RoomSession(() => 'token-' + n++);
  });

  it('rejects protocol version mismatches', async () => {
    const w = new Wire(room);
    w.hello('Old', null, true, 99);
    await flush();
    expect(w.last('rejected')?.reason).toBe('version');
    expect(w.closed).toBe(true); // rejection also closes the connection
  });

  it('create claims seat p0 and its host powers', async () => {
    const host = await createdRoom(room);
    expect(host.last('welcome')?.playerId).toBe('p0');
    expect(host.last('lobby')?.lobby.players).toEqual([
      { id: 'p0', name: 'Host', connected: true }
    ]);
  });

  it('joining a room nobody created is rejected with notFound', async () => {
    const w = new Wire(room);
    w.hello('Early');
    await flush();
    expect(w.last('rejected')?.reason).toBe('notFound');
    expect(w.closed).toBe(true);
  });

  it('creating an already-claimed code is rejected with codeTaken', async () => {
    await createdRoom(room);
    const clash = new Wire(room);
    clash.hello('Second', null, true);
    await flush();
    expect(clash.last('rejected')?.reason).toBe('codeTaken');
    expect(clash.closed).toBe(true);
  });

  it('seats guests and broadcasts the lobby', async () => {
    const host = await createdRoom(room);
    const w = new Wire(room);
    w.hello('Ada');
    await flush();
    expect(w.last('welcome')?.playerId).toBe('p1');
    expect(w.last('lobby')?.lobby.players.map((p) => p.name)).toEqual(['Host', 'Ada']);
    expect(host.last('lobby')?.lobby.players.map((p) => p.name)).toEqual(['Host', 'Ada']);
  });

  it('advertises canStart only once a second player is connected', async () => {
    await createdRoom(room);
    expect(room.lobbyInfo().canStart).toBe(false); // host alone
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    expect(room.lobbyInfo().canStart).toBe(true);
    expect(a.last('lobby')?.lobby.canStart).toBe(true);

    a.conn.close(); // disconnected guests do not count, same as start's guard
    await flush();
    expect(room.lobbyInfo().canStart).toBe(false);
  });

  it('rejects a 7th player and late joiners without a token', async () => {
    const host = await createdRoom(room);
    const wires = Array.from({ length: 5 }, () => new Wire(room));
    for (const [i, w] of wires.entries()) w.hello('G' + i);
    await flush();
    const seventh = new Wire(room);
    seventh.hello('TooMany');
    await flush();
    expect(seventh.last('rejected')?.reason).toBe('full');
    expect(seventh.closed).toBe(true);

    host.cmd({ type: 'start' });
    await flush();
    const late = new Wire(room);
    late.hello('Late');
    await flush();
    expect(late.last('rejected')?.reason).toBe('started');
    expect(late.closed).toBe(true);
  });

  it('start deals views: every player sees only their own hand', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    host.cmd({ type: 'start' });
    await flush();
    for (const w of [host, a]) {
      const view = w.last('view')!.view;
      expect(view.you.hand).toHaveLength(7);
      expect(view.players).toHaveLength(2);
      expect(JSON.stringify(view.players)).not.toContain('"hand"');
    }
  });

  it('host commands from a non-host are refused without effect', async () => {
    await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    a.cmd({ type: 'start' });
    a.cmd({ type: 'config', config: { ...DEFAULT_RULES, stacking: true } });
    a.cmd({ type: 'removeSeat', playerId: 'p0' });
    await flush();
    expect(a.last('error')?.message).toBe('Only the host can do that');
    expect(room.state).toBeNull();
    expect(room.lobbyInfo().config.stacking).toBe(false);
    expect(room.lobbyInfo().players.map((p) => p.id)).toEqual(['p0', 'p1']);
  });

  it('config from the host updates the lobby for everyone', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    host.cmd({ type: 'config', config: { ...DEFAULT_RULES, jumpIn: true } });
    await flush();
    expect(a.last('lobby')?.lobby.config.jumpIn).toBe(true);
  });

  it('routes intents: valid ones update everyone, invalid ones error the sender', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    host.cmd({ type: 'start' });
    await flush();
    const before = a.last('view')!.view;
    a.intent({ type: 'drawCard' }); // out of turn unless it is p1's turn
    await flush();
    if (before.turnPlayerId === 'p1') {
      expect(a.last('view')!.view).not.toEqual(before);
    } else {
      expect(a.last('error')).toBeDefined();
      expect(a.last('view')!.view).toEqual(before);
    }
  });

  it('sends public notices alongside the resulting view', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    host.cmd({ type: 'start' });
    await flush();
    room.state = fixedTwoPlayerState();
    a.intent({ type: 'playCard', cardId: 9001 });
    await flush();
    expect(room.lastNotices).toEqual([
      { id: 1, kind: 'play', actorId: 'p1', card: { color: 'red', value: 'draw2' } },
      { id: 2, kind: 'penalty', actorId: 'p1', targetId: 'p0', count: 2, pendingDraw: 2, stacked: false }
    ]);
    expect(host.last('view')?.notices?.every((n) => Number.isInteger(n.id))).toBe(true);
  });

  it('acknowledges an intent only on the acting player response', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    host.cmd({ type: 'start' });
    await flush();
    room.state = fixedTwoPlayerState();

    a.cmd({ type: 'intent', action: { type: 'playCard', cardId: 9001 }, intentId: 'intent-41' });
    await flush();

    expect(a.last('view')?.intentId).toBe('intent-41');
    expect(host.last('view')?.intentId).toBeUndefined();
  });

  it('echoes an intent id on an action error and accepts legacy intents without one', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    host.cmd({ type: 'start' });
    await flush();

    a.cmd({ type: 'intent', action: { type: 'callUno' }, intentId: 'intent-42' });
    await flush();
    expect(a.last('error')?.intentId).toBe('intent-42');

    expect(() => a.cmd({ type: 'intent', action: { type: 'callUno' } })).not.toThrow();
  });

  it('replays a successful acknowledgement without applying the action twice', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    host.cmd({ type: 'start' });
    await flush();
    room.state = fixedTwoPlayerState();
    const msg = { type: 'intent', action: { type: 'playCard', cardId: 9001 }, intentId: 'stable-success' };

    a.cmd(msg);
    await flush();
    const applied = structuredClone(room.state);
    a.cmd(msg);
    await flush();

    expect(room.state).toEqual(applied);
    expect(a.last('view')?.intentId).toBe('stable-success');
  });

  it('replays a cached error and persists dedupe outcome through snapshot restore', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    const token = a.last('welcome')!.token;
    host.cmd({ type: 'start' });
    await flush();
    a.cmd({ type: 'intent', action: { type: 'callUno' }, intentId: 'stable-error' });
    await flush();

    const woken = RoomSession.restore(structuredClone(room.snapshot()));
    const replay = reattachedWire(woken, token);
    replay.conn.send({ v: PROTOCOL_VERSION, type: 'intent', action: { type: 'drawCard' }, intentId: 'stable-error' });
    await flush();

    expect(replay.last('error')?.intentId).toBe('stable-error');
    expect(replay.last('error')?.message).toBe(a.last('error')?.message);
  });

  it('marks disconnects and restores a seat on token rejoin', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    const token = a.last('welcome')!.token;
    host.cmd({ type: 'start' });
    await flush();
    a.conn.close();
    await flush();
    expect(host.last('view')!.view.players[1]!.connected).toBe(false);
    expect(room.lastNotices).toEqual([{ id: 1, kind: 'disconnect', actorId: 'p1' }]);

    const back = new Wire(room);
    back.hello('Ada', token);
    await flush();
    expect(back.last('welcome')?.playerId).toBe('p1');
    expect(back.last('view')?.view.you.hand).toHaveLength(7);
    expect(host.last('view')!.view.players[1]!.connected).toBe(true);
    expect(room.lastNotices).toEqual([{ id: 2, kind: 'reconnect', actorId: 'p1' }]);
  });

  it('the host reclaims p0 by token after dropping mid-game', async () => {
    const host = await createdRoom(room);
    const hostToken = host.last('welcome')!.token;
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    host.cmd({ type: 'start' });
    await flush();
    host.conn.close();
    await flush();
    expect(a.last('view')!.view.players[0]!.connected).toBe(false);

    const back = new Wire(room);
    back.hello('Host', hostToken);
    await flush();
    expect(back.last('welcome')?.playerId).toBe('p0');
    expect(back.last('view')?.view.you.hand).toHaveLength(7);
    back.cmd({ type: 'config', config: DEFAULT_RULES }); // host powers intact…
    await flush();
    expect(back.last('error')).toBeUndefined(); // …(no refusal; in-game config is a no-op)
  });

  it('token rejoin supersedes a still-open connection without dropping the seat', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    const token = a.last('welcome')!.token;
    host.cmd({ type: 'start' });
    await flush();

    // Do NOT close a's wire — hello with the same token from a fresh connection.
    const takeover = new Wire(room);
    takeover.hello('Ada', token);
    await flush();

    expect(takeover.last('welcome')?.playerId).toBe('p1');
    expect(takeover.last('view')?.view.you.hand).toHaveLength(7);
    expect(a.closed).toBe(true); // the room closed the superseded connection
    // The old connection's onClose must not mark the seat disconnected.
    expect(host.last('view')!.view.players[1]!.connected).toBe(true);
    expect(room.lastNotices).toEqual([]);
  });

  it('does not throw on a malformed hello (non-string name/token) and still seats the guest', async () => {
    await createdRoom(room);
    const w = new Wire(room);
    expect(() => w.conn.send({ v: PROTOCOL_VERSION, type: 'hello', name: 42 as any, token: 7 as any, create: false }))
      .not.toThrow();
    await flush();
    expect(w.last('welcome')?.playerId).toBe('p1');
    const name = w.last('lobby')?.lobby.players.find((p) => p.id === 'p1')?.name;
    expect(typeof name).toBe('string');
    expect(name!.length).toBeGreaterThan(0);
  });

  it('a single connection sending hello twice (no token) only occupies one seat', async () => {
    await createdRoom(room);
    const w = new Wire(room);
    w.hello('Ada');
    await flush();
    w.hello('Ada again');
    await flush();
    const lobby = w.last('lobby')!.lobby;
    expect(lobby.players).toHaveLength(2); // host + one guest, not two guests
  });

  it('frees a guest seat on a lobby drop, but always reserves p0', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Libby');
    await flush();
    a.conn.close();
    await flush();
    // Pre-game there is nothing to hold a guest seat for — gone, not "Away".
    expect(room.lobbyInfo().players.map((p) => p.id)).toEqual(['p0']);

    host.conn.close();
    await flush();
    // The host seat is the room's identity: reserved even while away.
    expect(room.lobbyInfo().players).toEqual([
      { id: 'p0', name: 'Host', connected: false }
    ]);

    const retry = new Wire(room);
    retry.hello('Libby');
    await flush();
    expect(room.lobbyInfo().players.map((p) => p.name)).toEqual(['Host', 'Libby']);
  });

  it('a leave message mid-game deals the player out and the game continues', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    const b = new Wire(room);
    b.hello('Bob');
    await flush();
    host.cmd({ type: 'start' });
    await flush();
    a.cmd({ type: 'leave' });
    await flush();
    expect(room.state!.players.map((p) => p.id)).toEqual(['p0', 'p2']);
    expect(a.closed).toBe(true);
    expect(b.last('view')!.view.players.map((p) => p.id)).toEqual(['p0', 'p2']);
  });

  it("the host's leave closes the room for everyone and marks it for purge", async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    host.cmd({ type: 'start' });
    await flush();
    host.cmd({ type: 'leave' });
    await flush();
    expect(a.last('closed')?.reason).toBe('hostLeft');
    expect(a.closed).toBe(true);
    expect(room.closed).toBe(true);
    expect(room.state).toBeNull();
  });

  it('skipTurn force-ends an absent player turn; removeSeat deals them out', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    const b = new Wire(room);
    a.hello('Ada');
    b.hello('Bob');
    await flush();
    room.state = fixedPendingSkipState();
    host.cmd({ type: 'skipTurn', playerId: 'p1' });
    await flush();
    expect(room.state!.players[room.state!.turn]!.id).toBe('p2');
    expect(room.lastNotices).toEqual([{ id: 1, kind: 'draw', actorId: 'p1', count: 2 }]);

    host.cmd({ type: 'removeSeat', playerId: 'p1' });
    await flush();
    expect(room.state!.players.map((p) => p.id)).toEqual(['p0', 'p2']);
  });

  it('uses the injected seed when starting a game', async () => {
    const seeded = new RoomSession(() => 'token', () => 1234);
    const host = await createdRoom(seeded);
    const w = new Wire(seeded);
    w.hello('Ada');
    await flush();
    host.cmd({ type: 'start' });
    await flush();
    expect(seeded.state?.seed).toBe(1235); // deal() advances the supplied seed once
  });

  it('snapshot → restore → reattach survives hibernation mid-game', async () => {
    const host = await createdRoom(room);
    const a = new Wire(room);
    a.hello('Ada');
    await flush();
    const hostToken = host.last('welcome')!.token;
    const guestToken = a.last('welcome')!.token;
    host.cmd({ type: 'start' });
    await flush();
    const dealt = room.state!;

    // The DO evicts: only the snapshot and the raw sockets survive.
    const woken = RoomSession.restore(structuredClone(room.snapshot()));
    const host2 = reattachedWire(woken, hostToken);
    const guest2 = reattachedWire(woken, guestToken);
    await flush();

    expect(woken.state).toEqual(dealt);
    // Reattach is silent: no welcome, no reconnect notice.
    expect(host2.received).toEqual([]);
    expect(woken.lastNotices).toEqual([]);

    // Play continues over the reattached wires.
    const turnId = dealt.players[dealt.turn]!.id;
    const mover = turnId === 'p0' ? host2 : guest2;
    mover.intent({ type: 'drawCard' });
    await flush();
    expect(host2.last('view')).toBeDefined();
    expect(guest2.last('view')).toBeDefined();
    expect(woken.state).not.toEqual(dealt);
  });

  it('reattach with an unknown token reports failure', () => {
    const [clientEnd, roomEnd] = createLoopbackPair();
    void clientEnd;
    expect(room.reattach('no-such-token', roomEnd)).toBe(false);
  });
});

/** Wire whose room end is bound via reattach (hibernation wake) instead of hello. */
function reattachedWire(room: RoomSession, token: string): Wire2 {
  const [clientEnd, roomEnd] = createLoopbackPair();
  const wire = new Wire2(clientEnd);
  room.reattach(token, roomEnd);
  return wire;
}

class Wire2 {
  received: ServerMsg[] = [];
  constructor(public conn: Connection) {
    conn.onMessage((m) => this.received.push(m as ServerMsg));
  }
  intent(action: unknown) {
    this.conn.send({ v: PROTOCOL_VERSION, type: 'intent', action });
  }
  last<T extends ServerMsg['type']>(type: T) {
    return [...this.received].reverse().find((m) => m.type === type) as
      | Extract<ServerMsg, { type: T }>
      | undefined;
  }
}

function fixedTwoPlayerState(): GameState {
  return fixedState(
    [[C('blue', '3', 9000)], [C('red', 'draw2', 9001), C('yellow', '9', 9004)]],
    C('red', '5', 9003),
    { turn: 1 }
  );
}

function fixedPendingSkipState(): GameState {
  return fixedState(
    [[C('green', '7', 9100)], [C('blue', '3', 9101)], [C('yellow', '5', 9102)]],
    C('red', 'draw2', 9103),
    { pendingDraw: 2, pendingType: 'draw2', turn: 1 }
  );
}
