// ── Peers & Room ───────────────────────────────────────
export interface PeerInfo {
  id: string;
  nickname: string;
  isSharing: boolean;
  /** App desktop Tauri. Ausente em clientes antigos, que seguem no WebRTC direto. */
  isDesktop?: boolean;
}

export interface PeerTelemetryReport {
  rttMs: number;
  jitterMs: number;
  loss: number;
  uploadKbps: number;
  cpuPercent: number;
  activeChildren: number;
  isDesktop: boolean;
  /** Já é a raiz de uma das lives da sala. */
  isCurrentlyBroadcasting?: boolean;
  /** Streams diferentes que este peer já retransmite. */
  activeRelayedStreams?: number;
}

export interface RelayPlanReport {
  streamId?: number;
  primaryRelayId: string | null;
  secondaryRelayId: string | null;
  splitEvenOdd: boolean;
  canLocalNodeRelay: boolean;
}

export interface RoomState {
  code: string;
  peerId: string;
  peers: PeerInfo[];
}

// ── Grade de transmissões ───────────────────────────────

/**
 * Modo da grade: 1 (a live ocupa o palco inteiro), 2 (duas lado a lado,
 * altura total) ou 4 (2x2). O valor 3 não existe.
 */
export type GridMode = 1 | 2 | 4;

// ── Chat ───────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  from: string;
  nickname: string;
  text: string;
  ts: number;
  /**
   * Identificador estável do cliente (sessionStorage). Sobrevive ao F5, ao
   * contrário do `from` (peerId), que muda a cada conexão.
   */
  clientId?: string;
  /** Mensagem otimista: enviada pelo cliente, aguardando o eco do servidor. */
  pending?: boolean;
  /** O eco do servidor não chegou — a mensagem pode ter sido descartada. */
  failed?: boolean;
}

// ── Signaling messages (client → server) ───────────────
export type ClientMessage =
  | { type: 'create-room'; nickname: string; password?: string; isDesktop?: boolean }
  | { type: 'join-room'; code: string; nickname: string; password?: string; isDesktop?: boolean; ticket?: string }
  | { type: 'leave-room' }
  | { type: 'start-sharing' }
  | { type: 'stop-sharing' }
  | { type: 'request-stream'; sharerId: string }
  | { type: 'offer'; to: string; sdp: RTCSessionDescriptionInit; purpose?: 'relay-fanout' }
  | { type: 'answer'; to: string; sdp: RTCSessionDescriptionInit; purpose?: 'relay-fanout' }
  /** `linkRole` diz em que papel o candidato deve ser aplicado (ver lib/links.ts). `relay` é só o datachannel de fanout. */
  | { type: 'ice-candidate'; to: string; candidate: RTCIceCandidateInit; linkRole?: 'sender' | 'receiver' | 'relay' }
  | { type: 'chat-message'; text: string; clientId?: string }
  | { type: 'heartbeat' }
  | ({ type: 'peer-telemetry' } & PeerTelemetryReport)
  | ({ type: 'relay-plan' } & RelayPlanReport);

// ── Signaling messages (server → client) ───────────────
export type ServerMessage =
  | { type: 'room-created'; code: string; peerId: string; hasPassword: boolean; isPrivate?: boolean }
  | { type: 'room-joined'; code: string; peerId: string; peers: PeerInfo[]; isPrivate?: boolean }
  | { type: 'left-room' }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; peerId: string }
  | { type: 'sharing-started'; peerId: string; nickname: string }
  | { type: 'sharing-stopped'; peerId: string }
  | { type: 'stream-requested'; from: string; nickname: string }
  | { type: 'offer'; from: string; sdp: RTCSessionDescriptionInit; purpose?: 'relay-fanout' }
  | { type: 'answer'; from: string; sdp: RTCSessionDescriptionInit; purpose?: 'relay-fanout' }
  /** `linkRole` propagado pelo servidor; ausente significa "sem papel definido". */
  | { type: 'ice-candidate'; from: string; candidate: RTCIceCandidateInit; linkRole?: 'sender' | 'receiver' | 'relay' }
  | { type: 'chat-message'; from: string; nickname: string; text: string; ts: number; clientId?: string }
  | { type: 'chat-history'; messages: ChatMessage[] }
  | { type: 'error'; message: string }
  | { type: 'heartbeat-ack' }
  | ({ type: 'peer-telemetry'; from: string } & PeerTelemetryReport)
  | ({ type: 'relay-plan'; from: string } & RelayPlanReport);

// ── App state ──────────────────────────────────────────
export type AppScreen = 'home' | 'room';

export interface StreamInfo {
  peerId: string;
  nickname: string;
  stream: MediaStream;
}
