/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket base URL of the deployed wildcard-api Worker (wss://…). */
  readonly VITE_WS_URL?: string;
  /** Deterministic deal seed — set by dev/e2e tooling only. */
  readonly VITE_GAME_SEED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
