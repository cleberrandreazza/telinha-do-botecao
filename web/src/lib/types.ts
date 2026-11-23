// ── Peers & Room ───────────────────────────────────────
export interface PeerInfo {
  id: string;
  nickname: string;
  isSharing: boolean;
}

export interface RoomState {
  code: string;
  peerId: string;
  peers: PeerInfo[];
}

// ── Chat ───────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  from: string;
  nickname: string;
  text: string;
  ts: number;
  /** Mensagem otimista: enviada pelo cliente, aguardando o eco do servidor. */
  pending?: boolean;
  /** O eco do servidor não chegou — a mensagem pode ter sido descartada. */
  failed?: boolean;
}

// ── Signaling messages (client → server) ───────────────
export type ClientMessage =
  | { type: 'create-room'; nickname: string; password?: string }
  | { type: 'join-room'; code: string; nickname: string; password?: string }
  | { type: 'leave-room' }
  | { type: 'start-sharing' }
  | { type: 'stop-sharing' }
  | { type: 'request-stream'; sharerId: string }
  | { type: 'offer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; to: string; sdp: RTCSessionDescriptionInit }
  /** `linkRole` diz em que papel o candidato deve ser aplicado (ver lib/links.ts). */
  | { type: 'ice-candidate'; to: string; candidate: RTCIceCandidateInit; linkRole?: 'sender' | 'receiver' }
  | { type: 'chat-message'; text: string }
  | { type: 'heartbeat' };

// ── Signaling messages (server → client) ───────────────
export type ServerMessage =
  | { type: 'room-created'; code: string; peerId: string; hasPassword: boolean }
  | { type: 'room-joined'; code: string; peerId: string; peers: PeerInfo[] }
  | { type: 'left-room' }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; peerId: string }
  | { type: 'sharing-started'; peerId: string; nickname: string }
  | { type: 'sharing-stopped'; peerId: string }
  | { type: 'stream-requested'; from: string; nickname: string }
  | { type: 'offer'; from: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; from: string; sdp: RTCSessionDescriptionInit }
  /** `linkRole` propagado pelo servidor; ausente significa "sem papel definido". */
  | { type: 'ice-candidate'; from: string; candidate: RTCIceCandidateInit; linkRole?: 'sender' | 'receiver' }
  | { type: 'chat-message'; from: string; nickname: string; text: string; ts: number }
  | { type: 'chat-history'; messages: ChatMessage[] }
  | { type: 'error'; message: string }
  | { type: 'heartbeat-ack' };

// ── App state ──────────────────────────────────────────
export type AppScreen = 'home' | 'room';

export interface StreamInfo {
  peerId: string;
  nickname: string;
  stream: MediaStream;
}
