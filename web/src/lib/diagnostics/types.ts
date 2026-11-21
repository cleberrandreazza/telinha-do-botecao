/** Papel desta extremidade. Cada navegador só vê as próprias estatísticas. */
export type EndpointRole = 'sender' | 'receiver';

export type DiagnosisState = 'NORMAL' | 'ATENÇÃO' | 'CRÍTICO' | 'INDETERMINADO';

export type DiagnosisCategory =
  | 'CAPTURA/CODIFICAÇÃO'
  | 'REDE/TRANSPORTE'
  | 'RECEPÇÃO'
  | 'DECODIFICAÇÃO'
  | 'REPRODUÇÃO'
  | 'ESCALA'
  | 'NENHUMA';

export type DiagnosisConfidence = 'baixo' | 'médio' | 'alto';

export type EventSeverity = 'info' | 'atenção' | 'crítico';

export type IceRoute = 'direct' | 'relay' | 'unknown';

export type IceSelectionSource = 'transport' | 'selected' | 'nominated' | 'none';

export type PlaybackApi = 'rvfc' | 'playback-quality' | 'none';

/**
 * null = métrica não suportada ou ainda sem intervalo válido.
 * 0 = medição real de zero. Nunca substituir 0 pelo FPS configurado.
 */
export interface Diagnosis {
  category: DiagnosisCategory;
  state: DiagnosisState;
  reason: string;
  evidence: { name: string; value: string }[];
  timestamp: number;
  confidence: DiagnosisConfidence;
}

export interface LimitationDurations {
  none: number | null;
  cpu: number | null;
  bandwidth: number | null;
  other: number | null;
}

export interface OutboundMetrics {
  reportedFps: number | null;
  encodedFps: number | null;
  framesEncoded: number | null;
  sourceFps: number | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  sourceId: string | null;
  frameProductionVariation: number | null;
  sourceToEncodedGap: number | null;
  encodeTimePerFrameMs: number | null;
  totalEncodeTime: number | null;
  qualityLimitationReason: string | null;
  qualityLimitationDurations: LimitationDurations | null;
  targetBitrate: number | null;
  bytesSent: number | null;
  bitrate: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  keyFramesEncoded: number | null;
  keyFramesPerSec: number | null;
  nackCount: number | null;
  nackPerSec: number | null;
  pliCount: number | null;
  pliPerSec: number | null;
  firCount: number | null;
  firPerSec: number | null;
}

export interface InboundMetrics {
  reportedFps: number | null;
  receivedFps: number | null;
  framesReceived: number | null;
  decodedFps: number | null;
  framesDecoded: number | null;
  droppedFps: number | null;
  framesDropped: number | null;
  decodeTimePerFrameMs: number | null;
  totalDecodeTime: number | null;
  keyFramesDecoded: number | null;
  keyFramesPerSec: number | null;
  packetsReceived: number | null;
  packetsLost: number | null;
  lossPct: number | null;
  jitterMs: number | null;
  jitterBufferAvgDelayMs: number | null;
  jitterBufferDelay: number | null;
  jitterBufferEmittedCount: number | null;
  freezes: number | null;
  freezeCount: number | null;
  freezeDurationSec: number | null;
  totalFreezesDuration: number | null;
  nackCount: number | null;
  nackPerSec: number | null;
  pliCount: number | null;
  pliPerSec: number | null;
  firCount: number | null;
  firPerSec: number | null;
  bytesReceived: number | null;
  bitrate: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
}

/** Sinais RTCP que o outro lado devolveu. Não são medição local daquele navegador. */
export interface RemoteInboundMetrics {
  packetsLost: number | null;
  lossPct: number | null;
  jitterMs: number | null;
  rttMs: number | null;
}

export interface NetworkMetrics {
  rttMs: number | null;
  route: IceRoute;
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  protocol: string | null;
  availableOutgoingBitrate: number | null;
  availableIncomingBitrate: number | null;
  selectedPairId: string | null;
  selection: IceSelectionSource;
}

export interface PlaybackSample {
  timestamp: number;
  presentedFps: number | null;
  presentedFrames: number | null;
  totalPresentedFrames: number | null;
  droppedFrames: number | null;
  droppedFps: number | null;
  corruptedFrames: number | null;
  corruptedFps: number | null;
  irregularIntervals: number;
  freezeSuspected: boolean;
  paused: boolean;
  api: PlaybackApi;
}

export interface StreamConfigSnapshot {
  resolution: string;
  frameRate: number;
  audio: boolean;
}

export interface MetricSample {
  timestamp: number;
  connectionId: string;
  role: EndpointRole;
  /** null no receptor: ele não sabe quantos espectadores o transmissor tem. */
  viewerCount: number | null;
  configuredFps: number | null;
  connectionState: string | null;
  iceConnectionState: string | null;
  dtMs: number | null;
  countersReset: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  /** true só quando os bytes ou pacotes de áudio desta direção aumentaram no intervalo. */
  hasAudio: boolean;
  audioBitrate: number | null;
  audioRtp: AudioRtp | null;
  audio: AudioFacts | null;
  outbound: OutboundMetrics | null;
  inbound: InboundMetrics | null;
  remoteInbound: RemoteInboundMetrics | null;
  network: NetworkMetrics;
  playback: PlaybackSample | null;
}

export interface ChartPoint {
  t: number;
  sourceFps: number | null;
  encodedFps: number | null;
  receivedFps: number | null;
  decodedFps: number | null;
  presentedFps: number | null;
  lossPct: number | null;
  bitrate: number | null;
  rttMs: number | null;
  jitterMs: number | null;
}

export type AudioCode =
  | 'DISABLED'
  | 'NOT_CAPTURED'
  | 'CAPTURED_NOT_SENT'
  | 'NOT_NEGOTIATED'
  | 'NOT_RECEIVED'
  | 'RECEIVED_MUTED'
  | 'PLAYING'
  | 'SENDING'
  | 'INSUFFICIENT';

/** Contadores de áudio desta direção. Relatório RTP sem bytes não conta como áudio funcionando. */
export interface AudioRtp {
  codec: string | null;
  packets: number | null;
  packetsPerSec: number | null;
  bytes: number | null;
  bitrate: number | null;
  samples: number | null;
  samplesPerSec: number | null;
}

export interface AudioFacts {
  role: EndpointRole;
  requested: boolean | null;
  displaySurface: string | null;
  capturedTracks: number | null;
  trackReadyState: string | null;
  trackEnabled: boolean | null;
  trackMuted: boolean | null;
  senderAttached: boolean | null;
  negotiated: boolean | null;
  direction: string | null;
  remoteAudioTracks: number | null;
  packetsPerSec: number | null;
  bitrate: number | null;
  samplesPerSec: number | null;
  codec: string | null;
  playbackMuted: boolean | null;
  playbackVolume: number | null;
  playbackPaused: boolean | null;
  playbackBlocked: boolean | null;
  playError: string | null;
  elementAudioTracks: number | null;
}

export interface AudioDiagnosis {
  code: AudioCode;
  label: string;
  reason: string;
  timestamp: number;
}

export interface AudioPlaybackReport {
  muted: boolean;
  volume: number;
  paused: boolean;
  blocked: boolean;
  playError: string | null;
  elementAudioTracks: number;
  readyState: number;
}

export interface DiagEvent {
  timestamp: number;
  connectionId: string;
  category: DiagnosisCategory | 'SISTEMA' | 'ABR' | 'ÁUDIO';
  severity: EventSeverity;
  message: string;
  data: Record<string, number | string | null>;
}

export interface DiagnosticsSnapshot {
  sessionId: string;
  collectedFrom: number;
  streamConfig: StreamConfigSnapshot | null;
  adaptiveState: string | null;
  sample: MetricSample;
  diagnosis: Diagnosis;
  audioDiagnosis: AudioDiagnosis | null;
  chart: ChartPoint[];
  recentEvents: DiagEvent[];
}

export interface StatsReportLike {
  id: string;
  type: string;
  timestamp?: number;
  [key: string]: unknown;
}

export const HISTORY_LIMIT = 120;
export const CHART_LIMIT = 60;
export const EVENT_LIMIT = 150;
export const UNAVAILABLE_LABEL = 'n/d';
