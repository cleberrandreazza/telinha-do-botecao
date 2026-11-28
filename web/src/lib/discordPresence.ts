/** Teto mostrado no Discord. A árvore do desktop também para em 50. */
export const DISCORD_MAX_PEERS = 50;

export interface DiscordPresenceState {
  /** Publicação desativada pelo usuário: limpa a atividade do Discord. */
  enabled: boolean;
  inRoom: boolean;
  roomCode: string;
  isPrivate: boolean;
  isStreaming: boolean;
  viewerCount: number;
  maxPeers: number;
}

export interface PresenceInput {
  inRoom: boolean;
  roomCode: string;
  /** Senha da sala ou sala criada como privada no Discord. */
  roomPrivate: boolean;
  /** Interruptor "Ocultar atividade no Discord". */
  hideActivity: boolean;
  isStreaming: boolean;
  viewerCount: number;
  maxPeers?: number;
}

/**
 * Senha, sala marcada como privada ou o interruptor local.
 * O estado de ocultação desativa toda a presença, inclusive fora da sala.
 */
export function presenceIsPrivate(input: Pick<PresenceInput, 'inRoom' | 'roomPrivate' | 'hideActivity'>): boolean {
  return input.inRoom && (input.roomPrivate || input.hideActivity);
}

/**
 * Estado enviado ao desktop. Sala privada sai sem código:
 * o Rust também descarta party e botão quando `isPrivate` é verdadeiro.
 */
export function buildPresence(input: PresenceInput): DiscordPresenceState {
  const isPrivate = presenceIsPrivate(input);
  return {
    enabled: !input.hideActivity,
    inRoom: input.inRoom,
    roomCode: input.inRoom && !isPrivate ? input.roomCode : '',
    isPrivate,
    isStreaming: input.inRoom && input.isStreaming,
    viewerCount: input.inRoom ? input.viewerCount : 0,
    maxPeers: input.maxPeers && input.maxPeers > 0 ? input.maxPeers : DISCORD_MAX_PEERS,
  };
}

/** O interruptor só existe no app, com o pipe do Discord aceitando o handshake. */
export function discordHideSwitchVisible(desktop: boolean, connected: boolean): boolean {
  return desktop && connected;
}

async function invokeDiscord<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  const desktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!desktop) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

/** No site não há IPC. Falha do Discord não volta para a tela. */
export async function pushDiscordPresence(state: DiscordPresenceState): Promise<boolean> {
  const connected = await invokeDiscord<boolean>('update_discord_presence', { state });
  return connected === true;
}

/** `true` só depois do handshake no pipe local. Discord fechado devolve `false`. */
export async function readDiscordRpcStatus(): Promise<boolean> {
  const connected = await invokeDiscord<boolean>('get_discord_rpc_status');
  return connected === true;
}
