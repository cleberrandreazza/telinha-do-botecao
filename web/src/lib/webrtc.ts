import { SignalingClient } from './signaling';
import { configureAudioSenderParameters, configureOpusReceiverSdp, configureOpusSenderSdp } from './opus';
import { assertScreenShareSupported } from './screenShare';
import { asLinkRole, linkKey, oppositeRole, parseLinkKey, type LinkRole } from './links';
import type { ServerMessage, StreamInfo } from './types';
import {
  AdaptiveBitrateController,
  ConnectionMonitor,
  audioModeFromConfig,
  commitPreparedShare,
  negotiationFromSdp,
  inspectAudioSdp,
  readAudioCapture,
  readCaptureProbe,
  readEncoderEncoding,
  reportFilename,
  requestDisplayMedia,
  triggerJsonDownload,
  SessionTimeline,
  type AudioLinkContext,
  type AudioMode,
  type AudioPlaybackReport,
  type DiagnosticsSnapshot,
  type CaptureProbe,
  type EncoderProbe,
  type PeerConnectionLike,
  type PlaybackSample,
  type PreparedShare,
  type ScopeStream,
} from './diagnostics/index';

function displayScope(stream: MediaStream): ScopeStream {
  return {
    getAudioTracks: () => stream.getAudioTracks(),
    getVideoTracks: () => stream.getVideoTracks().map((track) => ({
      getSettings: () => ({ displaySurface: track.getSettings().displaySurface }),
    })),
    removeTrack: (track) => {
      for (const item of stream.getAudioTracks()) {
        if (item === track) stream.removeTrack(item);
      }
    },
  };
}

export interface StreamConfig {
  resolution: '2160' | '1080' | '720' | '480';
  frameRate: 30 | 15 | 5;
  audio: boolean;
  audioMode?: AudioMode;
}

const RESOLUTION_MAP: Record<string, { width: number; height: number }> = {
  '2160': { width: 3840, height: 2160 },
  '1080': { width: 1920, height: 1080 },
  '720': { width: 1280, height: 720 },
  '480': { width: 854, height: 480 },
};

/** Bitrate limits per resolution (bits/s). 30 fps recebe o teto inteiro em cada frame. */
const BITRATE_MAP: Record<string, number> = {
  '2160': 16_000_000,
  '1080': 8_000_000,
  '720': 4_000_000,
  '480': 2_000_000,
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

/** Visão compatível. Campos medidos usam null quando o navegador não expõe o dado. */
export interface ConnectionStats {
  role: 'sender' | 'receiver';
  videoCodec: string;
  audioCodec: string;
  videoBitrate: number | null;
  audioBitrate: number | null;
  /** FPS medido da direção desta extremidade. Zero permanece zero. */
  fps: number | null;
  width: number | null;
  height: number | null;
  packetLoss: number | null;
  packetLossRate: number | null;
  roundTripTime: number | null;
  hasAudio: boolean;
  /** Milissegundos. null se o navegador não expôs jitter na direção certa. */
  jitter: number | null;
  timestamp: number;
  adaptiveState?: string;
}

type OnStreamCallback = (info: StreamInfo) => void;
type OnStreamEndCallback = (peerId: string) => void;

export class WebRTCManager {
  private signal: SignalingClient;
  /** Conexões indexadas por `papel:peerId` — os dois sentidos coexistem (ver lib/links.ts). */
  private connections = new Map<string, RTCPeerConnection>();
  private localStream: MediaStream | null = null;
  private currentConfig: StreamConfig = { resolution: '1080', frameRate: 30, audio: true, audioMode: 'source' };
  private myPeerId = '';
  private onStream: OnStreamCallback;
  private onStreamEnd: OnStreamEndCallback;
  private unsubSignal: (() => void) | null = null;
  private notifiedPeers = new Set<string>();
  public hasAudioTrack = false;
  public onAudioStatus?: (captured: boolean) => void;
  private audioCapture = {
    requested: false,
    audioMode: null as AudioMode | null,
    trackCount: 0,
    returnedTracks: null as number | null,
    readyState: null as string | null,
    enabled: null as boolean | null,
    muted: null as boolean | null,
    displaySurface: null as string | null,
    policy: null as string | null,
    discardReason: null as string | null,
    message: null as string | null,
    format: null as ReturnType<typeof readAudioCapture>,
  };
  /** Contexto de áudio por `papel:peerId`. */
  private audioLink = new Map<string, AudioLinkContext>();
  /** Quantidade de faixas de áudio remotas por `papel:peerId`. */
  private remoteAudioTracks = new Map<string, number>();
  private watchedRemoteStreams = new WeakSet<MediaStream>();
  private pendingAudioEvents: { severity: 'info' | 'atenção' | 'crítico'; message: string; data: Record<string, number | string | null> }[] = [];
  private captureProbe: CaptureProbe | null = null;
  private encoderProbes = new Map<string, EncoderProbe>();
  /** Controladores de ABR por `papel:peerId`. */
  private abrControllers = new Map<string, AdaptiveBitrateController>();
  /** Monitores de diagnóstico por `papel:peerId`. */
  private monitors = new Map<string, ConnectionMonitor>();
  private readonly sessionId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `s_${Date.now().toString(36)}`;
  private diagnosticsListeners = new Set<() => void>();
  private readonly timeline: SessionTimeline;

  constructor(
    signal: SignalingClient,
    onStream: OnStreamCallback,
    onStreamEnd: OnStreamEndCallback,
    now?: () => number,
  ) {
    this.signal = signal;
    this.onStream = onStream;
    this.onStreamEnd = onStreamEnd;
    this.timeline = new SessionTimeline(now);
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
    // Celular e endereços sem HTTPS não têm getDisplayMedia: falha aqui com
    // mensagem clara em vez de um TypeError genérico na captura.
    assertScreenShareSupported();

    const cfg = config || this.currentConfig;
    const mode = audioModeFromConfig(cfg);
    this.currentConfig = { ...cfg, audio: mode !== 'off', audioMode: mode };

    const res = RESOLUTION_MAP[cfg.resolution];
    const fps = cfg.frameRate;

    // Áudio fica boolean. echoCancellation/noiseSuppression fazem o Chrome descartar a faixa.
    // Os hints de escopo não obrigam o navegador a devolver uma track.
    const videoConstraints = {
      width: { ideal: res.width },
      height: { ideal: res.height },
      frameRate: { ideal: fps, max: fps },
    };
    const captured = await requestDisplayMedia(
      (options) => navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions),
      videoConstraints,
      mode,
    );

    const stream = captured.stream as MediaStream;
    commitPreparedShare({
      stream: displayScope(stream),
      mode,
      scopeUnsupported: captured.audioScopeFallback,
      assignLocal: (_ready, prepared) => {
        this.localStream = stream;
        this.notePreparedAudio(stream, mode, prepared);
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const requestedSize = RESOLUTION_MAP[this.currentConfig.resolution];
          this.captureProbe = readCaptureProbe({
            label: this.currentConfig.resolution,
            width: requestedSize?.width ?? null,
            height: requestedSize?.height ?? null,
            frameRate: this.currentConfig.frameRate,
          }, videoTrack);
          console.info('[WebRTC] Captura', this.captureProbe);
          videoTrack.contentHint = 'motion';
          const actualSettings = videoTrack.getSettings();
          console.log(`[WebRTC] Video track settings: ${actualSettings.width}x${actualSettings.height} @ ${actualSettings.frameRate}fps`);
          videoTrack.onended = () => {
            this.stopScreenShare();
          };
        }
      },
      startSharing: () => {
        this.signal.send({ type: 'start-sharing' });
        this.timeline.transmissionStarted();
      },
    });
    return stream;
  }

  stopScreenShare() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    // Só fecha as conexões de papel `sender` (as que EU transmito). As de
    // papel `receiver` — as lives que eu estava assistindo — continuam vivas.
    for (const key of [...this.connections.keys()]) {
      const parsed = parseLinkKey(key);
      if (!parsed || parsed.role !== 'sender') continue;
      this.closeLink(parsed.role, parsed.peerId);
    }

    this.signal.send({ type: 'stop-sharing' });
    this.audioCapture = {
      requested: false,
      audioMode: null,
      trackCount: 0,
      returnedTracks: null,
      readyState: null,
      enabled: null,
      muted: null,
      displaySurface: null,
      policy: null,
      discardReason: null,
      message: null,
      format: null,
    };
    this.hasAudioTrack = false;
    this.pendingAudioEvents = [];
    this.captureProbe = null;
    this.encoderProbes.clear();
  }

  requestStream(sharerId: string) {
    this.signal.send({ type: 'request-stream', sharerId });
  }

  /**
   * Deixa de receber a live de um peer (usado quando o tile é fechado na
   * grade): fecha só o papel `receiver` e devolve o slot de transmissão.
   */
  stopReceiving(peerId: string) {
    this.closeLink('receiver', peerId);
  }

  destroy() {
    this.stopScreenShare();
    this.stopListening();
    // Encerramento da sessão: fecha os dois papéis de todos os peers.
    const peerIds = new Set<string>();
    for (const key of [...this.connections.keys()]) {
      const parsed = parseLinkKey(key);
      if (parsed) peerIds.add(parsed.peerId);
    }
    for (const peerId of peerIds) {
      this.closePeer(peerId);
    }
    this.diagnosticsListeners.clear();
  }

  // ── Handlers de sinalização ──

  private async handleSignalMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'stream-requested':
        this.timeline.viewerRequested();
        await this.createOfferForViewer(msg.from);
        break;
      case 'offer':
        await this.handleOffer(msg.from, msg.sdp);
        break;
      case 'answer':
        await this.handleAnswer(msg.from, msg.sdp);
        break;
      case 'ice-candidate':
        await this.handleIceCandidate(msg.from, msg.candidate, msg.linkRole);
        break;
      case 'sharing-stopped':
        // Aquele peer parou de enviar: fecha só o papel `receiver` dele.
        this.closeLink('receiver', msg.peerId);
        this.onStreamEnd(msg.peerId);
        break;
      case 'peer-left':
        // O peer saiu: fecha só a live que eu assistia (papel `receiver`).
        // O papel `sender` — a minha transmissão para ele — NÃO é derrubado
        // aqui: derrubá-lo derrubaria o meu compartilhamento. A própria
        // conexão morre junto com o peer e se fecha pelo `connectionState`.
        this.closeLink('receiver', msg.peerId);
        this.onStreamEnd(msg.peerId);
        break;
    }
  }

  /**
   * SHARER: criar PeerConnection + offer para um viewer.
   * O bitrate de vídeo continua só no setParameters. O único ajuste de SDP é o Opus estéreo.
   */
  private async createOfferForViewer(viewerId: string) {
    if (!this.localStream) return;

    const pc = this.createPeerConnection(viewerId, 'sender');
    const key = linkKey('sender', viewerId);

    // Clona a video track para cada PC para que cada encoder opere de forma
    // independente. Sem o clone, Chrome compartilha o encoder interno e quando
    // um PC reduz a resolução, a source track dos outros PCs também é afetada.
    // Áudio não precisa de clone — compartilhar a mesma track é seguro.
    const tracks = this.localStream.getTracks();
    let audioSenders = 0;
    for (const track of tracks) {
      try {
        const trackToAdd = track.kind === 'video' ? track.clone() : track;
        if (track.kind === 'video' && trackToAdd.contentHint !== track.contentHint) {
          trackToAdd.contentHint = track.contentHint;
        }
        pc.addTrack(trackToAdd, this.localStream);
        if (track.kind === 'audio') audioSenders += 1;
      } catch (err) {
        console.warn(`[WebRTC] addTrack de ${track.kind} falhou:`, err);
      }
    }
    const attached = pc.getSenders().some((sender) => sender.track?.kind === 'audio');
    this.audioLink.set(key, { senderAttached: attached, negotiated: null, direction: null });
    if (audioSenders > 0 && attached) {
      this.monitors.get(key)?.recordEvent({
        category: 'ÁUDIO',
        severity: 'info',
        message: 'Track de áudio adicionada ao sender.',
        data: { tracks: audioSenders },
      });
    }

    // Prefere H264 (hardware-accelerated)
    this.preferH264(pc);

    const offer = await pc.createOffer();
    const mungedOffer = new RTCSessionDescription({
      type: offer.type,
      sdp: configureOpusSenderSdp(offer.sdp || '', this.audioCapture.format?.settings.channelCount),
    });
    await pc.setLocalDescription(mungedOffer);

    this.signal.send({
      type: 'offer',
      to: viewerId,
      sdp: pc.localDescription!,
    });
    this.timeline.offerSent(this.monitors.get(key)?.connectionId ?? null);
  }

  private async configureAudioSenders(pc: RTCPeerConnection) {
    const audioSenders = pc.getSenders().filter((sender) => sender.track?.kind === 'audio');
    for (const sender of audioSenders) {
      try {
        const appliedMaxBitrate = await configureAudioSenderParameters(sender);
        if (appliedMaxBitrate !== 192_000) {
          console.warn('[WebRTC] O navegador não confirmou o teto de 192 kbps para o sender de áudio:', appliedMaxBitrate);
        }
      } catch (error) {
        console.warn('[WebRTC] Falha ao configurar teto do sender de áudio:', error);
      }
    }
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
  private async configureVideoSender(pc: RTCPeerConnection, key: string) {
    const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (!videoSender) {
      console.warn('[WebRTC] configureVideoSender: nenhum sender de vídeo encontrado');
      return;
    }

    const connectionId = this.monitors.get(key)?.connectionId ?? null;
    let beforeEncoder = readEncoderEncoding(null);
    let encoderApplied = false;
    try {
      const params = videoSender.getParameters();
      beforeEncoder = readEncoderEncoding(params);

      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      const maxBitrate = BITRATE_MAP[this.currentConfig.resolution] || 8_000_000;
      params.encodings[0].maxBitrate = maxBitrate;
      params.encodings[0].maxFramerate = this.currentConfig.frameRate;
      params.encodings[0].scaleResolutionDownBy = this.scaleResolutionDownBy(this.currentConfig.resolution);

      // 30 fps é a prioridade. Se a banda apertar, o Chrome reduz resolução
      // em vez de derrubar o framerate. O ABR continua podendo baixar o teto.
      // @ts-ignore - degradationPreference exists but TypeScript doesn't know about it
      params.degradationPreference = 'maintain-framerate';

      await videoSender.setParameters(params);

      console.log(`[WebRTC] ✅ Sender configurado: maxBitrate=${(maxBitrate / 1_000_000).toFixed(1)}Mbps, maxFps=${this.currentConfig.frameRate}, degradation=maintain-framerate`);

      // Verify params were applied
      const check = videoSender.getParameters();
      const afterEncoder = readEncoderEncoding(check);
      if (connectionId) {
        this.encoderProbes.set(connectionId, { connectionId, before: beforeEncoder, after: afterEncoder });
        encoderApplied = true;
      }
      console.info('[WebRTC] Encoder', connectionId, { before: beforeEncoder, after: afterEncoder });
      console.log('[WebRTC] Params verificados:', JSON.stringify({
        maxBitrate: check.encodings?.[0]?.maxBitrate,
        maxFramerate: check.encodings?.[0]?.maxFramerate,
        // @ts-ignore
        degradationPreference: check.degradationPreference,
        scaleResolutionDownBy: check.encodings?.[0]?.scaleResolutionDownBy,
      }));

      this.restartAbr(pc, key, maxBitrate);

    } catch (e) {
      if (connectionId && !encoderApplied) {
        this.encoderProbes.set(connectionId, { connectionId, before: beforeEncoder, after: null });
      }
      console.warn('[WebRTC] Não foi possível configurar sender de vídeo:', e);
    }
  }

  /**
   * Recria o ABR de uma conexão de papel `sender` com um teto de bitrate novo.
   * O padrão é o mesmo já usado em configureVideoSender: o controlador anterior
   * é parado, o novo é registrado e o monitor volta a empurrar amostras.
   */
  private restartAbr(pc: RTCPeerConnection, key: string, maxBitrate: number) {
    const existingAbr = this.abrControllers.get(key);
    if (existingAbr) existingAbr.stop();

    const monitor = this.monitors.get(key);
    const abr = new AdaptiveBitrateController({
      applyMaxBitrate: (bitrate) => this.applySenderBitrate(pc, bitrate),
    }, this.currentConfig.frameRate, maxBitrate, (change) => {
      const mbps = (value: number) => (value / 1_000_000).toFixed(1);
      console.info(`[ABR] ${change.action === 'decrease' ? 'reduziu' : 'aumentou'} bitrate: ${mbps(change.from)}→${mbps(change.to)} Mbps (fps ${change.fps ?? 'n/d'})`);
      monitor?.recordEvent({
        category: 'ABR',
        severity: change.action === 'decrease' ? 'atenção' : 'info',
        message: change.action === 'decrease' ? 'ABR reduziu o bitrate.' : 'ABR aumentou o bitrate.',
        data: { de: change.from, para: change.to, fps: change.fps },
      });
    });
    this.abrControllers.set(key, abr);
    monitor?.setSampleListener((sample) => abr.onSample(sample));
  }

  /**
   * Fator de redução aplicado pelo encoder para chegar na resolução pedida.
   * A largura capturada vem de getSettings(); se a captura for menor que o
   * alvo, o fator é 1 (não há o que reduzir).
   */
  private scaleResolutionDownBy(resolution: string): number {
    const target = RESOLUTION_MAP[resolution];
    if (!target) return 1;
    const capturedWidth = this.localStream?.getVideoTracks()[0]?.getSettings().width ?? null;
    const sourceWidth = capturedWidth ?? RESOLUTION_MAP['2160'].width;
    if (!capturedWidth || capturedWidth < target.width) return 1;
    return Math.max(1, Math.round((sourceWidth / target.width) * 100) / 100);
  }

  /**
   * VIEWER: recebi offer, criar answer
   */
  private async handleOffer(fromId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.createPeerConnection(fromId, 'receiver');
    const key = linkKey('receiver', fromId);

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    const remoteSourceStereo = inspectAudioSdp(pc.remoteDescription?.sdp).fmtp.spropStereo;
    const mungedAnswer = new RTCSessionDescription({
      type: answer.type,
      sdp: configureOpusReceiverSdp(answer.sdp || '', remoteSourceStereo === '0' ? false : true),
    });
    await pc.setLocalDescription(mungedAnswer);
    this.noteAudioNegotiation(key, pc);

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
    const key = linkKey('sender', fromId);
    const pc = this.connections.get(key);
    if (!pc) return;
    this.timeline.answerReceived(this.monitors.get(key)?.connectionId ?? null);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    this.noteAudioNegotiation(key, pc);

    // Aplicar depois da resposta remota permite ler de volta os parâmetros negociados.
    await this.configureAudioSenders(pc);
    await this.configureVideoSender(pc, key);
  }

  /**
   * Candidato de ICE. O `linkRole` diz em que papel a conexão deve receber o
   * candidato. Sem ele (mensagem antiga), o candidato é aplicado em todas as
   * conexões daquele peer — cada uma isolada em seu próprio try/catch, para
   * que um erro em uma não derrube as outras.
   */
  private async handleIceCandidate(fromId: string, candidate: RTCIceCandidateInit, linkRole?: LinkRole) {
    const role = asLinkRole(linkRole);
    if (role) {
      const pc = this.connections.get(linkKey(role, fromId));
      if (!pc) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // estado já mudou
      }
      return;
    }

    for (const [key, pc] of [...this.connections.entries()]) {
      const parsed = parseLinkKey(key);
      if (!parsed || parsed.peerId !== fromId) continue;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // estado já mudou
      }
    }
  }

  private createPeerConnection(remotePeerId: string, role: LinkRole): RTCPeerConnection {
    const key = linkKey(role, remotePeerId);
    const replaced = this.connections.has(key);
    // Substitui só a conexão do MESMO papel: a do outro sentido continua viva.
    this.closeLinkByKey(key, replaced ? 'replace' : 'leave');

    const connectionCreatedAt = this.timeline.clock();
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
    });

    this.connections.set(key, pc);
    const monitor = new ConnectionMonitor({
      pc: pc as unknown as PeerConnectionLike,
      role,
      sessionId: this.sessionId,
      now: () => this.timeline.clock(),
      connectionCreatedAt,
      onFirstSample: (connectionId) => this.timeline.firstSample(connectionId),
      onConnected: (connectionId) => this.timeline.connectionEstablished(connectionId),
      sessionTimeline: () => ({
        sessionStartedAt: this.timeline.sessionStartedAt,
        events: this.timeline.snapshot(),
      }),
      getContext: () => ({
        viewerCount: role === 'sender' ? this.activeViewerCount() : null,
        configuredFps: role === 'sender' ? this.currentConfig.frameRate : null,
        streamConfig: role === 'sender' ? { ...this.currentConfig } : null,
        adaptiveState: this.abrControllers.get(key)?.getState() ?? null,
        audioCapture: role === 'sender' ? {
          requested: this.audioCapture.requested,
          audioMode: this.audioCapture.audioMode,
          trackCount: this.audioCapture.trackCount,
          returnedTracks: this.audioCapture.returnedTracks,
          readyState: this.audioCapture.readyState,
          enabled: this.audioCapture.enabled,
          muted: this.audioCapture.muted,
          displaySurface: this.audioCapture.displaySurface,
          policy: this.audioCapture.policy,
          discardReason: this.audioCapture.discardReason,
          format: this.audioCapture.format,
        } : null,
        audioLink: this.audioLink.get(key) ?? null,
        remoteAudioTracks: this.remoteAudioTracks.get(key) ?? null,
        captureProbe: role === 'sender' ? this.captureProbe : null,
        encoderProbe: (() => {
          if (role !== 'sender') return null;
          const connectionId = this.monitors.get(key)?.connectionId;
          return connectionId ? this.encoderProbes.get(connectionId) ?? null : null;
        })(),
      }),
    });
    if (role === 'sender') {
      for (const event of this.pendingAudioEvents) {
        monitor.recordEvent({ category: 'ÁUDIO', severity: event.severity, message: event.message, data: event.data });
      }
    }
    this.monitors.set(key, monitor);
    monitor.subscribeAny(() => {
      for (const listener of this.diagnosticsListeners) listener();
    });
    monitor.start();
    this.timeline.setViewerCount(this.activeViewerCount());
    this.timeline.peerConnectionCreated(monitor.connectionId);
    if (replaced) {
      this.timeline.reconnected(monitor.connectionId);
      monitor.recordEvent({
        category: 'SISTEMA',
        severity: 'info',
        message: 'Reconexão: a conexão anterior foi substituída.',
        data: {},
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signal.send({
          type: 'ice-candidate',
          to: remotePeerId,
          candidate: event.candidate.toJSON(),
          // O papel que o RECEBEDOR deve usar nesta conexão é o oposto do meu.
          linkRole: oppositeRole(role),
        });
      }
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        const updateRemoteAudio = () => {
          this.remoteAudioTracks.set(key, remoteStream.getAudioTracks().length);
        };
        updateRemoteAudio();
        if (!this.watchedRemoteStreams.has(remoteStream)) {
          this.watchedRemoteStreams.add(remoteStream);
          remoteStream.addEventListener('addtrack', updateRemoteAudio);
          remoteStream.addEventListener('removetrack', updateRemoteAudio);
        }
        if (event.track.kind === 'video') this.timeline.firstVideo(monitor.connectionId);
        if (event.track.kind === 'audio') {
          monitor.recordEvent({
            category: 'ÁUDIO',
            severity: 'info',
            message: 'Track de áudio recebida.',
            data: {
              estado: event.track.readyState,
              enabled: event.track.enabled ? 1 : 0,
              muted: event.track.muted ? 1 : 0,
            },
          });
        }
        // Notifica uma vez por peer — e só no papel receiver, que é onde a
        // live do outro chega. No papel sender nada chega do outro lado.
        if (role === 'receiver' && !this.notifiedPeers.has(remotePeerId)) {
          this.notifiedPeers.add(remotePeerId);
          this.onStream({
            peerId: remotePeerId,
            nickname: '',
            stream: remoteStream,
          });
        }

        const track = event.track;
        track.onended = () => {
          if (this.connections.get(key) !== pc) return;
          this.closeLink(role, remotePeerId);
          this.onStreamEnd(remotePeerId);
        };

        track.onmute = () => {
          if (track.kind === 'audio') return;
          setTimeout(() => {
            if (this.connections.get(key) !== pc) return;
            if (track.muted && (track.readyState === 'ended' || pc.connectionState !== 'connected')) {
              this.closeLink(role, remotePeerId);
              this.onStreamEnd(remotePeerId);
            }
          }, 3000);
        };

        remoteStream.onremovetrack = () => {
          if (this.connections.get(key) !== pc) return;
          if (remoteStream.getTracks().filter(t => t.readyState === 'live').length === 0) {
            this.closeLink(role, remotePeerId);
            this.onStreamEnd(remotePeerId);
          }
        };
      }
    };

    pc.onconnectionstatechange = () => {
      if (this.connections.get(key) !== pc) return;
      console.log(`[WebRTC] Connection state (${key}): ${pc.connectionState}`);
      if (pc.connectionState === 'connected') monitor.markConnected();
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.closeLink(role, remotePeerId);
        this.onStreamEnd(remotePeerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (this.connections.get(key) !== pc) return;
      console.log(`[WebRTC] ICE state (${key}): ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this.timeline.iceConnected(monitor.connectionId);
      }
    };

    return pc;
  }

  /**
   * Última amostra do monitor. Não chama getStats.
   * O FPS é o medido na direção desta extremidade; zero não vira o FPS configurado.
   */
  async getConnectionStats(peerId: string): Promise<ConnectionStats | null> {
    const key = this.resolveLinkKey(peerId);
    const snapshot = key ? this.monitors.get(key)?.getSnapshot() ?? null : null;
    if (!snapshot) return null;
    return snapshotToConnectionStats(snapshot);
  }

  subscribeStats(peerId: string, listener: (snapshot: DiagnosticsSnapshot) => void): () => void {
    const key = this.resolveLinkKey(peerId);
    const monitor = key ? this.monitors.get(key) : undefined;
    if (!monitor) return () => {};
    return monitor.subscribe(listener);
  }

  subscribeDiagnostics(listener: () => void): () => void {
    this.diagnosticsListeners.add(listener);
    return () => this.diagnosticsListeners.delete(listener);
  }

  pushPlayback(peerId: string, sample: PlaybackSample): boolean {
    const key = this.resolveLinkKey(peerId);
    return key ? this.monitors.get(key)?.pushPlayback(sample) ?? false : false;
  }

  pushAudioPlayback(peerId: string, report: AudioPlaybackReport): boolean {
    const key = this.resolveLinkKey(peerId);
    return key ? this.monitors.get(key)?.pushAudioPlayback(report) ?? false : false;
  }

  getAudioNotice(): string | null {
    return this.audioCapture.message;
  }

  getSenderSnapshots(): DiagnosticsSnapshot[] {
    const snapshots: DiagnosticsSnapshot[] = [];
    for (const monitor of this.monitors.values()) {
      if (monitor.role !== 'sender' || monitor.isStopped) continue;
      const snapshot = monitor.getSnapshot();
      if (snapshot) snapshots.push(snapshot);
    }
    return snapshots;
  }

  downloadDiagnostics(peerId: string) {
    const key = this.resolveLinkKey(peerId);
    const monitor = key ? this.monitors.get(key) : undefined;
    if (!monitor) return;
    const report = monitor.exportReport();
    triggerJsonDownload(reportFilename(report.role, report.connectionId), report);
  }

  downloadDiagnosticsByConnection(connectionId: string) {
    for (const monitor of this.monitors.values()) {
      if (monitor.connectionId !== connectionId || monitor.isStopped) continue;
      const report = monitor.exportReport();
      triggerJsonDownload(reportFilename(report.role, report.connectionId), report);
      return;
    }
  }

  /** PeerIds conectados, sem o prefixo de papel e sem repetição. */
  getConnectedPeerIds(): string[] {
    const peerIds = new Set<string>();
    for (const key of this.connections.keys()) {
      const parsed = parseLinkKey(key);
      if (parsed) peerIds.add(parsed.peerId);
    }
    return Array.from(peerIds);
  }

  /**
   * Chave interna de um peer: primeiro o papel `receiver` (a live que eu
   * assisto), depois o `sender` (a live que eu transmito).
   */
  private resolveLinkKey(peerId: string): string | null {
    const receiverKey = linkKey('receiver', peerId);
    if (this.monitors.has(receiverKey) || this.connections.has(receiverKey)) return receiverKey;
    const senderKey = linkKey('sender', peerId);
    if (this.monitors.has(senderKey) || this.connections.has(senderKey)) return senderKey;
    return null;
  }

  private activeViewerCount(): number {
    let count = 0;
    for (const monitor of this.monitors.values()) {
      if (monitor.role === 'sender' && !monitor.isStopped) count += 1;
    }
    return count;
  }

  private applySenderBitrate(pc: RTCPeerConnection, bitrate: number) {
    const videoSender = pc.getSenders().find(sender => sender.track?.kind === 'video');
    if (!videoSender) return;
    try {
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = bitrate;
      videoSender.setParameters(params).catch((error) => {
        console.warn('[ABR] Falha ao aplicar bitrate:', error);
      });
    } catch (error) {
      console.warn('[ABR] Erro ao configurar params:', error);
    }
  }

  private notePreparedAudio(stream: MediaStream, mode: AudioMode, prepared: PreparedShare) {
    const track = stream.getAudioTracks()[0] ?? null;
    const videoTrack = stream.getVideoTracks()[0] ?? null;
    let surfaceSettings: Record<string, unknown> | null = null;
    try {
      const settings = videoTrack?.getSettings();
      if (settings && typeof settings === 'object' && 'suppressLocalAudioPlayback' in settings) {
        const value = (settings as { suppressLocalAudioPlayback?: unknown }).suppressLocalAudioPlayback;
        surfaceSettings = { suppressLocalAudioPlayback: value };
      }
    } catch {
      surfaceSettings = null;
    }
    this.hasAudioTrack = prepared.kept > 0;
    this.audioCapture = {
      requested: mode !== 'off',
      audioMode: mode,
      trackCount: prepared.kept,
      returnedTracks: prepared.returned,
      readyState: track?.readyState ?? null,
      enabled: track ? track.enabled : null,
      muted: track ? track.muted : null,
      displaySurface: prepared.surface === 'unknown' ? null : prepared.surface,
      policy: prepared.decision.policy,
      discardReason: prepared.kept > 0 ? null : prepared.message,
      message: prepared.message,
      format: readAudioCapture(track, surfaceSettings),
    };
    this.observeAudioTracks(stream);
    if (prepared.message) console.warn(`[WebRTC] ${prepared.message}`);
    if (mode !== 'off' && prepared.kept === 0) {
      this.rememberAudio('atenção', prepared.message ?? 'Áudio não autorizado para transmissão.', {
        superficie: prepared.surface,
        politica: prepared.decision.policy,
        devolvidas: prepared.returned,
        autorizadas: prepared.kept,
      });
    } else if (prepared.kept > 0) {
      this.rememberAudio('info', 'Track de áudio autorizada. O envio só conta quando os pacotes aumentam.', {
        tracks: prepared.kept,
        politica: prepared.decision.policy,
      });
    }
    this.onAudioStatus?.(this.hasAudioTrack);
  }

  private refreshAudioCapture(stream: MediaStream | null) {
    const tracks = stream?.getAudioTracks() ?? [];
    const track = tracks[0] ?? null;
    this.audioCapture.trackCount = tracks.length;
    this.audioCapture.readyState = track?.readyState ?? null;
    this.audioCapture.enabled = track ? track.enabled : null;
    this.audioCapture.muted = track ? track.muted : null;
    this.hasAudioTrack = tracks.length > 0;
  }

  private observeAudioTracks(stream: MediaStream) {
    const refresh = () => this.refreshAudioCapture(this.localStream);
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('mute', () => {
        refresh();
        this.rememberAudio('atenção', 'A track de áudio ficou muted na origem.', {});
      });
      track.addEventListener('unmute', () => {
        refresh();
        this.rememberAudio('info', 'A track de áudio saiu de muted.', {});
      });
      track.addEventListener('ended', () => {
        refresh();
        this.rememberAudio('crítico', 'A track de áudio encerrou.', {});
      });
    }
  }

  private rememberAudio(
    severity: 'info' | 'atenção' | 'crítico',
    message: string,
    data: Record<string, number | string | null>,
  ) {
    this.pendingAudioEvents.push({ severity, message, data });
    for (const monitor of this.monitors.values()) {
      if (monitor.role !== 'sender' || monitor.isStopped) continue;
      monitor.recordEvent({ category: 'ÁUDIO', severity, message, data });
    }
  }

  private noteAudioNegotiation(key: string, pc: RTCPeerConnection) {
    const result = negotiationFromSdp(pc.localDescription?.sdp, pc.remoteDescription?.sdp);
    const current = this.audioLink.get(key);
    const sender = this.monitors.get(key)?.role === 'sender';
    this.audioLink.set(key, {
      senderAttached: sender ? (current?.senderAttached ?? false) : false,
      negotiated: result.negotiated,
      direction: result.direction,
      local: result.local,
      remote: result.remote,
    });
    this.monitors.get(key)?.recordEvent({
      category: 'ÁUDIO',
      severity: result.negotiated ? 'info' : 'atenção',
      message: result.negotiated ? 'Negociação de áudio concluída.' : 'Negociação sem seção de áudio.',
      data: { direcao: result.direction, codec: result.codecs[0] ?? null },
    });
  }

  /**
   * Troca a resolução da live SEM derrubar o compartilhamento.
   *
   * Cada conexão de papel `sender` recebe seu próprio `setParameters`
   * (scaleResolutionDownBy/maxBitrate/maxFramerate/degradationPreference) com
   * try/catch individual: uma falha não derruba as demais nem a transmissão.
   * O ABR é recriado com o novo teto, no mesmo padrão de configureVideoSender.
   *
   * Devolve false só quando nenhuma conexão aceitou a mudança — nesse caso o
   * valor anterior continua valendo e a UI avisa.
   */
  async setStreamResolution(resolution: '2160' | '1080' | '720' | '480'): Promise<boolean> {
    const target = RESOLUTION_MAP[resolution];
    if (!target) return false;

    const previous = this.currentConfig.resolution;
    const maxBitrate = BITRATE_MAP[resolution] || BITRATE_MAP[previous];
    const scale = this.scaleResolutionDownBy(resolution);
    const fps = this.currentConfig.frameRate;

    this.currentConfig = { ...this.currentConfig, resolution };

    let attempted = 0;
    let applied = 0;
    for (const [key, pc] of [...this.connections.entries()]) {
      const parsed = parseLinkKey(key);
      if (!parsed || parsed.role !== 'sender') continue;
      const videoSender = pc.getSenders().find((sender) => sender.track?.kind === 'video');
      if (!videoSender) continue;
      attempted += 1;
      try {
        const params = videoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].scaleResolutionDownBy = scale;
        params.encodings[0].maxBitrate = maxBitrate;
        params.encodings[0].maxFramerate = fps;
        // @ts-ignore - degradationPreference exists but TypeScript doesn't know about it
        params.degradationPreference = 'maintain-framerate';
        await videoSender.setParameters(params);
        applied += 1;
        // O ABR nasce com um teto fixo: recria com o teto da nova resolução.
        this.restartAbr(pc, key, maxBitrate);
        console.info(`[WebRTC] Resolução ${resolution}p aplicada em ${key} (scale ${scale}, teto ${(maxBitrate / 1_000_000).toFixed(1)} Mbps)`);
      } catch (error) {
        console.warn(`[WebRTC] Falha ao aplicar ${resolution}p em ${key}:`, error);
      }
    }

    if (attempted > 0 && applied === 0) {
      // Nenhuma conexão aceitou: o valor anterior continua valendo.
      this.currentConfig = { ...this.currentConfig, resolution: previous };
      return false;
    }

    // Secundário, no melhor esforço: pedir a resolução direto na captura.
    const track = this.localStream?.getVideoTracks()[0];
    if (track) {
      try {
        await track.applyConstraints({
          width: { ideal: target.width },
          height: { ideal: target.height },
          frameRate: { ideal: fps, max: fps },
        });
      } catch (error) {
        console.warn('[WebRTC] Captura recusou a nova resolução (best effort):', error);
      }
    }

    return true;
  }

  /** Fecha a conexão de um papel específico (`sender` ou `receiver`). */
  private closeLink(role: LinkRole, peerId: string, cause: 'leave' | 'replace' = 'leave') {
    this.closeLinkByKey(linkKey(role, peerId), cause);
  }

  /** Fecha os dois papéis de um peer. */
  private closePeer(peerId: string, cause: 'leave' | 'replace' = 'leave') {
    this.closeLink('receiver', peerId, cause);
    this.closeLink('sender', peerId, cause);
  }

  private closeLinkByKey(key: string, cause: 'leave' | 'replace' = 'leave') {
    const parsed = parseLinkKey(key);
    const monitor = this.monitors.get(key);
    const pc = this.connections.get(key);
    this.connections.delete(key);
    if (monitor) {
      this.encoderProbes.delete(monitor.connectionId);
      monitor.stop();
      this.monitors.delete(key);
      if (cause === 'leave') this.timeline.setViewerCount(this.activeViewerCount());
      this.timeline.connectionClosed(monitor.connectionId);
      if (cause === 'leave' && monitor.role === 'sender') {
        this.timeline.viewerDisconnected(monitor.connectionId);
      }
    }
    if (pc) {
      // Para tracks de vídeo clonadas (criadas em createOfferForViewer)
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind === 'video' && sender.track !== this.localStream?.getVideoTracks()[0]) {
          sender.track.stop();
        }
      }
      pc.close();
    }
    // A notificação de live é por peer e vale para o papel receiver.
    if (parsed?.role === 'receiver') this.notifiedPeers.delete(parsed.peerId);
    this.audioLink.delete(key);
    this.remoteAudioTracks.delete(key);

    const abr = this.abrControllers.get(key);
    if (abr) {
      abr.stop();
      this.abrControllers.delete(key);
    }
  }
}

function snapshotToConnectionStats(snapshot: DiagnosticsSnapshot): ConnectionStats {
  const sample = snapshot.sample;
  const sender = sample.role === 'sender';
  const fps = sender
    ? (sample.outbound?.encodedFps ?? sample.outbound?.reportedFps ?? null)
    : (sample.inbound?.decodedFps ?? sample.inbound?.reportedFps ?? null);
  const width = sender
    ? (sample.outbound?.frameWidth ?? sample.outbound?.sourceWidth ?? null)
    : (sample.inbound?.frameWidth ?? null);
  const height = sender
    ? (sample.outbound?.frameHeight ?? sample.outbound?.sourceHeight ?? null)
    : (sample.inbound?.frameHeight ?? null);
  return {
    role: sample.role,
    videoCodec: sample.videoCodec ?? '—',
    audioCodec: sample.audioCodec ?? '—',
    videoBitrate: sender ? (sample.outbound?.bitrate ?? null) : (sample.inbound?.bitrate ?? null),
    audioBitrate: sample.audioBitrate,
    fps,
    width,
    height,
    packetLoss: sender ? (sample.remoteInbound?.packetsLost ?? null) : (sample.inbound?.packetsLost ?? null),
    packetLossRate: sender ? (sample.remoteInbound?.lossPct ?? null) : (sample.inbound?.lossPct ?? null),
    roundTripTime: sample.network.rttMs,
    hasAudio: sample.hasAudio,
    jitter: sender ? (sample.remoteInbound?.jitterMs ?? null) : (sample.inbound?.jitterMs ?? null),
    timestamp: sample.timestamp,
    adaptiveState: snapshot.adaptiveState ?? undefined,
  };
}
