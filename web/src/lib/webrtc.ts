import { SignalingClient } from './signaling';
import type { ServerMessage, StreamInfo } from './types';

export interface StreamConfig {
  resolution: '2160' | '1080' | '720' | '480';
  frameRate: 30 | 15 | 5;
  audio: boolean;
}

const RESOLUTION_MAP: Record<string, { width: number; height: number }> = {
  '2160': { width: 3840, height: 2160 },
  '1080': { width: 1920, height: 1080 },
  '720': { width: 1280, height: 720 },
  '480': { width: 854, height: 480 },
};

/** Bitrate limits per resolution (bits/s) */
const BITRATE_MAP: Record<string, number> = {
  '2160': 12_000_000,
  '1080': 6_000_000,
  '720': 3_000_000,
  '480': 1_500_000,
};

/**
 * Servidores ICE (STUN + TURN gratuito via Open Relay)
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export interface ConnectionStats {
  videoCodec: string;
  audioCodec: string;
  videoBitrate: number;  // bits/s
  audioBitrate: number;  // bits/s
  fps: number;
  width: number;
  height: number;
  packetLoss: number;      // packets lost (cumulative)
  packetLossRate: number;  // % of packets lost
  roundTripTime: number;   // ms
  hasAudio: boolean;
  jitter: number;
  timestamp: number;
  // Adaptive bitrate info
  adaptiveState?: string;  // current ABR state description
}

type OnStreamCallback = (info: StreamInfo) => void;
type OnStreamEndCallback = (peerId: string) => void;

/**
 * Adaptive Bitrate Controller
 * Monitors FPS and adjusts bitrate dynamically to maintain stable framerate
 */
class AdaptiveBitrateController {
  private targetFps: number;
  private currentMaxBitrate: number;
  private minBitrate = 500_000;      // 500 Kbps absolute minimum
  private initialBitrate: number;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private pc: RTCPeerConnection;
  private lowFpsCount = 0;           // consecutive polls with low FPS
  private highFpsCount = 0;          // consecutive polls with healthy FPS
  private lastBytesReceived = 0;
  private lastTimestamp = 0;
  private currentFps = 0;
  private currentBitrate = 0;        // actual measured bitrate

  // Thresholds
  private readonly LOW_FPS_THRESHOLD = 0.6;   // below 60% of target = too low
  private readonly HIGH_FPS_THRESHOLD = 0.85;  // above 85% of target = healthy
  private readonly DECREASE_STEP = 0.7;        // reduce by 30% when struggling
  private readonly INCREASE_STEP = 1.15;       // increase by 15% when stable
  private readonly MIN_LOW_POLLS = 3;          // need 3 consecutive low polls to reduce
  private readonly MIN_HIGH_POLLS = 10;        // need 10 consecutive high polls to increase

  constructor(pc: RTCPeerConnection, targetFps: number, maxBitrate: number) {
    this.pc = pc;
    this.targetFps = targetFps;
    this.currentMaxBitrate = maxBitrate;
    this.initialBitrate = maxBitrate;
  }

  start() {
    // Poll every 2 seconds
    this.pollInterval = setInterval(() => this.evaluate(), 2000);
    console.log(`[ABR] Started: target=${this.targetFps}fps, maxBitrate=${(this.currentMaxBitrate / 1_000_000).toFixed(1)}Mbps`);
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  getState(): string {
    const pct = Math.round((this.currentMaxBitrate / this.initialBitrate) * 100);
    return `${(this.currentMaxBitrate / 1_000_000).toFixed(1)}Mbps (${pct}%)`;
  }

  private async evaluate() {
    try {
      const stats = await this.pc.getStats();
      let fps = 0;

      stats.forEach((report) => {
        // Check outbound (sharer side) for FPS
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          fps = report.framesPerSecond || 0;
        }
        // Also check inbound (viewer side)
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          fps = fps || report.framesPerSecond || 0;

          // Track actual bitrate
          if (this.lastTimestamp > 0) {
            const dtMs = report.timestamp - this.lastTimestamp;
            if (dtMs > 0) {
              this.currentBitrate = Math.round(((report.bytesReceived - this.lastBytesReceived) * 8) / (dtMs / 1000));
            }
          }
          this.lastBytesReceived = report.bytesReceived;
          this.lastTimestamp = report.timestamp;
        }
      });

      this.currentFps = fps;
      const fpsRatio = fps / this.targetFps;

      if (fpsRatio < this.LOW_FPS_THRESHOLD && fps > 0) {
        this.lowFpsCount++;
        this.highFpsCount = 0;

        if (this.lowFpsCount >= this.MIN_LOW_POLLS) {
          this.decreaseBitrate();
          this.lowFpsCount = 0;
        }
      } else if (fpsRatio >= this.HIGH_FPS_THRESHOLD) {
        this.highFpsCount++;
        this.lowFpsCount = 0;

        if (this.highFpsCount >= this.MIN_HIGH_POLLS && this.currentMaxBitrate < this.initialBitrate) {
          this.increaseBitrate();
          this.highFpsCount = 0;
        }
      } else {
        // In the middle zone — reset counters
        this.lowFpsCount = Math.max(0, this.lowFpsCount - 1);
        this.highFpsCount = Math.max(0, this.highFpsCount - 1);
      }
    } catch {
      // stats can fail during renegotiation
    }
  }

  private decreaseBitrate() {
    const newBitrate = Math.max(this.minBitrate, Math.round(this.currentMaxBitrate * this.DECREASE_STEP));
    if (newBitrate < this.currentMaxBitrate) {
      console.log(`[ABR] ⬇️ FPS baixo (${this.currentFps.toFixed(0)}/${this.targetFps}), reduzindo bitrate: ${(this.currentMaxBitrate / 1_000_000).toFixed(1)}→${(newBitrate / 1_000_000).toFixed(1)}Mbps`);
      this.currentMaxBitrate = newBitrate;
      this.applyBitrate();
    }
  }

  private increaseBitrate() {
    const newBitrate = Math.min(this.initialBitrate, Math.round(this.currentMaxBitrate * this.INCREASE_STEP));
    if (newBitrate > this.currentMaxBitrate) {
      console.log(`[ABR] ⬆️ FPS estável (${this.currentFps.toFixed(0)}/${this.targetFps}), aumentando bitrate: ${(this.currentMaxBitrate / 1_000_000).toFixed(1)}→${(newBitrate / 1_000_000).toFixed(1)}Mbps`);
      this.currentMaxBitrate = newBitrate;
      this.applyBitrate();
    }
  }

  private applyBitrate() {
    const videoSender = this.pc.getSenders().find(s => s.track?.kind === 'video');
    if (!videoSender) return;

    try {
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = this.currentMaxBitrate;
      videoSender.setParameters(params).then(() => {
        console.log(`[ABR] ✅ Bitrate aplicado: ${(this.currentMaxBitrate / 1_000_000).toFixed(1)}Mbps`);
      }).catch(e => {
        console.warn('[ABR] Falha ao aplicar bitrate:', e);
      });
    } catch (e) {
      console.warn('[ABR] Erro ao configurar params:', e);
    }
  }
}

export class WebRTCManager {
  private signal: SignalingClient;
  private connections = new Map<string, RTCPeerConnection>();
  private localStream: MediaStream | null = null;
  private currentConfig: StreamConfig = { resolution: '1080', frameRate: 30, audio: true };
  private myPeerId = '';
  private onStream: OnStreamCallback;
  private onStreamEnd: OnStreamEndCallback;
  private unsubSignal: (() => void) | null = null;
  private notifiedPeers = new Set<string>();
  public hasAudioTrack = false;
  public onAudioStatus?: (captured: boolean) => void;
  private _prevStats = new Map<string, { bytes: number; timestamp: number; packetsLost: number; packetsReceived: number }>();
  private abrControllers = new Map<string, AdaptiveBitrateController>();

  constructor(
    signal: SignalingClient,
    onStream: OnStreamCallback,
    onStreamEnd: OnStreamEndCallback,
  ) {
    this.signal = signal;
    this.onStream = onStream;
    this.onStreamEnd = onStreamEnd;
  }

  setMyPeerId(id: string) {
    this.myPeerId = id;
  }

  startListening() {
    this.unsubSignal = this.signal.onMessage((msg) => {
      this.handleSignalMessage(msg);
    });
  }

  stopListening() {
    this.unsubSignal?.();
    this.unsubSignal = null;
  }

  /**
   * Captura a tela do usuário
   */
  async startScreenShare(config?: StreamConfig): Promise<MediaStream> {
    const cfg = config || this.currentConfig;
    this.currentConfig = cfg;

    const res = RESOLUTION_MAP[cfg.resolution];
    const fps = cfg.frameRate;
    const wantsAudio = cfg.audio;

    // getDisplayMedia: audio precisa ser simples (true/false).
    // systemAudio DEVE ser top-level (Chromium 105+).
    const displayMediaOptions: any = {
      video: {
        width: { ideal: res.width },
        height: { ideal: res.height },
        frameRate: { ideal: fps, max: fps },
      },
      audio: wantsAudio,
      ...(wantsAudio ? { systemAudio: 'include' } : {}),
    };

    console.log('[WebRTC] getDisplayMedia options:', JSON.stringify(displayMediaOptions));
    const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions as DisplayMediaStreamOptions);

    // Diagnóstico de áudio
    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();
    console.log(`[WebRTC] Captura: ${videoTracks.length} vídeo, ${audioTracks.length} áudio`);
    this.hasAudioTrack = audioTracks.length > 0;

    if (wantsAudio && audioTracks.length === 0) {
      console.warn('[WebRTC] ⚠️ Áudio solicitado mas NÃO capturado!');
      console.warn('[WebRTC] Dicas: 1) Compartilhe a TELA INTEIRA (não uma janela)');
      console.warn('[WebRTC] 2) Marque "Compartilhar áudio do sistema" no diálogo do Chrome');
      console.warn('[WebRTC] 3) Certifique-se de que algum som está tocando no sistema');
    }
    this.onAudioStatus?.(this.hasAudioTrack);

    for (const at of audioTracks) {
      console.log(`[WebRTC] Audio track: label="${at.label}", readyState=${at.readyState}, muted=${at.muted}, enabled=${at.enabled}`);
    }

    // content hint: 'motion' para jogos/vídeos (prioriza fluidez sobre nitidez)
    const videoTrack = videoTracks[0];
    if (videoTrack) {
      videoTrack.contentHint = 'motion';
      const actualSettings = videoTrack.getSettings();
      console.log(`[WebRTC] Video track settings: ${actualSettings.width}x${actualSettings.height} @ ${actualSettings.frameRate}fps`);
    }

    this.localStream = stream;

    videoTrack.onended = () => {
      this.stopScreenShare();
    };

    this.signal.send({ type: 'start-sharing' });
    return stream;
  }

  stopScreenShare() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    // Stop all ABR controllers
    for (const abr of this.abrControllers.values()) {
      abr.stop();
    }
    this.abrControllers.clear();

    for (const [peerId, pc] of this.connections) {
      pc.close();
      this.connections.delete(peerId);
    }

    this.signal.send({ type: 'stop-sharing' });
  }

  requestStream(sharerId: string) {
    this.signal.send({ type: 'request-stream', sharerId });
  }

  destroy() {
    this.stopScreenShare();
    this.stopListening();
    for (const pc of this.connections.values()) {
      pc.close();
    }
    this.connections.clear();
    for (const abr of this.abrControllers.values()) {
      abr.stop();
    }
    this.abrControllers.clear();
  }

  // ── Handlers de sinalização ──

  private async handleSignalMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'stream-requested':
        await this.createOfferForViewer(msg.from);
        break;
      case 'offer':
        await this.handleOffer(msg.from, msg.sdp);
        break;
      case 'answer':
        await this.handleAnswer(msg.from, msg.sdp);
        break;
      case 'ice-candidate':
        await this.handleIceCandidate(msg.from, msg.candidate);
        break;
      case 'sharing-stopped':
        this.closeConnection(msg.peerId);
        this.onStreamEnd(msg.peerId);
        break;
      case 'peer-left':
        this.closeConnection(msg.peerId);
        this.onStreamEnd(msg.peerId);
        break;
    }
  }

  /**
   * SHARER: criar PeerConnection + offer para um viewer
   * NÃO usa SDP munging — controla bitrate SOMENTE via setParameters (mais confiável)
   */
  private async createOfferForViewer(viewerId: string) {
    if (!this.localStream) return;

    const pc = this.createPeerConnection(viewerId);

    const tracks = this.localStream.getTracks();
    console.log(`[WebRTC] Enviando ${tracks.length} tracks para viewer ${viewerId}:`, tracks.map(t => `${t.kind}(${t.label}, enabled=${t.enabled})`));
    for (const track of tracks) {
      pc.addTrack(track, this.localStream);
    }

    // Prefere H264 (hardware-accelerated)
    this.preferH264(pc);

    // Cria offer SEM SDP munging — bitrate será controlado via setParameters após answer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.signal.send({
      type: 'offer',
      to: viewerId,
      sdp: pc.localDescription!,
    });
  }

  private preferH264(pc: RTCPeerConnection) {
    try {
      const transceivers = pc.getTransceivers();
      for (const t of transceivers) {
        if (t.sender?.track?.kind === 'video' || t.receiver?.track?.kind === 'video') {
          const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs || [];
          const h264 = codecs.filter(c => c.mimeType === 'video/H264');
          const rest = codecs.filter(c => c.mimeType !== 'video/H264');
          if (h264.length > 0) {
            t.setCodecPreferences([...h264, ...rest]);
          }
        }
      }
    } catch {
      // setCodecPreferences não suportado
    }
  }

  /**
   * Configura sender DEPOIS da negociação SDP completar.
   * Aplica bitrate inicial, framerate, e degradationPreference.
   * Inicia o Adaptive Bitrate Controller para ajustar dinamicamente.
   */
  private async configureVideoSender(pc: RTCPeerConnection, peerId: string) {
    const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (!videoSender) {
      console.warn('[WebRTC] configureVideoSender: nenhum sender de vídeo encontrado');
      return;
    }

    try {
      const params = videoSender.getParameters();

      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      const maxBitrate = BITRATE_MAP[this.currentConfig.resolution] || 6_000_000;
      params.encodings[0].maxBitrate = maxBitrate;
      params.encodings[0].maxFramerate = this.currentConfig.frameRate;

      // Prioriza manter framerate quando a rede aperta (reduz resolução em vez de FPS)
      // @ts-ignore - degradationPreference exists but TypeScript doesn't know about it
      params.degradationPreference = 'maintain-framerate';

      await videoSender.setParameters(params);

      console.log(`[WebRTC] ✅ Sender configurado: maxBitrate=${(maxBitrate / 1_000_000).toFixed(1)}Mbps, maxFps=${this.currentConfig.frameRate}, degradation=maintain-framerate`);

      // Verify params were applied
      const check = videoSender.getParameters();
      console.log('[WebRTC] Params verificados:', JSON.stringify({
        maxBitrate: check.encodings?.[0]?.maxBitrate,
        maxFramerate: check.encodings?.[0]?.maxFramerate,
        // @ts-ignore
        degradationPreference: check.degradationPreference,
        scaleResolutionDownBy: check.encodings?.[0]?.scaleResolutionDownBy,
      }));

      // Start Adaptive Bitrate Controller
      const existingAbr = this.abrControllers.get(peerId);
      if (existingAbr) existingAbr.stop();

      const abr = new AdaptiveBitrateController(pc, this.currentConfig.frameRate, maxBitrate);
      this.abrControllers.set(peerId, abr);
      abr.start();

    } catch (e) {
      console.warn('[WebRTC] Não foi possível configurar sender de vídeo:', e);
    }
  }

  /**
   * VIEWER: recebi offer, criar answer
   */
  private async handleOffer(fromId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.createPeerConnection(fromId);

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.signal.send({
      type: 'answer',
      to: fromId,
      sdp: pc.localDescription!,
    });
  }

  /**
   * Recebi answer — agora configura bitrate DEPOIS da negociação
   */
  private async handleAnswer(fromId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.connections.get(fromId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));

    // Agora que a negociação completou, configura bitrate e inicia ABR
    await this.configureVideoSender(pc, fromId);
  }

  private async handleIceCandidate(fromId: string, candidate: RTCIceCandidateInit) {
    const pc = this.connections.get(fromId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // estado já mudou
    }
  }

  private createPeerConnection(remotePeerId: string): RTCPeerConnection {
    this.closeConnection(remotePeerId);

    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
    });

    this.connections.set(remotePeerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signal.send({
          type: 'ice-candidate',
          to: remotePeerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      console.log(`[WebRTC] Viewer recebeu track: kind=${event.track.kind}, label="${event.track.label}", readyState=${event.track.readyState}, enabled=${event.track.enabled}`);

      const [remoteStream] = event.streams;
      if (remoteStream) {
        // Notify only once per peer
        if (!this.notifiedPeers.has(remotePeerId)) {
          this.notifiedPeers.add(remotePeerId);
          this.onStream({
            peerId: remotePeerId,
            nickname: '',
            stream: remoteStream,
          });
        }

        const track = event.track;
        track.onended = () => {
          this.closeConnection(remotePeerId);
          this.onStreamEnd(remotePeerId);
        };

        track.onmute = () => {
          setTimeout(() => {
            if (track.muted && (track.readyState === 'ended' || pc.connectionState !== 'connected')) {
              this.closeConnection(remotePeerId);
              this.onStreamEnd(remotePeerId);
            }
          }, 3000);
        };

        remoteStream.onremovetrack = () => {
          if (remoteStream.getTracks().filter(t => t.readyState === 'live').length === 0) {
            this.closeConnection(remotePeerId);
            this.onStreamEnd(remotePeerId);
          }
        };
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state (${remotePeerId}): ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.closeConnection(remotePeerId);
        this.onStreamEnd(remotePeerId);
      }
    };

    // Log ICE state for debugging
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state (${remotePeerId}): ${pc.iceConnectionState}`);
    };

    return pc;
  }

  /**
   * Retorna stats em tempo real de uma conexão WebRTC.
   * Funciona tanto para sharer (outbound) quanto viewer (inbound).
   */
  async getConnectionStats(peerId: string): Promise<ConnectionStats | null> {
    const pc = this.connections.get(peerId);
    if (!pc) return null;

    try {
      const rawStats = await pc.getStats();
      const result: ConnectionStats = {
        videoCodec: '—',
        audioCodec: '—',
        videoBitrate: 0,
        audioBitrate: 0,
        fps: 0,
        width: 0,
        height: 0,
        packetLoss: 0,
        packetLossRate: 0,
        roundTripTime: 0,
        hasAudio: false,
        jitter: 0,
        timestamp: Date.now(),
      };

      let videoCodecId = '';
      let audioCodecId = '';

      rawStats.forEach((report) => {
        // ── Inbound video (viewer side) ──
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          result.fps = report.framesPerSecond || 0;
          result.width = report.frameWidth || 0;
          result.height = report.frameHeight || 0;
          result.jitter = report.jitter || 0;
          videoCodecId = report.codecId || '';

          // Packet loss rate calculation
          const totalPackets = (report.packetsReceived || 0) + (report.packetsLost || 0);
          result.packetLoss = report.packetsLost || 0;
          if (totalPackets > 0) {
            // Calculate packet loss rate since last check
            const key = `${peerId}-pktloss`;
            const prev = this._prevStats.get(key);
            if (prev) {
              const dLost = (report.packetsLost || 0) - prev.packetsLost;
              const dRecv = (report.packetsReceived || 0) - prev.packetsReceived;
              const dTotal = dLost + dRecv;
              result.packetLossRate = dTotal > 0 ? Math.round((dLost / dTotal) * 10000) / 100 : 0;
            }
            this._prevStats.set(key, {
              bytes: 0,
              timestamp: report.timestamp,
              packetsLost: report.packetsLost || 0,
              packetsReceived: report.packetsReceived || 0,
            });
          }

          // Bitrate calc (bytes received since last check)
          const key = `${peerId}-video`;
          const prev = this._prevStats.get(key);
          if (prev && prev.bytes > 0) {
            const dtMs = report.timestamp - prev.timestamp;
            if (dtMs > 0) {
              result.videoBitrate = Math.round(((report.bytesReceived - prev.bytes) * 8) / (dtMs / 1000));
            }
          }
          this._prevStats.set(key, { bytes: report.bytesReceived, timestamp: report.timestamp, packetsLost: 0, packetsReceived: 0 });
        }

        // ── Outbound video (sharer side) ──
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          result.fps = result.fps || report.framesPerSecond || 0;
          result.width = result.width || report.frameWidth || 0;
          result.height = result.height || report.frameHeight || 0;
          videoCodecId = videoCodecId || report.codecId || '';

          const key = `${peerId}-video-out`;
          const prev = this._prevStats.get(key);
          if (prev && prev.bytes > 0) {
            const dtMs = report.timestamp - prev.timestamp;
            if (dtMs > 0) {
              const br = Math.round(((report.bytesSent - prev.bytes) * 8) / (dtMs / 1000));
              result.videoBitrate = result.videoBitrate || br;
            }
          }
          this._prevStats.set(key, { bytes: report.bytesSent, timestamp: report.timestamp, packetsLost: 0, packetsReceived: 0 });
        }

        // ── Inbound audio (viewer) ──
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          result.hasAudio = true;
          audioCodecId = report.codecId || '';

          const key = `${peerId}-audio`;
          const prev = this._prevStats.get(key);
          if (prev && prev.bytes > 0) {
            const dtMs = report.timestamp - prev.timestamp;
            if (dtMs > 0) {
              result.audioBitrate = Math.round(((report.bytesReceived - prev.bytes) * 8) / (dtMs / 1000));
            }
          }
          this._prevStats.set(key, { bytes: report.bytesReceived, timestamp: report.timestamp, packetsLost: 0, packetsReceived: 0 });
        }

        // ── Outbound audio (sharer) ──
        if (report.type === 'outbound-rtp' && report.kind === 'audio') {
          result.hasAudio = true;
          audioCodecId = audioCodecId || report.codecId || '';

          const key = `${peerId}-audio-out`;
          const prev = this._prevStats.get(key);
          if (prev && prev.bytes > 0) {
            const dtMs = report.timestamp - prev.timestamp;
            if (dtMs > 0) {
              result.audioBitrate = result.audioBitrate || Math.round(((report.bytesSent - prev.bytes) * 8) / (dtMs / 1000));
            }
          }
          this._prevStats.set(key, { bytes: report.bytesSent, timestamp: report.timestamp, packetsLost: 0, packetsReceived: 0 });
        }

        // ── RTT ──
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          result.roundTripTime = report.currentRoundTripTime ? Math.round(report.currentRoundTripTime * 1000) : 0;
        }
      });

      // Resolve codec names
      rawStats.forEach((report) => {
        if (report.type === 'codec') {
          if (report.id === videoCodecId) {
            result.videoCodec = (report.mimeType || '').replace('video/', '');
          }
          if (report.id === audioCodecId) {
            result.audioCodec = (report.mimeType || '').replace('audio/', '');
          }
        }
      });

      // Add ABR state
      const abr = this.abrControllers.get(peerId);
      if (abr) {
        result.adaptiveState = abr.getState();
      }

      return result;
    } catch {
      return null;
    }
  }

  getConnectedPeerIds(): string[] {
    return Array.from(this.connections.keys());
  }

  private closeConnection(peerId: string) {
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
    }
    this.notifiedPeers.delete(peerId);

    // Stop ABR controller for this peer
    const abr = this.abrControllers.get(peerId);
    if (abr) {
      abr.stop();
      this.abrControllers.delete(peerId);
    }
  }
}
