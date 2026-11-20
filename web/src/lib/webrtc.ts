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
    const res = RESOLUTION_MAP[config?.resolution || '1080'];
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: res.width },
        height: { ideal: res.height },
        frameRate: { ideal: config?.frameRate || 30 },
      },
      audio: config?.audio ?? true,
    });

    this.localStream = stream;

    // Detecta quando o usuário clica "Parar de compartilhar" no browser
    stream.getVideoTracks()[0].onended = () => {
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

    // Cria e envia o offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.signal.send({
      type: 'offer',
      to: viewerId,
      sdp: pc.localDescription!,
    });
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
   * Recebi answer de um viewer
   */
  private async handleAnswer(fromId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.connections.get(fromId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
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
      }
    };

    // Log de estado
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
