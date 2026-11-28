/**
 * Plano de relay e o pacote binário de 16 bytes.
 * O layout é o mesmo de `src-tauri/src/packet_buffer.rs`:
 * media, flags, seq u16, timestamp u32, frag idx, frag total, payload len u16, stream id u32.
 * Tudo em big-endian. O pacote inteiro cabe em 16_000 bytes.
 */

export const HEADER_BYTES = 16;
export const MAX_PACKET_BYTES = 16_000;
export const MAX_PAYLOAD_BYTES = MAX_PACKET_BYTES - HEADER_BYTES;
export const KEYFRAME_FLAG = 0x01;
export const RELAY_CHANNEL_LABEL = 'telinha-relay';
export const RELAY_CHANNEL_OPTIONS = { ordered: false, maxRetransmits: 0 };
const MIN_DIRECT_BITRATE_RATIO = 0.25;

export interface RelayHopView {
  peerId: string;
  parentId: string;
  hop: number;
}

export interface RelayPlan {
  streamId?: number;
  primaryRelayId: string | null;
  secondaryRelayId: string | null;
  splitEvenOdd: boolean;
  canLocalNodeRelay: boolean;
  sharerId?: string | null;
  hops?: RelayHopView[];
}

export interface TopologyView {
  mode: 'direct' | 'ai-relay';
  text: string;
  relayNodeId: string | null;
}

export interface EncodedFrame {
  data: ArrayBuffer;
  type?: string;
  timestamp?: number;
}

export function directBitrateCeiling(baseBitrate: number, directConnections: number): number {
  if (!Number.isFinite(baseBitrate) || baseBitrate <= 0) return 0;
  const count = Number.isFinite(directConnections) ? Math.floor(directConnections) : 1;
  if (count <= 1) return Math.floor(baseBitrate);
  const shared = Math.floor(baseBitrate / count);
  const floor = Math.floor(baseBitrate * MIN_DIRECT_BITRATE_RATIO);
  return Math.max(shared, floor);
}

export function gamingModeForFrameRate(frameRate: number): boolean {
  return frameRate >= 60;
}

export function relayTargetIds(plan: RelayPlan | null): string[] {
  if (!plan?.primaryRelayId) return [];
  const ids = [plan.primaryRelayId];
  if (plan.splitEvenOdd && plan.secondaryRelayId) ids.push(plan.secondaryRelayId);
  return ids;
}

export function viewersForRelay(
  relayId: string,
  plan: RelayPlan,
  desktopIds: string[],
  sharerId: string,
): string[] {
  const secondary = plan.splitEvenOdd ? plan.secondaryRelayId : null;
  if (!plan.primaryRelayId) return [];
  if (relayId !== plan.primaryRelayId && relayId !== secondary) return [];
  const excluded = new Set<string>([relayId, plan.primaryRelayId, sharerId]);
  if (secondary) excluded.add(secondary);
  const viewers = desktopIds.filter((id) => id.length > 0 && !excluded.has(id));
  const mine = !secondary || relayId === plan.primaryRelayId
    ? viewers.filter((_, index) => !secondary || index % 2 === 0)
    : viewers.filter((_, index) => index % 2 === 1);
  return mine.slice(0, 2);
}

export function directSenderIds(senderIds: string[], plan: RelayPlan | null): string[] {
  const relays = new Set(relayTargetIds(plan));
  return senderIds.filter((id) => !relays.has(id));
}

export function topologyView(plan: RelayPlan | null, active: boolean): TopologyView {
  if (!active || !plan?.primaryRelayId) {
    return { mode: 'direct', text: 'Rota Direta P2P', relayNodeId: null };
  }
  const relayNodeId = plan.splitEvenOdd && plan.secondaryRelayId
    ? `${plan.primaryRelayId} / ${plan.secondaryRelayId}`
    : plan.primaryRelayId;
  return {
    mode: 'ai-relay',
    text: 'Via Nó Relay IA (Zero-Transcoding)',
    relayNodeId,
  };
}

export function fragmentPayload(
  mediaType: number,
  flags: number,
  seqNumber: number,
  timestamp: number,
  streamId: number,
  payload: Uint8Array,
): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  if (payload.byteLength === 0) {
    chunks.push(new Uint8Array(0));
  } else {
    for (let offset = 0; offset < payload.byteLength; offset += MAX_PAYLOAD_BYTES) {
      chunks.push(payload.subarray(offset, Math.min(payload.byteLength, offset + MAX_PAYLOAD_BYTES)));
    }
  }
  if (chunks.length > 255) return [];
  return chunks.map((chunk, index) => encodePacket(
    mediaType,
    flags,
    seqNumber,
    timestamp,
    index,
    chunks.length,
    streamId,
    chunk,
  ));
}

export function encodePacket(
  mediaType: number,
  flags: number,
  seqNumber: number,
  timestamp: number,
  fragIdx: number,
  fragTotal: number,
  streamId: number,
  payload: Uint8Array,
): Uint8Array {
  const packet = new Uint8Array(HEADER_BYTES + payload.byteLength);
  const view = new DataView(packet.buffer);
  packet[0] = mediaType & 0xff;
  packet[1] = flags & 0xff;
  view.setUint16(2, seqNumber & 0xffff, false);
  view.setUint32(4, timestamp >>> 0, false);
  packet[8] = fragIdx & 0xff;
  packet[9] = fragTotal & 0xff;
  view.setUint16(10, payload.byteLength & 0xffff, false);
  view.setUint32(12, streamId >>> 0, false);
  packet.set(payload, HEADER_BYTES);
  return packet;
}

export interface ParsedPacket {
  mediaType: number;
  flags: number;
  seqNumber: number;
  timestamp: number;
  fragIdx: number;
  fragTotal: number;
  streamId: number;
  keyframe: boolean;
  payload: Uint8Array;
}

export function parsePacket(bytes: Uint8Array): ParsedPacket | null {
  if (bytes.byteLength < HEADER_BYTES || bytes.byteLength > MAX_PACKET_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fragIdx = bytes[8];
  const fragTotal = bytes[9];
  const payloadLen = view.getUint16(10, false);
  if (fragTotal === 0 || fragIdx >= fragTotal) return null;
  if (payloadLen > MAX_PAYLOAD_BYTES) return null;
  if (bytes.byteLength !== HEADER_BYTES + payloadLen) return null;
  const flags = bytes[1];
  return {
    mediaType: bytes[0],
    flags,
    seqNumber: view.getUint16(2, false),
    timestamp: view.getUint32(4, false),
    fragIdx,
    fragTotal,
    streamId: view.getUint32(12, false),
    keyframe: (flags & KEYFRAME_FLAG) !== 0,
    payload: bytes.subarray(HEADER_BYTES),
  };
}

export function packetizeEncodedFrame(frame: EncodedFrame, seq: number, streamId: number): Uint8Array[] {
  const flags = frame.type === 'key' ? KEYFRAME_FLAG : 0;
  const timestamp = Math.floor((frame.timestamp ?? 0) / 1000) >>> 0;
  return fragmentPayload(1, flags, seq & 0xffff, timestamp, streamId >>> 0, new Uint8Array(frame.data));
}

type EncodedStreams = {
  readable: ReadableStream<EncodedFrame>;
  writable: WritableStream<EncodedFrame>;
};

type EncodedSender = {
  createEncodedStreams?: () => EncodedStreams;
};

export function supportsEncodedStreams(sender: object): boolean {
  return typeof (sender as EncodedSender).createEncodedStreams === 'function';
}

/**
 * Lê o frame já codificado. `writeBack` devolve o mesmo frame ao RTP,
 * então o relay continua assistindo pelo vídeo normal se o datachannel cair.
 * Sem `createEncodedStreams`, devolve null e o WebRTC direto segue intacto.
 */
export function startEncodedPump(
  sender: object,
  onFrame: (frame: EncodedFrame) => void,
  writeBack: boolean,
): { stop: () => void } | null {
  const createEncodedStreams = (sender as EncodedSender).createEncodedStreams;
  if (typeof createEncodedStreams !== 'function') return null;
  let streams: EncodedStreams;
  try {
    streams = createEncodedStreams.call(sender);
  } catch {
    return null;
  }
  const reader = streams.readable.getReader();
  const writer = writeBack ? streams.writable.getWriter() : null;
  let stopped = false;
  void (async () => {
    try {
      while (!stopped) {
        const next = await reader.read();
        if (next.done || !next.value) break;
        onFrame(next.value);
        if (writer) await writer.write(next.value);
      }
    } catch {
      // Sender fechado: a conexão direta continua no caminho de sempre.
    } finally {
      try { reader.releaseLock(); } catch { /* já solto */ }
      if (writer) {
        try { await writer.close(); } catch { /* já fechado */ }
      }
    }
  })();
  return { stop: () => { stopped = true; } };
}

export function canPlayEncodedLocally(): boolean {
  const scope = globalThis as typeof globalThis & {
    VideoDecoder?: unknown;
    MediaStreamTrackGenerator?: unknown;
  };
  return typeof scope.VideoDecoder === 'function' && typeof scope.MediaStreamTrackGenerator === 'function';
}
