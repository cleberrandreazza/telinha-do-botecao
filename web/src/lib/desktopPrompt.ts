/** Executável da última release publicada no GitHub. */
export const DESKTOP_APP_DOWNLOAD_URL =
  'https://github.com/cleberrandreazza/telinha-do-botecao/releases/latest/download/telinha-do-botecao.exe';

export const DESKTOP_APP_BENEFIT =
  'Transmissão nativa 1080p/60fps, áudio isolado por programa e rede P2P inteligente.';

export const DESKTOP_SHARE_PROMPT =
  'Para transmitir com qualidade máxima (1080p/60fps, áudio isolado por aplicativo e distribuição P2P sem travamentos para vários espectadores), recomendamos usar o aplicativo desktop do Telinha do Botecão.';

export const DESKTOP_VIEWER_HINT =
  'Ajude a melhorar a estabilidade da sala para todos usando o App Desktop';

/** Teto da Web quando a sala não tem relay desktop. */
export const WEB_LIMITED_MAX_RESOLUTION = '720' as const;
export const WEB_LIMITED_MAX_FRAME_RATE = 30;

const RESOLUTION_RANK: Record<string, number> = {
  '480': 1,
  '720': 2,
  '1080': 3,
  '2160': 4,
};

export interface DesktopPromptPeer {
  id: string;
  isDesktop?: boolean;
}

/** Outras pessoas na sala, que receberiam a transmissão. */
export function viewerCount(peers: DesktopPromptPeer[], myPeerId: string): number {
  return peers.filter((peer) => peer.id !== myPeerId).length;
}

/** Alguém além de quem vai transmitir está no app desktop e pode retransmitir. */
export function hasDesktopRelay(peers: DesktopPromptPeer[], myPeerId: string): boolean {
  return peers.some((peer) => peer.id !== myPeerId && peer.isDesktop === true);
}

/**
 * Web prestes a transmitir para 2 ou mais pessoas, sem nenhum app desktop na sala.
 * No app Tauri isto fica sempre falso.
 */
export function webShareNeedsDesktopPrompt(input: {
  isDesktopApp: boolean;
  peers: DesktopPromptPeer[];
  myPeerId: string;
}): boolean {
  if (input.isDesktopApp) return false;
  if (viewerCount(input.peers, input.myPeerId) < 2) return false;
  return !hasDesktopRelay(input.peers, input.myPeerId);
}

/**
 * Espectador Web numa sala com 3 ou mais pessoas, maioria no navegador e
 * nenhum relay desktop. Quem transmite e quem já está no app não vê o aviso.
 */
export function webViewerShouldSuggestDesktop(input: {
  isDesktopApp: boolean;
  isSharing: boolean;
  peers: DesktopPromptPeer[];
}): boolean {
  if (input.isDesktopApp || input.isSharing) return false;
  if (input.peers.length < 3) return false;
  const desktop = input.peers.filter((peer) => peer.isDesktop === true).length;
  const web = input.peers.length - desktop;
  return desktop === 0 && web > input.peers.length / 2;
}

export function clampWebPreset<R extends string, F extends number>(
  resolution: R,
  frameRate: F,
  limited: boolean,
): { resolution: R; frameRate: F } {
  if (!limited) return { resolution, frameRate };
  const rank = RESOLUTION_RANK[resolution] ?? RESOLUTION_RANK[WEB_LIMITED_MAX_RESOLUTION];
  const nextResolution = (rank > RESOLUTION_RANK[WEB_LIMITED_MAX_RESOLUTION]
    ? WEB_LIMITED_MAX_RESOLUTION
    : resolution) as R;
  const nextFrame = (frameRate > WEB_LIMITED_MAX_FRAME_RATE
    ? WEB_LIMITED_MAX_FRAME_RATE
    : frameRate) as F;
  return { resolution: nextResolution, frameRate: nextFrame };
}
