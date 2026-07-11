import { normalizeCode } from '../../src/net/codes';

export { RoomDO } from './room-do';

export interface Env {
  ROOM: DurableObjectNamespace;
  /** Optional deterministic deal seed — set by e2e's wrangler dev only. */
  GAME_SEED?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response('wildcard-api', { status: 200 });
    }
    const match = url.pathname.match(/^\/room\/([^/]+)$/);
    const code = match ? normalizeCode(match[1]!) : null;
    if (!code) return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a websocket', { status: 426 });
    }
    // One Durable Object per room code: the room's single source of truth.
    return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
  }
};
