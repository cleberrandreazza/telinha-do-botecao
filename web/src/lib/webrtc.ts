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
  '2160': 12_000_000, // 12 Mbps
  '1080': 6_000_000,  //  6 Mbps
  '720': 3_000_000,   //  3 Mbps
  '480': 1_500_000,   //  1.5 Mbps
};

/**
 * Servidores ICE (STUN + TURN gratuito via Open Relay)
 * STUN: Google público
 * TURN: Open Relay (metered.ca) - 20GB/mês grátis
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

type OnStreamCallback = (info: StreamInfo) => void;
type OnStreamEndCallback = (peerId: string) => void;

export class WebRTCManager {
  private signal: SignalingClient;
  private connections = new Map<string, RTCPeerConnection>();
  private localStream: MediaStream | null = null;
  private currentConfig: StreamConfig = { resolution: '1080', frameRate: 30, audio: true };
  private myPeerId = '';
  private onStream: OnStreamCallback;
  private onStreamEnd: OnStreamEndCallback;
  private unsubSignal: (() => void) | null = null;

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

  /**
   * Inicia a escuta de mensagens de sinalização WebRTC
   */
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

    const displayMediaOptions: DisplayMediaStreamOptions & { systemAudio?: string } = {
      video: {
        width: { ideal: res.width },
        height: { ideal: res.height },
        frameRate: { ideal: fps, max: fps },
      },
      audio: wantsAudio
        ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          }
        : false,
    };

    // systemAudio é top-level no getDisplayMedia (Chromium 105+)
    if (wantsAudio) {
      // @ts-ignore — propriedade existe mas não está nos tipos TS
      displayMediaOptions.systemAudio = 'include';
    }

    const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions as DisplayMediaStreamOptions);

    // Otimiza a track de vídeo para screen sharing com movimento (jogos, vídeos)
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.contentHint = 'motion';
    }

    this.localStream = stream;

    // Detecta quando o usuário clica "Parar de compartilhar" no browser
    videoTrack.onended = () => {
      this.stopScreenShare();
    };

    // Notifica o servidor
    this.signal.send({ type: 'start-sharing' });

    return stream;
  }

  /**
   * Para de compartilhar a tela
   */
  stopScreenShare() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    // Fecha todas as conexões onde eu sou o sharer
    for (const [peerId, pc] of this.connections) {
      pc.close();
      this.connections.delete(peerId);
    }

    this.signal.send({ type: 'stop-sharing' });
  }

  /**
   * Solicita stream de um peer que está compartilhando
   */
  requestStream(sharerId: string) {
    this.signal.send({ type: 'request-stream', sharerId });
  }

  /**
   * Fecha tudo
   */
  destroy() {
    this.stopScreenShare();
    this.stopListening();
    for (const pc of this.connections.values()) {
      pc.close();
    }
    this.connections.clear();
  }

  // ── Handlers de sinalização ──

  private async handleSignalMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'stream-requested':
        // Alguém quer meu stream → criar offer
        await this.createOfferForViewer(msg.from);
        break;

      case 'offer':
        // Recebi um offer → criar answer (eu sou viewer)
        await this.handleOffer(msg.from, msg.sdp);
        break;

      case 'answer':
        // Recebi answer do viewer
        await this.handleAnswer(msg.from, msg.sdp);
        break;

      case 'ice-candidate':
        // Candidato ICE de um peer
        await this.handleIceCandidate(msg.from, msg.candidate);
        break;

      case 'sharing-stopped':
        // Peer parou de compartilhar
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
   * Eu sou o SHARER: criar PeerConnection + offer para um viewer
   */
  private async createOfferForViewer(viewerId: string) {
    if (!this.localStream) return;

    const pc = this.createPeerConnection(viewerId);

    // Adiciona as tracks da minha tela
    for (const track of this.localStream.getTracks()) {
      pc.addTrack(track, this.localStream);
    }

    // Prefere H264 DEPOIS de addTrack (transceivers existem agora)
    this.preferH264(pc);

    // Cria offer e injeta bandwidth no SDP
    const offer = await pc.createOffer();
    const maxKbps = Math.round((BITRATE_MAP[this.currentConfig.resolution] || 6_000_000) / 1000);
    const tweakedSdp = this.addBandwidthToSdp(offer.sdp || '', maxKbps);
    await pc.setLocalDescription({ type: 'offer', sdp: tweakedSdp });

    this.signal.send({
      type: 'offer',
      to: viewerId,
      sdp: pc.localDescription!,
    });
  }

  /**
   * Prefere H264 sobre VP9 — H264 usa encoding por hardware (GPU),
   * VP9 usa CPU que compete com o jogo que está rodando
   */
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
      // setCodecPreferences não suportado em todos os browsers
    }
  }

  /**
   * Injeta b=AS (bandwidth) no SDP para definir bitrate máximo
   * Mais confiável que setParameters antes da negociação completar
   */
  private addBandwidthToSdp(sdp: string, maxKbps: number): string {
    // Adiciona b=AS após cada m=video line
    return sdp.replace(/(m=video.*\r\n)/g, `$1b=AS:${maxKbps}\r\n`);
  }

  /**
   * Configura sender de vídeo DEPOIS da negociação (chamado ao receber answer)
   */
  private async configureVideoSender(pc: RTCPeerConnection) {
    const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (!videoSender) return;

    try {
      const params = videoSender.getParameters();

      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      const maxBitrate = BITRATE_MAP[this.currentConfig.resolution] || 6_000_000;
      params.encodings[0].maxBitrate = maxBitrate;
      params.encodings[0].maxFramerate = this.currentConfig.frameRate;

      // @ts-ignore
      params.degradationPreference = 'maintain-framerate';

      await videoSender.setParameters(params);
    } catch {
      console.warn('[WebRTC] Não foi possível configurar sender de vídeo');
    }
  }

  /**
   * Eu sou o VIEWER: recebi offer, criar answer
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
   * Recebi answer de um viewer — agora configura bitrate DEPOIS da negociação
   */
  private async handleAnswer(fromId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.connections.get(fromId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));

    // Agora que a negociação completou, configura bitrate e framerate no sender
    await this.configureVideoSender(pc);
  }

  /**
   * Recebeu candidato ICE
   */
  private async handleIceCandidate(fromId: string, candidate: RTCIceCandidateInit) {
    const pc = this.connections.get(fromId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Pode acontecer se o estado já mudou
    }
  }

  /**
   * Cria uma RTCPeerConnection com config de ICE
   */
  private createPeerConnection(remotePeerId: string): RTCPeerConnection {
    // Fecha conexão anterior se existir
    this.closeConnection(remotePeerId);

    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
    });

    this.connections.set(remotePeerId, pc);

    // Envia candidatos ICE via sinalização
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signal.send({
          type: 'ice-candidate',
          to: remotePeerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // Recebe stream remoto (eu sou viewer)
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.onStream({
          peerId: remotePeerId,
          nickname: '', // será preenchido pelo componente
          stream: remoteStream,
        });

        // Monitora o fim da track remota (sharer fechou o programa / parou de compartilhar)
        const track = event.track;
        track.onended = () => {
          this.closeConnection(remotePeerId);
          this.onStreamEnd(remotePeerId);
        };

        // Alguns browsers disparam 'mute' em vez de 'ended' quando a track remota para
        track.onmute = () => {
          // Espera um pouco — tracks podem ficar muted temporariamente durante renegociação
          setTimeout(() => {
            if (track.muted && (track.readyState === 'ended' || pc.connectionState !== 'connected')) {
              this.closeConnection(remotePeerId);
              this.onStreamEnd(remotePeerId);
            }
          }, 3000);
        };

        // Safety net: se todas as tracks forem removidas do stream
        remoteStream.onremovetrack = () => {
          if (remoteStream.getTracks().filter(t => t.readyState === 'live').length === 0) {
            this.closeConnection(remotePeerId);
            this.onStreamEnd(remotePeerId);
          }
        };
      }
    };

    // Log de estado — detecta queda de conexão
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.closeConnection(remotePeerId);
        this.onStreamEnd(remotePeerId);
      }
    };

    return pc;
  }

  private closeConnection(peerId: string) {
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
    }
  }
}
