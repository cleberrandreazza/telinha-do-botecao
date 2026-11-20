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
  | { type: 'ice-candidate'; to: string; candidate: RTCIceCandidateInit }
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
  | { type: 'ice-candidate'; from: string; candidate: RTCIceCandidateInit }
  | { type: 'error'; message: string }
  | { type: 'heartbeat-ack' };

// ── App state ──────────────────────────────────────────
export type AppScreen = 'home' | 'room';

export interface StreamInfo {
  peerId: string;
  nickname: string;
  stream: MediaStream;
}
