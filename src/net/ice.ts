export interface TurnEnvironment {
  VITE_TURN_URLS?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
}

export function buildIceConfig(env: TurnEnvironment): RTCConfiguration | undefined {
  const urls = env.VITE_TURN_URLS?.split(',').map((url) => url.trim()).filter(Boolean) ?? [];
  const username = env.VITE_TURN_USERNAME?.trim();
  const credential = env.VITE_TURN_CREDENTIAL?.trim();
  if (urls.length === 0 || !username || !credential) return undefined;

  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls, username, credential }
    ]
  };
}
