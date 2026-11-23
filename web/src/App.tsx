import { useState, useRef, useCallback, useEffect } from 'react';
import { SignalingClient } from './lib/signaling';
import { WebRTCManager } from './lib/webrtc';
import { getSignalingUrl } from './lib/utils';
import { detectScreenShareSupport, readScreenShareEnvironment } from './lib/screenShare';
import type { AppScreen, ChatMessage, PeerInfo, StreamInfo, ServerMessage } from './lib/types';
import { sanitizeChatText } from './lib/chat';
import { MAX_SIMULTANEOUS_STREAMS } from './lib/constants';
import {
  loadRoomSession,
  saveRoomSession,
  clearRoomSession,
  type RoomSession,
} from './lib/session';
import Home from './components/Home';
import Room from './components/Room';
import Reconnecting from './components/Reconnecting';
import StreamSettings from './components/StreamSettings';
import type { StreamResolution } from './components/ResolutionControl';
import type { StreamConfig } from './lib/webrtc';
import { describeCapture, readTrackSettings } from './lib/diagnostics/index';
import type { AudioPlaybackReport, DiagnosticsSnapshot, PlaybackSample } from './lib/diagnostics/index';
import {
  isMockMode,
  isMockSharing,
  createMockLocalStream,
  generateMockData,
  generateMockStreamsDelayed,
  generateMockChatMessages,
  simulateMockChatEcho,
} from './lib/mock';

/** Quantidade máxima de mensagens de chat mantidas em memória. */
const CHAT_HISTORY_MAX = 200;

/** Espera máxima pelo `room-joined` ao restaurar a sessão depois do F5. */
const RECONNECT_TIMEOUT_MS = 6000;

/** Tempo que a mensagem otimista espera pelo eco do servidor antes de falhar. */
const CHAT_ECHO_TIMEOUT_MS = 6000;

/** Tolerância (ms) para casar o eco do servidor com a mensagem otimista. */
const CHAT_ECHO_TOLERANCE_MS = 15000;

/**
 * Tempo mínimo em que o estado "Aplicando…" fica visível.
 * A troca de resolução real leva alguns ms (setParameters no encoder); o
 * piso evita que o rótulo pisque e desapareça antes de ser lido.
 */
const RESOLUTION_BUSY_MIN_MS = 350;

/**
 * Lê a resolução REAL da captura local.
 * O navegador nem sempre expõe a faixa capturada: sem largura/altura, o
 * valor é null (a UI mostra "n/d"). Nada é estimado nem copiado de outra
 * métrica — ver docs/diagnostics.md.
 */
function readMeasuredResolution(stream: MediaStream | null): string | null {
  if (!stream) return null;
  const track = stream.getVideoTracks()[0];
  if (!track) return null;
  let settings = null;
  try {
    settings = readTrackSettings(track.getSettings() as Record<string, unknown>);
  } catch {
    return null;
  }
  if (settings.width === null || settings.height === null) return null;
  return describeCapture(settings);
}

/**
 * Acrescenta a mensagem no fim da lista, cortando as mais antigas quando
 * passa do limite de memória.
 */
function appendChat(list: ChatMessage[], entry: ChatMessage): ChatMessage[] {
  const next = [...list, entry];
  return next.length > CHAT_HISTORY_MAX ? next.slice(next.length - CHAT_HISTORY_MAX) : next;
}

/**
 * Procura a mensagem otimista que corresponde ao eco do servidor.
 * O broadcast não devolve `id`, então o casamento é por from + ts + text; se o
 * relógio do servidor divergir do nosso, cai para from + text dentro da
 * tolerância (o servidor pode estar em outro fuso/relógio).
 */
function findOptimisticIndex(list: ChatMessage[], incoming: ChatMessage): number {
  const exact = list.findIndex(
    (m) => m.pending && m.from === incoming.from && m.ts === incoming.ts && m.text === incoming.text
  );
  if (exact !== -1) return exact;
  return list.findIndex(
    (m) =>
      m.pending &&
      m.from === incoming.from &&
      m.text === incoming.text &&
      Math.abs(m.ts - incoming.ts) <= CHAT_ECHO_TOLERANCE_MS
  );
}

/** Cancela o timer de "sem eco do servidor" de uma mensagem otimista. */
function clearChatPendingTimer(timers: Map<string, number>, id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
}

export default function App() {
  // ── Estado da aplicação ──
  const [screen, setScreen] = useState<AppScreen>('home');
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // ── Estado da sala ──
  const [roomCode, setRoomCode] = useState('');
  const [myPeerId, setMyPeerId] = useState('');
  const [nickname, setNickname] = useState('');
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [audioNotice, setAudioNotice] = useState<string | null>(null);

  // ── Resolução da live (troca durante a transmissão) ──
  const [streamResolution, setStreamResolution] = useState<StreamResolution>('1080');
  const [resolutionBusy, setResolutionBusy] = useState(false);
  const [resolutionNotice, setResolutionNotice] = useState<string | null>(null);
  /** Resolução medida na captura (null = o navegador não informa). */
  const [measuredResolution, setMeasuredResolution] = useState<string | null>(null);

  // ── Chat da sala ──
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatUnread, setChatUnread] = useState(0);

  // ── Limite de transmissões simultâneas (grade de até 4) ──
  /** Aviso exibido quando o pedido de uma live é barrado pelo limite. */
  const [streamLimitNotice, setStreamLimitNotice] = useState<string | null>(null);

  // ── Reconexão automática (F5) ──
  const [reconnectState, setReconnectState] = useState<'idle' | 'connecting' | 'failed'>('idle');
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  /** true quando ainda vale a pena oferecer "Tentar de novo". */
  const [reconnectCanRetry, setReconnectCanRetry] = useState(false);
  const [restoredNotice, setRestoredNotice] = useState<string | null>(null);

  // ── Refs para manter instâncias estáveis ──
  const signalRef = useRef<SignalingClient | null>(null);
  const rtcRef = useRef<WebRTCManager | null>(null);
  const peersRef = useRef<PeerInfo[]>([]);
  const nickRef = useRef<string>('');
  const myPeerIdRef = useRef('');
  /** true enquanto o painel de chat está aberto (para o contador de não lidas). */
  const chatOpenRef = useRef(true);
  /** true enquanto estamos tentando restaurar a sessão após o F5. */
  const reconnectingRef = useRef(false);
  /** Sessão que estamos tentando restaurar (null quando não há restore em curso). */
  const restoreRef = useRef<RoomSession | null>(null);
  /** Sessão da reconexão — guardada mesmo depois de uma falha, para o "Tentar de novo". */
  const reconnectSessionRef = useRef<RoomSession | null>(null);
  /** Timer do timeout de 6 s da reconexão. */
  const reconnectTimerRef = useRef<number | null>(null);
  /** true quando o usuário cancelou a reconexão no meio do caminho. */
  const reconnectCancelledRef = useRef(false);
  /** Contador dos ids locais das mensagens otimistas. */
  const localChatIdRef = useRef(0);
  /** Timers de "sem eco do servidor" das mensagens otimistas. */
  const chatPendingTimersRef = useRef<Map<string, number>>(new Map());
  /** Espelho da lista de chat (para casar o eco do servidor fora do setState). */
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  /** Espelho da resolução atual (para reverter a troca em caso de falha). */
  const streamResolutionRef = useRef<StreamResolution>('1080');
  /** true enquanto uma troca de resolução está em andamento. */
  const resolutionBusyRef = useRef(false);
  /** Peers cujas lives estou recebendo agora (ocupa um slot da grade). */
  const requestedSharersRef = useRef<Set<string>>(new Set());

  // Sync refs
  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);
  useEffect(() => {
    nickRef.current = nickname;
  }, [nickname]);
  useEffect(() => {
    myPeerIdRef.current = myPeerId;
  }, [myPeerId]);
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);
  useEffect(() => {
    streamResolutionRef.current = streamResolution;
  }, [streamResolution]);

  // ── Callbacks de stream ──
  const handleNewStream = useCallback((info: StreamInfo) => {
    // Encontra o nickname do peer
    const peer = peersRef.current.find(p => p.id === info.peerId);
    info.nickname = peer?.nickname || 'Desconhecido';

    setStreams(prev => {
      // Remove stream anterior do mesmo peer se existir
      const filtered = prev.filter(s => s.peerId !== info.peerId);
      return [...filtered, info];
    });
  }, []);

  const handleStreamEnd = useCallback((peerId: string) => {
    setStreams(prev => prev.filter(s => s.peerId !== peerId));
    // A live acabou: o slot volta a ficar livre.
    requestedSharersRef.current.delete(peerId);
    setStreamLimitNotice(null);
  }, []);

  // ── Grade: pedir a live de um peer (até MAX_SIMULTANEOUS_STREAMS por vez) ──
  const handleRequestStream = useCallback((peerId: string) => {
    const requested = requestedSharersRef.current;
    if (requested.has(peerId)) return;
    if (requested.size >= MAX_SIMULTANEOUS_STREAMS) {
      // Sem slot: o peer continua na sidebar e o aviso explica o motivo.
      setStreamLimitNotice('Máximo de 4 transmissões simultâneas');
      return;
    }
    requested.add(peerId);
    setStreamLimitNotice(null);
    rtcRef.current?.requestStream(peerId);
  }, []);

  /** O tile foi fechado na grade: para de receber a live e libera o slot. */
  const handleStreamRemoved = useCallback((peerId: string) => {
    requestedSharersRef.current.delete(peerId);
    rtcRef.current?.stopReceiving(peerId);
    setStreamLimitNotice(null);
  }, []);

  // ── Handler de mensagens do servidor ──
  const handleSignalMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'room-created': {
        const selfPeer: PeerInfo = { id: msg.peerId, nickname: nickRef.current, isSharing: false };
        setRoomCode(msg.code);
        setMyPeerId(msg.peerId);
        setPeers([selfPeer]);
        setScreen('room');
        setError(null);
        setConnecting(false);
        rtcRef.current?.setMyPeerId(msg.peerId);
        saveRoomSession({ code: msg.code, nickname: nickRef.current, wasSharing: false, savedAt: Date.now() });
        break;
      }

      case 'room-joined': {
        const selfJoined: PeerInfo = { id: msg.peerId, nickname: nickRef.current, isSharing: false };
        const peersWithSelf = msg.peers.some((p: PeerInfo) => p.id === msg.peerId)
          ? msg.peers
          : [...msg.peers, selfJoined];
        setRoomCode(msg.code);
        setMyPeerId(msg.peerId);
        setPeers(peersWithSelf);
        setScreen('room');
        setError(null);
        setConnecting(false);
        rtcRef.current?.setMyPeerId(msg.peerId);

        // Sessão restaurada depois do F5: sai da tela de reconexão
        const restoring = restoreRef.current;
        if (restoring) {
          restoreRef.current = null;
          reconnectingRef.current = false;
          if (reconnectTimerRef.current !== null) {
            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          setReconnectState('idle');
          setReconnectError(null);
          setRestoredNotice(
            restoring.wasSharing
              ? 'Reconectado. Clique em Compartilhar Tela para retomar a transmissão.'
              : 'Sessão restaurada.'
          );
        }

        saveRoomSession({ code: msg.code, nickname: nickRef.current, wasSharing: false, savedAt: Date.now() });

        // Solicita streams de quem já está compartilhando (até o limite da grade)
        for (const peer of msg.peers) {
          if (peer.isSharing) {
            handleRequestStream(peer.id);
          }
        }
        break;
      }

      case 'peer-joined':
        setPeers(prev => [...prev, msg.peer]);
        break;

      case 'peer-left':
        setPeers(prev => prev.filter(p => p.id !== msg.peerId));
        setStreams(prev => prev.filter(s => s.peerId !== msg.peerId));
        requestedSharersRef.current.delete(msg.peerId);
        break;

      case 'sharing-started':
        setPeers(prev =>
          prev.map(p => p.id === msg.peerId ? { ...p, isSharing: true } : p)
        );
        // Solicita o stream automaticamente (se houver slot livre na grade)
        handleRequestStream(msg.peerId);
        break;

      case 'sharing-stopped':
        setPeers(prev =>
          prev.map(p => p.id === msg.peerId ? { ...p, isSharing: false } : p)
        );
        setStreams(prev => prev.filter(s => s.peerId !== msg.peerId));
        requestedSharersRef.current.delete(msg.peerId);
        break;

      case 'left-room':
        resetRoom();
        break;

      case 'chat-message': {
        const entry: ChatMessage = {
          id: `srv-${msg.from}-${msg.ts}`,
          from: msg.from,
          nickname: msg.nickname,
          text: msg.text,
          ts: msg.ts,
        };
        // O broadcast não devolve `id`: a mensagem otimista é casada por
        // from + ts + text e substituída pelo eco do servidor. O casamento é
        // feito antes de mexer na lista para cancelar o timer de "sem eco".
        const optimistic = findOptimisticIndex(chatMessagesRef.current, entry);
        if (optimistic !== -1) {
          clearChatPendingTimer(
            chatPendingTimersRef.current,
            chatMessagesRef.current[optimistic].id
          );
        }
        setChatMessages((prev) => {
          const index = findOptimisticIndex(prev, entry);
          if (index === -1) return appendChat(prev, entry);
          const next = [...prev];
          next[index] = { ...entry, id: next[index].id };
          return next;
        });
        // Mensagem chegando com o painel fechado conta como não lida
        // (a própria mensagem já está na tela: não conta).
        if (!chatOpenRef.current && msg.from !== myPeerIdRef.current) {
          setChatUnread((count) => count + 1);
        }
        break;
      }

      case 'chat-history': {
        // Histórico da sala: substitui a lista (não conta como não lida)
        setChatMessages(msg.messages.slice(-CHAT_HISTORY_MAX));
        break;
      }

      case 'error':
        if (reconnectingRef.current) {
          // Não deu para restaurar a sessão (ex.: sala não existe mais):
          // a sessão salva é apagada e a tela de reconexão vira estado de falha.
          reconnectingRef.current = false;
          restoreRef.current = null;
          if (reconnectTimerRef.current !== null) {
            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          clearRoomSession();
          setReconnectState('failed');
          setReconnectError(msg.message);
          break;
        }
        setError(msg.message);
        setConnecting(false);
        break;
    }
  }, []);

  // ── Conexão e setup ──
  const ensureConnected = async (): Promise<SignalingClient> => {
    if (signalRef.current?.connected) {
      return signalRef.current;
    }

    const signal = new SignalingClient(getSignalingUrl());

    // Setup WebRTC manager
    const rtc = new WebRTCManager(signal, handleNewStream, handleStreamEnd);
    rtc.startListening();

    // Listen to signaling messages for room management
    signal.onMessage(handleSignalMessage);

    await signal.connect();

    signalRef.current = signal;
    rtcRef.current = rtc;

    return signal;
  };

  // ── Ações ──
  const handleCreateRoom = async (nick: string, password?: string) => {
    setError(null);
    setConnecting(true);
    setNickname(nick);

    try {
      const signal = await ensureConnected();
      signal.send({ type: 'create-room', nickname: nick, password });
    } catch (err) {
      setError('Não foi possível conectar ao servidor. Verifique se o servidor está rodando.');
      setConnecting(false);
    }
  };

  const handleJoinRoom = async (code: string, nick: string, password?: string) => {
    setError(null);
    setConnecting(true);
    setNickname(nick);

    try {
      const signal = await ensureConnected();
      signal.send({ type: 'join-room', code, nickname: nick, password });
    } catch (err) {
      setError('Não foi possível conectar ao servidor. Verifique se o servidor está rodando.');
      setConnecting(false);
    }
  };

  const handleOpenSettings = () => {
    const support = detectScreenShareSupport(readScreenShareEnvironment());
    if (!support.supported) {
      setError(support.message);
      return;
    }
    setError(null);
    setShowSettings(true);
  };

  const handleStartSharing = async (config?: StreamConfig) => {
    setShowSettings(false);
    try {
      const stream = await rtcRef.current?.startScreenShare(config);
      if (stream) {
        setLocalStream(stream);
        setIsSharing(true);
        setAudioNotice(rtcRef.current?.getAudioNotice() ?? null);
        // A resolução inicial é a escolhida no StreamSettings.
        setStreamResolution(config?.resolution ?? '1080');
        setResolutionNotice(null);

        // Atualiza o próprio peer na lista
        setPeers(prev => prev.map(p => p.id === myPeerId ? { ...p, isSharing: true } : p));
        if (roomCode) {
          saveRoomSession({ code: roomCode, nickname, wasSharing: true, savedAt: Date.now() });
        }

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const prior = videoTrack.onended;
          videoTrack.onended = (event) => {
            if (typeof prior === 'function') prior.call(videoTrack, event);
            setLocalStream(null);
            setIsSharing(false);
            setAudioNotice(null);
            setPeers(prev => prev.map(p => p.id === myPeerId ? { ...p, isSharing: false } : p));
            if (roomCode) {
              saveRoomSession({ code: roomCode, nickname, wasSharing: false, savedAt: Date.now() });
            }
          };
        }
      }
    } catch (err: any) {
      // Usuário cancelou o dialog de compartilhamento
      if (err?.name === 'ScreenShareUnsupportedError') {
        setError(err.message);
      } else if (err?.name !== 'NotAllowedError') {
        setError('Erro ao compartilhar tela: ' + err.message);
      }
    }
  };

  const handleStopSharing = () => {
    rtcRef.current?.stopScreenShare();
    setLocalStream(null);
    setIsSharing(false);
    setAudioNotice(null);
    // Atualiza o próprio peer na lista
    setPeers(prev => prev.map(p => p.id === myPeerId ? { ...p, isSharing: false } : p));
    if (roomCode) {
      saveRoomSession({ code: roomCode, nickname, wasSharing: false, savedAt: Date.now() });
    }
  };

  const handleLeaveRoom = () => {
    signalRef.current?.send({ type: 'leave-room' });
    // A sessão salva é apagada: sair da sala encerra a reconexão automática
    clearRoomSession();
    rtcRef.current?.destroy();
    resetRoom();
  };

  // ── Resolução da live ──
  // A medição vem da própria captura: o navegador nem sempre expõe a faixa
  // capturada, e nesse caso o valor é null (a UI mostra "n/d").
  useEffect(() => {
    if (!isSharing || !localStream) {
      setMeasuredResolution(null);
      return;
    }
    const read = () => setMeasuredResolution(readMeasuredResolution(localStream));
    read();
    const timer = window.setInterval(read, 1000);
    return () => window.clearInterval(timer);
  }, [isSharing, localStream]);

  /**
   * Troca a resolução durante a live.
   *
   * O núcleo está no WebRTCManager: `setParameters` em cada conexão de
   * papel `sender` (scaleResolutionDownBy/maxBitrate/maxFramerate/
   * degradationPreference), cada uma no seu próprio try/catch, com o ABR
   * recriado no teto novo. Se NENHUMA conexão aceitar, o valor anterior
   * continua valendo — a transmissão não cai e a UI avisa.
   */
  const handleSelectResolution = useCallback(async (next: StreamResolution) => {
    if (resolutionBusyRef.current) return;
    if (next === streamResolutionRef.current) return;

    const previous = streamResolutionRef.current;
    resolutionBusyRef.current = true;
    setResolutionBusy(true);
    setResolutionNotice(null);

    const startedAt = Date.now();
    try {
      const rtc = rtcRef.current;
      // Sem WebRTC real (modo ?mock) não existe encoder para reconfigurar:
      // a seleção vale para a UI da simulação.
      const applied = rtc ? await rtc.setStreamResolution(next) : true;

      // A troca real leva alguns ms; o piso mantém "Aplicando…" legível.
      const elapsed = Date.now() - startedAt;
      if (elapsed < RESOLUTION_BUSY_MIN_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, RESOLUTION_BUSY_MIN_MS - elapsed));
      }

      if (applied) {
        streamResolutionRef.current = next;
        setStreamResolution(next);
        setResolutionNotice(null);
      } else {
        streamResolutionRef.current = previous;
        setStreamResolution(previous);
        setResolutionNotice('Não foi possível mudar a resolução. A transmissão continua como estava.');
      }
    } catch {
      streamResolutionRef.current = previous;
      setStreamResolution(previous);
      setResolutionNotice('Não foi possível mudar a resolução. A transmissão continua como estava.');
    } finally {
      resolutionBusyRef.current = false;
      setResolutionBusy(false);
      // A captura pode ter mudado de tamanho: relê a medição.
      setMeasuredResolution(readMeasuredResolution(localStream));
    }
  }, [localStream]);

  // ── Chat da sala ──
  // A mensagem entra na tela na hora (otimista, com id local) e é reconciliada
  // quando o eco do servidor chega. O servidor descarta silenciosamente
  // mensagens enviadas com menos de 500 ms de intervalo — por isso o painel
  // trava o envio pelo mesmo tempo (ver ChatPanel).
  const scheduleChatPending = useCallback((id: string) => {
    const timer = window.setTimeout(() => {
      chatPendingTimersRef.current.delete(id);
      setChatMessages((prev) =>
        prev.map((m) => (m.id === id && m.pending ? { ...m, pending: false, failed: true } : m))
      );
    }, CHAT_ECHO_TIMEOUT_MS);
    chatPendingTimersRef.current.set(id, timer);
  }, []);

  const handleSendChat = useCallback(
    (text: string) => {
      const clean = sanitizeChatText(text);
      if (!clean) return;
      const entry: ChatMessage = {
        id: `local-${++localChatIdRef.current}`,
        from: myPeerIdRef.current,
        nickname: nickRef.current,
        text: clean,
        ts: Date.now(),
        pending: true,
      };
      setChatMessages((prev) => appendChat(prev, entry));
      if (signalRef.current) {
        signalRef.current.send({ type: 'chat-message', text: clean });
      } else if (isMockMode()) {
        // No mock não existe servidor: simulamos o eco para a mensagem
        // otimista ser reconciliada (igual acontece na sala real).
        simulateMockChatEcho(entry, (echo) => handleSignalMessage(echo));
      }
      scheduleChatPending(entry.id);
    },
    [handleSignalMessage, scheduleChatPending]
  );

  /** Reenvia uma mensagem que ficou sem o eco do servidor. */
  const handleRetryChat = useCallback(
    (message: ChatMessage) => {
      const clean = sanitizeChatText(message.text);
      if (!clean) return;
      const entry: ChatMessage = {
        id: `local-${++localChatIdRef.current}`,
        from: myPeerIdRef.current,
        nickname: nickRef.current,
        text: clean,
        ts: Date.now(),
        pending: true,
      };
      setChatMessages((prev) => {
        const without = prev.filter((m) => m.id !== message.id);
        return appendChat(without, entry);
      });
      if (signalRef.current) {
        signalRef.current.send({ type: 'chat-message', text: clean });
      } else if (isMockMode()) {
        simulateMockChatEcho(entry, (echo) => handleSignalMessage(echo));
      }
      scheduleChatPending(entry.id);
    },
    [handleSignalMessage, scheduleChatPending]
  );

  // O Room avisa quando o painel de chat abre/fecha: ao abrir, zera o contador.
  const handleChatOpenChange = useCallback((open: boolean) => {
    chatOpenRef.current = open;
    if (open) setChatUnread(0);
  }, []);

  const resetRoom = () => {
    setScreen('home');
    setRoomCode('');
    setMyPeerId('');
    setPeers([]);
    setStreams([]);
    setLocalStream(null);
    setIsSharing(false);
    setError(null);
    setConnecting(false);
    setChatMessages([]);
    setChatUnread(0);
    setRestoredNotice(null);
    setReconnectState('idle');
    setReconnectError(null);
    setReconnectCanRetry(false);
    setStreamResolution('1080');
    streamResolutionRef.current = '1080';
    setResolutionBusy(false);
    resolutionBusyRef.current = false;
    setResolutionNotice(null);
    setMeasuredResolution(null);
    setStreamLimitNotice(null);
    requestedSharersRef.current.clear();

    // Cleanup
    rtcRef.current?.destroy();
    signalRef.current?.disconnect();
    signalRef.current = null;
    rtcRef.current = null;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      rtcRef.current?.destroy();
      signalRef.current?.disconnect();
    };
  }, []);

  // O aviso de limite some sozinho: ele é informativo, não bloqueia a sala.
  useEffect(() => {
    if (!streamLimitNotice) return;
    const timer = window.setTimeout(() => setStreamLimitNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [streamLimitNotice]);

  // ── Mock mode: ?mock na URL ──
  useEffect(() => {
    if (!isMockMode()) return;
    const mock = generateMockData();
    setRoomCode(mock.roomCode);
    setMyPeerId(mock.myPeerId);
    setNickname(mock.nickname);
    setPeers(mock.peers);
    setStreams([]); // Start with no streams — loading state
    setChatMessages(generateMockChatMessages());
    setScreen('room');

    // ?mock&share — simula que você está transmitindo (preview local)
    if (isMockSharing()) {
      setLocalStream(createMockLocalStream());
      setIsSharing(true);
      setPeers(prev => prev.map(p => p.id === mock.myPeerId ? { ...p, isSharing: true } : p));
    }

    // Streams arrive after 5 seconds (simulates WebRTC connection)
    const timer = generateMockStreamsDelayed((readyStreams, peerIds) => {
      setStreams(readyStreams);
      // Flip isSharing on peers whose streams just arrived
      setPeers(prev => prev.map(p => peerIds.includes(p.id) ? { ...p, isSharing: true } : p));
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  // ── Reconexão automática após o F5 ──
  // A sessão (código + apelido) fica no sessionStorage; ao recarregar a
  // página tentamos entrar de novo na mesma sala. O `peerId` muda — isso é
  // esperado nesta etapa. Quem compartilha precisa clicar em "Compartilhar
  // Tela" de novo (o navegador não deixa religar a captura sozinho).
  const beginReconnect = async (session: RoomSession) => {
    reconnectCancelledRef.current = false;
    restoreRef.current = session;
    reconnectSessionRef.current = session;
    reconnectingRef.current = true;
    setReconnectState('connecting');
    setReconnectError(null);
    setReconnectCanRetry(true);
    setRoomCode(session.code);
    setNickname(session.nickname);
    nickRef.current = session.nickname;
    // A sala fica montada por baixo da overlay (a TV não "pisca")
    setScreen('room');

    // Timeout de 6 s: sem `room-joined`, vira estado de falha.
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      if (!reconnectingRef.current) return;
      reconnectingRef.current = false;
      setReconnectState('failed');
      setReconnectCanRetry(true);
      setReconnectError('A sala não respondeu. Ela pode ter sido encerrada ou o servidor caiu.');
    }, RECONNECT_TIMEOUT_MS);

    try {
      const signal = await ensureConnected();
      if (reconnectCancelledRef.current) {
        // Cancelou enquanto conectava: derruba a conexão que acabou de abrir.
        rtcRef.current?.destroy();
        signalRef.current?.disconnect();
        signalRef.current = null;
        rtcRef.current = null;
        return;
      }
      signal.send({ type: 'join-room', code: session.code, nickname: session.nickname });
    } catch {
      if (reconnectCancelledRef.current) return;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectingRef.current = false;
      setReconnectState('failed');
      setReconnectCanRetry(true);
      setReconnectError('Não foi possível conectar ao servidor. Verifique se o servidor está rodando.');
    }
  };

  useEffect(() => {
    if (isMockMode()) return;

    const session = loadRoomSession();
    if (!session) return;

    void beginReconnect(session);

    return () => {
      reconnectCancelledRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Voltar ao início" / "Cancelar": apaga a sessão salva e volta para a Home.
  const handleCancelReconnect = () => {
    reconnectCancelledRef.current = true;
    restoreRef.current = null;
    reconnectSessionRef.current = null;
    reconnectingRef.current = false;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setReconnectState('idle');
    setReconnectError(null);
    setReconnectCanRetry(false);
    clearRoomSession();
    resetRoom();
  };

  // "Tentar de novo": reenvia o join-room e reinicia o timeout de 6 s.
  const handleRetryReconnect = () => {
    const session = reconnectSessionRef.current ?? loadRoomSession();
    if (!session) {
      handleCancelReconnect();
      return;
    }
    void beginReconnect(session);
  };

  const subscribeStats = useCallback((peerId: string, cb: (snapshot: DiagnosticsSnapshot) => void) => {
    return rtcRef.current?.subscribeStats(peerId, cb) ?? (() => {});
  }, []);
  const pushPlayback = useCallback((peerId: string, sample: PlaybackSample) => {
    return rtcRef.current?.pushPlayback(peerId, sample) ?? false;
  }, []);
  const pushAudioPlayback = useCallback((peerId: string, report: AudioPlaybackReport) => {
    return rtcRef.current?.pushAudioPlayback(peerId, report) ?? false;
  }, []);
  const exportDiagnostics = useCallback((peerId: string) => {
    rtcRef.current?.downloadDiagnostics(peerId);
  }, []);
  const subscribeSenderDiagnostics = useCallback((cb: () => void) => {
    return rtcRef.current?.subscribeDiagnostics(cb) ?? (() => {});
  }, []);
  const getSenderSnapshots = useCallback(() => rtcRef.current?.getSenderSnapshots() ?? [], []);
  const exportSenderDiagnostics = useCallback((connectionId: string) => {
    rtcRef.current?.downloadDiagnosticsByConnection(connectionId);
  }, []);

  // ── Render ──
  return (
    <>
      {screen === 'home' && (
        <Home
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          error={error}
          connecting={connecting}
        />
      )}

      {screen === 'room' && (
        <Room
          code={roomCode}
          myPeerId={myPeerId}
          nickname={nickname}
          peers={peers}
          streams={streams}
          localStream={localStream}
          isSharing={isSharing}
          onStartSharing={handleOpenSettings}
          onStopSharing={handleStopSharing}
          onLeaveRoom={handleLeaveRoom}
          subscribeStats={subscribeStats}
          pushPlayback={pushPlayback}
          pushAudioPlayback={pushAudioPlayback}
          audioNotice={audioNotice}
          exportDiagnostics={exportDiagnostics}
          subscribeSenderDiagnostics={subscribeSenderDiagnostics}
          getSenderSnapshots={getSenderSnapshots}
          exportSenderDiagnostics={exportSenderDiagnostics}
          chatMessages={chatMessages}
          onSendChat={handleSendChat}
          onRetryChat={handleRetryChat}
          chatUnread={chatUnread}
          onChatOpenChange={handleChatOpenChange}
          notice={restoredNotice}
          streamResolution={streamResolution}
          measuredResolution={measuredResolution}
          resolutionBusy={resolutionBusy}
          resolutionNotice={resolutionNotice}
          onSelectResolution={handleSelectResolution}
          streamLimitNotice={streamLimitNotice}
          onRequestStream={handleRequestStream}
          onStreamRemoved={handleStreamRemoved}
        />
      )}

      {/* Overlay de reconexão: fica por cima da sala, que já está montada. */}
      {reconnectState !== 'idle' && (
        <Reconnecting
          code={roomCode}
          status={reconnectState === 'failed' ? 'failed' : 'connecting'}
          message={reconnectError}
          onRetry={reconnectCanRetry ? handleRetryReconnect : undefined}
          onCancel={handleCancelReconnect}
        />
      )}

      {showSettings && (
        <StreamSettings
          onStart={handleStartSharing}
          onCancel={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
