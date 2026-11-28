import { useState, useRef, useCallback, useEffect } from 'react';
import { SignalingClient } from './lib/signaling';
import { WebRTCManager, RESOLUTION_MAP } from './lib/webrtc';
import { getSignalingUrl, isTauriDesktop } from './lib/utils';
import {
  detectScreenShareSupport,
  readScreenShareEnvironment,
  captureLimitNotice,
  isScreenShareCancellation,
  SHARE_CANCEL_NOTICE,
} from './lib/screenShare';
import type { AppScreen, ChatMessage, GridMode, PeerInfo, StreamInfo, ServerMessage } from './lib/types';
import { sanitizeChatText, isOwnMessage } from './lib/chat';
import { installAudioUnlock, playSound, setSoundsEnabled } from './lib/sounds';
import { loadSettings, setHideDiscordActivity } from './components/SettingsModal';
import { gridModeForSharers, limitNoticeForMode, loadGridMode, remoteSlotsForMode, saveGridMode } from './lib/grid';
import {
  loadRoomSession,
  saveRoomSession,
  clearRoomSession,
  getClientId,
  type RoomSession,
} from './lib/session';
import Home from './components/Home';
import UpdateNotice from './components/UpdateNotice';
import DesktopUpdateNotice from './components/DesktopUpdateNotice';
import { useVersionCheck } from './hooks/useVersionCheck';
import { useDesktopUpdate } from './hooks/useDesktopUpdate';
import Room from './components/Room';
import Reconnecting from './components/Reconnecting';
import StreamSettings from './components/StreamSettings';
import DesktopSourcePicker from './components/DesktopSourcePicker';
import type { StreamResolution } from './components/ResolutionControl';
import type { StreamFrameRate } from './components/StreamSettings';
import { describeSwitchError, type DisplaySource } from './lib/sourceSwitch';
import type { StreamConfig } from './lib/webrtc';
import { loadProfile } from './lib/profile';
import { buildPresence, discordHideSwitchVisible, pushDiscordPresence, readDiscordRpcStatus } from './lib/discordPresence';
import { desktopRoomUrl, roomCodeFromLocation, roomTargetFromDesktopUrl } from './lib/roomLink';
import { clampWebPreset, webShareNeedsDesktopPrompt, webViewerShouldSuggestDesktop } from './lib/desktopPrompt';
import { DesktopSharePrompt } from './components/DesktopAppPrompt';
import { describeCapture, readTrackSettings } from './lib/diagnostics/index';
import type { AudioPlaybackReport, DiagnosticsSnapshot, PlaybackSample } from './lib/diagnostics/index';
import {
  isMockMode,
  isMockSharing,
  isMockCancelNotice,
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
 * Aviso de "a captura é menor que a resolução pedida" (M10).
 *
 * O aviso usa só o que foi medido na faixa enviada. Sem medição não há o
 * que afirmar (docs/diagnostics.md). Só a janela com altura abaixo do alvo
 * sai pelo canvas. A aba segue nativa; quando a faixa medida já alcança a
 * altura do alvo, o aviso fica vazio.
 */
function readCaptureLimitNotice(
  stream: MediaStream | null,
  resolution: StreamResolution,
): string | null {
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
  const target = RESOLUTION_MAP[resolution];
  if (!target) return null;
  return captureLimitNotice(
    { width: settings.width, height: settings.height },
    target,
    settings.displaySurface,
  );
}

/**
 * Lê a taxa de quadros REAL da captura local.
 *
 * O navegador nem sempre expõe o frameRate da faixa capturada: sem o dado,
 * o valor é null (a UI mostra "n/d"). Nada é estimado (docs/diagnostics.md).
 */
function readMeasuredFrameRate(stream: MediaStream | null): number | null {
  if (!stream) return null;
  const track = stream.getVideoTracks()[0];
  if (!track) return null;
  try {
    const frameRate = track.getSettings().frameRate;
    return typeof frameRate === 'number' && Number.isFinite(frameRate) ? frameRate : null;
  } catch {
    return null;
  }
}

/**
 * Lê a superfície REAL capturada ("browser"/"window"/"monitor").
 *
 * Quem decide é o seletor nativo do navegador; aqui só se registra o que o
 * navegador entregou. Sem o dado, null (a UI mostra "n/d").
 */
function readMeasuredSurface(stream: MediaStream | null): string | null {
  if (!stream) return null;
  const track = stream.getVideoTracks()[0];
  if (!track) return null;
  try {
    const surface = track.getSettings().displaySurface;
    return typeof surface === 'string' ? surface : null;
  } catch {
    return null;
  }
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
  const version = useVersionCheck();
  const desktopUpdate = useDesktopUpdate();
  // ── Estado da aplicação ──
  const [screen, setScreen] = useState<AppScreen>('home');
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // ── Estado da sala ──
  const [roomCode, setRoomCode] = useState('');
  const [roomPrivate, setRoomPrivate] = useState(false);
  const [hideDiscord, setHideDiscord] = useState(() => loadSettings().hideDiscordActivity);
  const [discordConnected, setDiscordConnected] = useState(false);
  const [linkedCode, setLinkedCode] = useState<string | null>(null);
  const [myPeerId, setMyPeerId] = useState('');
  const [nickname, setNickname] = useState('');
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDesktopPrompt, setShowDesktopPrompt] = useState(false);
  const [webQualityLimited, setWebQualityLimited] = useState(false);
  const webQualityLimitedRef = useRef(false);
  const browserLimitAcceptedRef = useRef(false);
  const [showDesktopPicker, setShowDesktopPicker] = useState(false);
  const [desktopPickerMode, setDesktopPickerMode] = useState<'start' | 'switch'>('start');
  const [audioNotice, setAudioNotice] = useState<string | null>(null);
  /**
   * Aviso de cancelamento do seletor nativo (a pessoa fechou o "Escolher o
   * que compartilhar"). Sem ele, quem cancelava ficava sem nenhuma explicação
   * do que tinha acontecido. Some sozinho e some ao tentar de novo.
   *
   * O `id` muda a cada cancelamento: assim o aviso reaparece e o contador de
   * 6 s recomeça quando a pessoa cancela de novo dentro do prazo.
   */
  const [shareCancelNotice, setShareCancelNotice] = useState<{ id: number; text: string } | null>(null);
  const shareCancelIdRef = useRef(0);

  // ── Controles do streamer (troca durante a transmissão) ──
  const [streamResolution, setStreamResolution] = useState<StreamResolution>('1080');
  const [streamFrameRate, setStreamFrameRate] = useState<StreamFrameRate>(30);
  const [streamerBusy, setStreamerBusy] = useState(false);
  const [streamerNotice, setStreamerNotice] = useState<string | null>(null);
  /** Resolução medida na captura (null = o navegador não informa). */
  const [measuredResolution, setMeasuredResolution] = useState<string | null>(null);
  /** Taxa de quadros medida na captura (null = o navegador não informa). */
  const [measuredFrameRate, setMeasuredFrameRate] = useState<number | null>(null);
  /** Superfície capturada ("browser"/"window"/"monitor") ou null. */
  const [measuredSurface, setMeasuredSurface] = useState<string | null>(null);
  /**
   * Aviso de que a captura saiu na resolução nativa, menor que o alvo.
   * Vai para o mesmo espaço do aviso de resolução, com tom informativo.
   */
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);

  // ── Chat da sala ──
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatUnread, setChatUnread] = useState(0);
  /**
   * Identificador estável do navegador (sessionStorage). Ele sobrevive ao F5
   * — o `peerId` do servidor não — e é o que permite reconhecer as próprias
   * mensagens no histórico depois de recarregar a página.
   */
  const [myClientId] = useState<string>(() => getClientId());

  // ── Limite de transmissões simultâneas (vem do modo da grade) ──
  /** Aviso exibido quando o pedido de uma live é barrado pelo limite. */
  const [streamLimitNotice, setStreamLimitNotice] = useState<string | null>(null);
  /**
   * Modo da grade: 1, 2 ou 4 telas. O modo escolhido na sala define
   * quantas lives são assistidas ao mesmo tempo (e fica salvo no browser).
   */
  const [gridMode, setGridMode] = useState<GridMode>(() => loadGridMode());

  // ── Reconexão automática (F5) ──
  const [reconnectState, setReconnectState] = useState<'idle' | 'connecting' | 'failed'>('idle');
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  /** true quando ainda vale a pena oferecer "Tentar de novo". */
  const [reconnectCanRetry, setReconnectCanRetry] = useState(false);
  const [restoredNotice, setRestoredNotice] = useState<string | null>(null);

  // ── Refs para manter instâncias estáveis ──
  const signalRef = useRef<SignalingClient | null>(null);
  const rtcRef = useRef<WebRTCManager | null>(null);
  /**
   * Conexão em andamento. Duas chamadas concorrentes (o StrictMode monta o
   * efeito duas vezes) compartilham a MESMA promessa: sem isso a aba abre
   * dois sockets, entra na sala duas vezes e cada mensagem do servidor
   * chega duplicada.
   */
  const connectPromiseRef = useRef<Promise<SignalingClient> | null>(null);
  /** Código da sala para o qual o join-room já foi enviado (evita entrar 2x). */
  const joinedCodeRef = useRef<string | null>(null);
  /** Senha desta entrada: a sala conta como privada mesmo antes do servidor confirmar. */
  const pendingSecretRef = useRef(false);
  const peersRef = useRef<PeerInfo[]>([]);
  const nickRef = useRef<string>('');
  const myPeerIdRef = useRef('');
  /** clientId estável (sessionStorage) — espelho para os handlers. */
  const myClientIdRef = useRef(myClientId);
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
  /** Espelho da taxa de quadros atual (para reverter a troca em caso de falha). */
  const streamFrameRateRef = useRef<StreamFrameRate>(30);
  /** true enquanto uma troca de resolução está em andamento. */
  const streamerBusyRef = useRef(false);
  /** Peers cujas lives estou recebendo agora (ocupa um slot da grade). */
  const requestedSharersRef = useRef<Set<string>>(new Set());
  /** Peers que o usuário mandou "parar de assistir" (não voltam sozinhos). */
  const unwatchedRef = useRef<Set<string>>(new Set());
  /** Todas as lives simuladas do mock (para poder reassistir). */
  const mockStreamsRef = useRef<StreamInfo[]>([]);
  /** Modo da grade em vigor (o limite de slots vem dele). */
  const gridModeRef = useRef<GridMode>(gridMode);
  /** true enquanto eu transmito: o preview ocupa a primeira célula da grade. */
  const isSharingRef = useRef(false);

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
    myClientIdRef.current = myClientId;
  }, [myClientId]);
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);
  useEffect(() => {
    streamResolutionRef.current = streamResolution;
  }, [streamResolution]);
  useEffect(() => {
    streamFrameRateRef.current = streamFrameRate;
  }, [streamFrameRate]);
  useEffect(() => {
    gridModeRef.current = gridMode;
    saveGridMode(gridMode);
  }, [gridMode]);

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

  /**
   * A grade acompanha quantos outros estão transmitindo (1, 2 ou 4). O ref
   * muda antes do pedido da live, para o limite do modo antigo não barrá-la.
   */
  const applyGridForSharers = useCallback((list: PeerInfo[], selfId: string) => {
    // Quem transmite ocupa uma célula com o próprio preview.
    const count = list.filter(p => p.isSharing && p.id !== selfId).length + (isSharingRef.current ? 1 : 0);
    if (count === 0) return;
    const mode = gridModeForSharers(count);
    gridModeRef.current = mode;
    setGridMode(mode);
  }, []);

  // Começar ou parar de transmitir muda as células: o preview entra ou sai da grade.
  useEffect(() => {
    if (isSharingRef.current === isSharing) return;
    isSharingRef.current = isSharing;
    applyGridForSharers(peersRef.current, myPeerIdRef.current);
  }, [isSharing, applyGridForSharers]);

  // ── Grade: pedir a live de um peer (até o limite do modo da grade) ──
  const handleRequestStream = useCallback((peerId: string) => {
    const requested = requestedSharersRef.current;
    if (requested.has(peerId)) return;
    const limit = remoteSlotsForMode(gridModeRef.current, isSharingRef.current);
    if (requested.size >= limit) {
      // Sem slot: o peer continua na sidebar e o aviso explica o motivo.
      setStreamLimitNotice(limitNoticeForMode(gridModeRef.current));
      return;
    }
    requested.add(peerId);
    // Pedido explícito: o usuário quer assistir de novo.
    unwatchedRef.current.delete(peerId);
    setStreamLimitNotice(null);
    if (isMockMode()) {
      // No mock não existe servidor: a live simulada volta direto.
      const mock = mockStreamsRef.current.find(s => s.peerId === peerId);
      if (mock) {
        setStreams(prev => (prev.some(s => s.peerId === peerId) ? prev : [...prev, mock]));
      }
      return;
    }
    rtcRef.current?.requestStream(peerId);
  }, []);

  /** "Parar de assistir": para de receber a live e libera o slot da grade. */
  const handleStreamRemoved = useCallback((peerId: string) => {
    requestedSharersRef.current.delete(peerId);
    // O tile some da grade de vez: o App deixa de ter a stream.
    unwatchedRef.current.add(peerId);
    setStreams(prev => prev.filter(s => s.peerId !== peerId));
    rtcRef.current?.stopReceiving(peerId);
    setStreamLimitNotice(null);
  }, []);

  // ── Handler de mensagens do servidor ──
  const handleSignalMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'room-created': {
        const selfPeer: PeerInfo = { id: msg.peerId, nickname: nickRef.current, isSharing: false, isDesktop: isTauriDesktop() };
        setRoomCode(msg.code);
        setRoomPrivate(Boolean(msg.isPrivate || msg.hasPassword || pendingSecretRef.current));
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
        const selfJoined: PeerInfo = { id: msg.peerId, nickname: nickRef.current, isSharing: false, isDesktop: isTauriDesktop() };
        joinedCodeRef.current = msg.code;
        const peersWithSelf = msg.peers.some((p: PeerInfo) => p.id === msg.peerId)
          ? msg.peers
          : [...msg.peers, selfJoined];
        setRoomCode(msg.code);
        setRoomPrivate(Boolean(msg.isPrivate || pendingSecretRef.current));
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
        applyGridForSharers(msg.peers, msg.peerId);
        for (const peer of msg.peers) {
          // Quem o usuário mandou "parar de assistir" não volta sozinho.
          if (peer.isSharing && !unwatchedRef.current.has(peer.id)) {
            handleRequestStream(peer.id);
          }
        }
        break;
      }

      case 'peer-joined':
        peersRef.current = [...peersRef.current, msg.peer];
        setPeers(prev => [...prev, msg.peer]);
        playSound('peer-joined');
        break;

      case 'peer-left':
        peersRef.current = peersRef.current.filter(p => p.id !== msg.peerId);
        applyGridForSharers(peersRef.current, myPeerIdRef.current);
        setPeers(prev => prev.filter(p => p.id !== msg.peerId));
        setStreams(prev => prev.filter(s => s.peerId !== msg.peerId));
        requestedSharersRef.current.delete(msg.peerId);
        unwatchedRef.current.delete(msg.peerId);
        playSound('peer-left');
        break;

      case 'sharing-started':
        peersRef.current = peersRef.current.map(p => p.id === msg.peerId ? { ...p, isSharing: true } : p);
        applyGridForSharers(peersRef.current, myPeerIdRef.current);
        setPeers(prev =>
          prev.map(p => p.id === msg.peerId ? { ...p, isSharing: true } : p)
        );
        // Solicita o stream automaticamente (se houver slot livre na grade e o
        // usuário não tiver parado de assistir antes).
        if (!unwatchedRef.current.has(msg.peerId)) {
          handleRequestStream(msg.peerId);
        }
        playSound('stream-started');
        break;

      case 'sharing-stopped':
        peersRef.current = peersRef.current.map(p => p.id === msg.peerId ? { ...p, isSharing: false } : p);
        applyGridForSharers(peersRef.current, myPeerIdRef.current);
        setPeers(prev =>
          prev.map(p => p.id === msg.peerId ? { ...p, isSharing: false } : p)
        );
        setStreams(prev => prev.filter(s => s.peerId !== msg.peerId));
        requestedSharersRef.current.delete(msg.peerId);
        unwatchedRef.current.delete(msg.peerId);
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
          clientId: msg.clientId,
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
        // A identidade usa o clientId: depois do F5 o peerId mudou, mas o
        // clientId continua o mesmo.
        const isMine = isOwnMessage(entry, {
          clientId: myClientIdRef.current,
          peerId: myPeerIdRef.current,
          nickname: nickRef.current,
        });
        if (!chatOpenRef.current && !isMine) {
          setChatUnread((count) => count + 1);
        }
        // O som da mensagem de OUTREM toca mesmo com o chat aberto e em foco
        // (decisão do Cleber): em volume baixo. A própria nunca toca.
        if (!isMine) {
          playSound('message');
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
          joinedCodeRef.current = null;
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

      case 'peer-telemetry':
      case 'relay-plan':
        break;
    }
  }, []);

  // ── Conexão e setup ──
  const ensureConnected = async (): Promise<SignalingClient> => {
    if (signalRef.current?.connected) {
      return signalRef.current;
    }

    // Já tem uma conexão subindo: espera a mesma promessa (um socket só).
    if (connectPromiseRef.current) {
      return connectPromiseRef.current;
    }

    const pending = (async (): Promise<SignalingClient> => {
      const signal = new SignalingClient(getSignalingUrl());

      // Setup WebRTC manager
      const rtc = new WebRTCManager(signal, handleNewStream, handleStreamEnd);
      rtc.startListening();

      // Listen to signaling messages for room management
      signal.onMessage(handleSignalMessage);

      await signal.connect();

      // A conexão pode ter sido derrubada enquanto conectava (ex.: resetRoom):
      // nesse caso ela não vale mais.
      if (!signal.connected) {
        rtc.destroy();
        signal.disconnect();
        throw new Error('conexão encerrada antes de ficar pronta');
      }

      signalRef.current = signal;
      rtcRef.current = rtc;

      return signal;
    })();

    connectPromiseRef.current = pending;
    try {
      return await pending;
    } finally {
      if (connectPromiseRef.current === pending) connectPromiseRef.current = null;
    }
  };

  // ── Ações ──
  const handleCreateRoom = async (nick: string, password?: string) => {
    setError(null);
    setConnecting(true);
    setNickname(nick);
    pendingSecretRef.current = Boolean(password);

    try {
      const signal = await ensureConnected();
      signal.send({ type: 'create-room', nickname: nick, password, isDesktop: isTauriDesktop() });
    } catch (err) {
      setError('Não foi possível conectar ao servidor. Verifique se o servidor está rodando.');
      setConnecting(false);
    }
  };

  const handleJoinRoom = async (code: string, nick: string, password?: string, ticket?: string | null) => {
    setError(null);
    setConnecting(true);
    setNickname(nick);
    nickRef.current = nick;
    pendingSecretRef.current = Boolean(password);

    try {
      const signal = await ensureConnected();
      signal.send({
        type: 'join-room',
        code,
        nickname: nick,
        password,
        isDesktop: isTauriDesktop(),
        ...(ticket ? { ticket } : {}),
      });
    } catch (err) {
      setError('Não foi possível conectar ao servidor. Verifique se o servidor está rodando.');
      setConnecting(false);
    }
  };

  const handleOpenSettings = () => {
    setShareCancelNotice(null);
    if (isTauriDesktop()) {
      setError(null);
      setDesktopPickerMode('start');
      setShowDesktopPicker(true);
      return;
    }
    const support = detectScreenShareSupport(readScreenShareEnvironment());
    if (!support.supported) {
      setError(support.message);
      return;
    }
    setError(null);
    if (webShareNeedsDesktopPrompt({
      isDesktopApp: false,
      peers: peersRef.current,
      myPeerId: myPeerIdRef.current,
    })) {
      setShowDesktopPrompt(true);
      return;
    }
    setShowSettings(true);
  };

  const handleContinueInBrowser = () => {
    browserLimitAcceptedRef.current = true;
    webQualityLimitedRef.current = true;
    setWebQualityLimited(true);
    setShowDesktopPrompt(false);
    setShowSettings(true);
  };

  /**
   * Liga o `onended` da faixa de vídeo local: quando a pessoa encerra a
   * captura pelo navegador, a sala volta ao estado sem transmissão.
   *
   * Serve tanto para a captura inicial quanto para a troca de fonte: nos dois
   * casos a faixa nova precisa derrubar a sala quando o navegador a mata.
   */
  const attachLocalTrackHandlers = useCallback((stream: MediaStream) => {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
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
  }, [myPeerId, nickname, roomCode]);

  const handleStartSharing = async (config?: StreamConfig, prepared?: MediaStream) => {
    setShowSettings(false);
    setShowDesktopPicker(false);
    const capped = config
      ? clampWebPreset(config.resolution, config.frameRate, webQualityLimitedRef.current)
      : null;
    const shareConfig = config && capped
      ? { ...config, resolution: capped.resolution, frameRate: capped.frameRate }
      : config;
    try {
      const rtc = rtcRef.current;
      if (!rtc) {
        prepared?.getTracks().forEach((track) => track.stop());
        return;
      }
      const stream = await rtc.startScreenShare(shareConfig, prepared);
      if (stream) {
        setLocalStream(stream);
        setIsSharing(true);
        setAudioNotice(rtc.getAudioNotice() ?? null);
        // Transmitindo: nenhum aviso de cancelamento na tela.
        setShareCancelNotice(null);
        // A resolução inicial é a escolhida no StreamSettings.
        setStreamResolution(shareConfig?.resolution ?? '1080');
        streamResolutionRef.current = shareConfig?.resolution ?? '1080';
        setStreamFrameRate(shareConfig?.frameRate ?? 30);
        streamFrameRateRef.current = shareConfig?.frameRate ?? 30;
        setStreamerNotice(null);

        // Atualiza o próprio peer na lista
        setPeers(prev => prev.map(p => p.id === myPeerId ? { ...p, isSharing: true } : p));
        if (roomCode) {
          saveRoomSession({ code: roomCode, nickname, wasSharing: true, savedAt: Date.now() });
        }

        attachLocalTrackHandlers(stream);
      }
    } catch (err: any) {
      prepared?.getTracks().forEach((track) => track.stop());
      // Usuário cancelou o dialog de compartilhamento
      if (err?.name === 'ScreenShareUnsupportedError') {
        setError(err.message);
      } else if (isScreenShareCancellation(err)) {
        // O seletor nativo foi fechado sem escolher nada: nenhum vídeo foi
        // capturado e nada foi transmitido. O aviso diz isso explicitamente.
        shareCancelIdRef.current += 1;
        setShareCancelNotice({ id: shareCancelIdRef.current, text: SHARE_CANCEL_NOTICE });
      } else {
        setError('Erro ao compartilhar tela: ' + err.message);
      }
    }
  };

  const handleStopSharing = () => {
    rtcRef.current?.stopScreenShare();
    setLocalStream(null);
    setIsSharing(false);
    setAudioNotice(null);
    setShareCancelNotice(null);
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

  // ── Medição da live ──
  // A medição vem da própria captura: o navegador nem sempre expõe a faixa
  // capturada, e nesse caso o valor é null (a UI mostra "n/d").
  useEffect(() => {
    if (!isSharing || !localStream) {
      setMeasuredResolution(null);
      setMeasuredFrameRate(null);
      setMeasuredSurface(null);
      setCaptureNotice(null);
      return;
    }
    const read = () => {
      setMeasuredResolution(readMeasuredResolution(localStream));
      setMeasuredFrameRate(readMeasuredFrameRate(localStream));
      setMeasuredSurface(readMeasuredSurface(localStream));
      setCaptureNotice(readCaptureLimitNotice(localStream, streamResolution));
    };
    read();
    const timer = window.setInterval(read, 1000);
    return () => window.clearInterval(timer);
  }, [isSharing, localStream, streamResolution]);

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
    if (streamerBusyRef.current) return;
    if (webQualityLimitedRef.current && (next === '1080' || next === '2160')) return;
    if (next === streamResolutionRef.current) return;

    const previous = streamResolutionRef.current;
    streamerBusyRef.current = true;
    setStreamerBusy(true);
    setStreamerNotice(null);

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
        setStreamerNotice(null);
      } else {
        streamResolutionRef.current = previous;
        setStreamResolution(previous);
        setStreamerNotice('Não foi possível mudar a resolução. A transmissão continua como estava.');
      }
    } catch {
      streamResolutionRef.current = previous;
      setStreamResolution(previous);
      setStreamerNotice('Não foi possível mudar a resolução. A transmissão continua como estava.');
    } finally {
      streamerBusyRef.current = false;
      setStreamerBusy(false);
      // A captura pode ter mudado de tamanho: relê a medição.
      setMeasuredResolution(readMeasuredResolution(localStream));
    }
  }, [localStream]);

  /**
   * Troca a taxa de quadros durante a live.
   *
   * Mesmo núcleo da resolução: `setParameters` em cada conexão de papel
   * `sender` (maxFramerate/degradationPreference). Se NENHUMA conexão aceitar,
   * o valor anterior continua valendo — a transmissão não cai.
   */
  const handleSelectFrameRate = useCallback(async (next: StreamFrameRate) => {
    if (streamerBusyRef.current) return;
    if (webQualityLimitedRef.current && next > 30) return;
    if (next === streamFrameRateRef.current) return;

    const previous = streamFrameRateRef.current;
    streamerBusyRef.current = true;
    setStreamerBusy(true);
    setStreamerNotice(null);

    const startedAt = Date.now();
    try {
      const rtc = rtcRef.current;
      // Sem WebRTC real (modo ?mock) não existe encoder para reconfigurar:
      // a seleção vale para a UI da simulação.
      const applied = rtc ? await rtc.setStreamFrameRate(next) : true;

      const elapsed = Date.now() - startedAt;
      if (elapsed < RESOLUTION_BUSY_MIN_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, RESOLUTION_BUSY_MIN_MS - elapsed));
      }

      if (applied) {
        streamFrameRateRef.current = next;
        setStreamFrameRate(next);
        setStreamerNotice(null);
      } else {
        streamFrameRateRef.current = previous;
        setStreamFrameRate(previous);
        setStreamerNotice('Não foi possível mudar a taxa de quadros. A transmissão continua como estava.');
      }
    } catch {
      streamFrameRateRef.current = previous;
      setStreamFrameRate(previous);
      setStreamerNotice('Não foi possível mudar a taxa de quadros. A transmissão continua como estava.');
    } finally {
      streamerBusyRef.current = false;
      setStreamerBusy(false);
      setMeasuredFrameRate(readMeasuredFrameRate(localStream));
    }
  }, [localStream]);

  useEffect(() => {
    if (isTauriDesktop()) {
      browserLimitAcceptedRef.current = false;
      webQualityLimitedRef.current = false;
      setWebQualityLimited(false);
      setShowDesktopPrompt(false);
      return;
    }
    const needsLimit = browserLimitAcceptedRef.current && webShareNeedsDesktopPrompt({
      isDesktopApp: false,
      peers,
      myPeerId,
    });
    webQualityLimitedRef.current = needsLimit;
    setWebQualityLimited(needsLimit);
    if (!webShareNeedsDesktopPrompt({ isDesktopApp: false, peers, myPeerId })) {
      setShowDesktopPrompt(false);
    }
    if (!needsLimit || !isSharing) return;
    if (streamResolutionRef.current === '1080' || streamResolutionRef.current === '2160') {
      void handleSelectResolution('720');
    }
    if (streamFrameRateRef.current > 30) {
      void handleSelectFrameRate(30);
    }
  }, [peers, myPeerId, isSharing, handleSelectResolution, handleSelectFrameRate]);

  /**
   * Troca a fonte capturada (aba, janela ou tela) durante a live.
   *
   * O seletor nativo é quem decide o que capturar: a escolha aqui é só uma
   * dica. A troca acontece por `replaceTrack` nos senders, sem renegociar —
   * os espectadores veem a nova fonte sem cair. Quando a troca não
   * acontece, a fonte atual continua valendo e o motivo real aparece na
   * faixa âmbar da barra.
   */
  const handleSwitchSource = useCallback(async (source: DisplaySource) => {
    if (isTauriDesktop()) {
      setDesktopPickerMode('switch');
      setShowDesktopPicker(true);
      return;
    }
    if (streamerBusyRef.current) return;

    streamerBusyRef.current = true;
    setStreamerBusy(true);
    setStreamerNotice(null);

    try {
      const rtc = rtcRef.current;
      if (!rtc) {
        // Sem WebRTC real (modo ?mock) não há captura para trocar.
        setStreamerNotice('A troca de fonte precisa de uma transmissão real.');
        return;
      }
      const result = await rtc.switchSource(source);
      if (result.ok && result.stream) {
        setLocalStream(result.stream);
        setStreamerNotice(result.reason);
        setAudioNotice(rtc.getAudioNotice());
        attachLocalTrackHandlers(result.stream);
        setMeasuredSurface(result.surface);
      } else {
        setStreamerNotice(result.reason ?? 'Não foi possível trocar a fonte. A fonte atual continua valendo.');
      }
    } catch (err) {
      setStreamerNotice(describeSwitchError(err));
    } finally {
      streamerBusyRef.current = false;
      setStreamerBusy(false);
      setMeasuredResolution(readMeasuredResolution(localStream));
      setMeasuredFrameRate(readMeasuredFrameRate(localStream));
    }
  }, [localStream]);

  const handleDesktopConfirm = (stream: MediaStream, config: StreamConfig) => {
    setShowDesktopPicker(false);
    if (desktopPickerMode !== 'switch') {
      void handleStartSharing(config, stream);
      return;
    }
    if (streamerBusyRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamerBusyRef.current = true;
    setStreamerBusy(true);
    setStreamerNotice(null);
    void (async () => {
      try {
        const rtc = rtcRef.current;
        if (!rtc) {
          stream.getTracks().forEach((track) => track.stop());
          setStreamerNotice('A troca de fonte precisa de uma transmissão real.');
          return;
        }
        const result = await rtc.switchScreenShare(stream, config);
        if (result.ok && result.stream) {
          setLocalStream(result.stream);
          setStreamResolution(config.resolution);
          setStreamFrameRate(config.frameRate);
          setStreamerNotice(result.reason);
          setAudioNotice(rtc.getAudioNotice());
          attachLocalTrackHandlers(result.stream);
          setMeasuredSurface(result.surface);
        } else {
          setStreamerNotice(result.reason ?? 'Não foi possível trocar a fonte. A fonte atual continua valendo.');
        }
      } catch (err) {
        stream.getTracks().forEach((track) => track.stop());
        setStreamerNotice(describeSwitchError(err));
      } finally {
        streamerBusyRef.current = false;
        setStreamerBusy(false);
        setMeasuredResolution(readMeasuredResolution(localStream));
        setMeasuredFrameRate(readMeasuredFrameRate(localStream));
      }
    })();
  };

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
        clientId: myClientIdRef.current,
        pending: true,
      };
      setChatMessages((prev) => appendChat(prev, entry));
      if (signalRef.current) {
        signalRef.current.send({
          type: 'chat-message',
          text: clean,
          clientId: myClientIdRef.current,
        });
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
        clientId: myClientIdRef.current,
        pending: true,
      };
      setChatMessages((prev) => {
        const without = prev.filter((m) => m.id !== message.id);
        return appendChat(without, entry);
      });
      if (signalRef.current) {
        signalRef.current.send({
          type: 'chat-message',
          text: clean,
          clientId: myClientIdRef.current,
        });
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
    setRoomPrivate(false);
    pendingSecretRef.current = false;
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
    setStreamFrameRate(30);
    streamFrameRateRef.current = 30;
    setStreamerBusy(false);
    streamerBusyRef.current = false;
    setStreamerNotice(null);
    setMeasuredResolution(null);
    setMeasuredFrameRate(null);
    setMeasuredSurface(null);
    setCaptureNotice(null);
    setStreamLimitNotice(null);
    setShareCancelNotice(null);
    setShowDesktopPrompt(false);
    setWebQualityLimited(false);
    webQualityLimitedRef.current = false;
    browserLimitAcceptedRef.current = false;
    requestedSharersRef.current.clear();
    unwatchedRef.current.clear();

    // Cleanup
    rtcRef.current?.destroy();
    signalRef.current?.disconnect();
    signalRef.current = null;
    rtcRef.current = null;
    connectPromiseRef.current = null;
    joinedCodeRef.current = null;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      rtcRef.current?.destroy();
      signalRef.current?.disconnect();
    };
  }, []);

  // O browser só deixa tocar áudio depois de um gesto do usuário: o primeiro
  // clique/tecla da página libera os sons de evento. A preferência salva em
  // Configurações (M11) decide se eles tocam: desligado é desligado desde já.
  useEffect(() => {
    installAudioUnlock();
    setSoundsEnabled(loadSettings().eventSounds);
  }, []);

  // O aviso de limite some sozinho: ele é informativo, não bloqueia a sala.
  useEffect(() => {
    if (!streamLimitNotice) return;
    const timer = window.setTimeout(() => setStreamLimitNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [streamLimitNotice]);

  // O aviso de cancelamento some sozinho (6 s). Cancelar de novo reinicia o
  // tempo, porque o `id` do aviso muda a cada cancelamento.
  useEffect(() => {
    if (!shareCancelNotice) return;
    // No preview (?mock&cancel) o aviso fica na tela para revisão visual.
    if (isMockCancelNotice()) return;
    const timer = window.setTimeout(() => setShareCancelNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [shareCancelNotice]);

  // Aviso da sala (ex.: sessão restaurada) some sozinho.
  useEffect(() => {
    if (!restoredNotice) return;
    const timer = window.setTimeout(() => setRestoredNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [restoredNotice]);

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

    // ?mock&cancel — mostra o aviso de cancelamento (o seletor nativo não
    // existe no mock; a flag existe para o preview visual do aviso).
    if (isMockCancelNotice()) {
      shareCancelIdRef.current += 1;
      setShareCancelNotice({ id: shareCancelIdRef.current, text: SHARE_CANCEL_NOTICE });
    }

    // Streams arrive after 5 seconds (simulates WebRTC connection)
    const timer = generateMockStreamsDelayed((readyStreams, peerIds) => {
      // Todas as lives do mock ficam guardadas: dá para reassistir ("Assistir")
      // depois de "Parar de assistir".
      mockStreamsRef.current = readyStreams;
      if (readyStreams.length > 0) {
        const mode = gridModeForSharers(readyStreams.length + (isSharingRef.current ? 1 : 0));
        gridModeRef.current = mode;
        setGridMode(mode);
      }
      // A grade do mock respeita o limite do modo: só as lives que cabem são
      // assistidas — as outras ficam na lista lateral ("fora da grade").
      const limit = remoteSlotsForMode(gridModeRef.current, isSharingRef.current);
      const visible = readyStreams.slice(0, limit);
      requestedSharersRef.current = new Set(visible.map(s => s.peerId));
      setStreams(visible);
      // Flip isSharing on peers whose streams just arrived
      setPeers(prev => prev.map(p => peerIds.includes(p.id) ? { ...p, isSharing: true } : p));
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  // ── Mock: trocar o modo da grade reassiste as lives simuladas ──
  useEffect(() => {
    if (!isMockMode()) return;
    const mock = mockStreamsRef.current;
    if (mock.length === 0) return;
    const limit = remoteSlotsForMode(gridMode, isSharingRef.current);
    // Mantém quem já estava sendo assistido e completa com os demais —
    // sem ressuscitar quem o usuário mandou "parar de assistir".
    const next = mock.filter(s => requestedSharersRef.current.has(s.peerId)).slice(0, limit);
    for (const s of mock) {
      if (next.length >= limit) break;
      if (next.some(x => x.peerId === s.peerId)) continue;
      if (unwatchedRef.current.has(s.peerId)) continue;
      next.push(s);
    }
    requestedSharersRef.current = new Set(next.map(s => s.peerId));
    setStreams(next);
  }, [gridMode]);

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
      // O join-room não foi confirmado: libera para o "Tentar de novo".
      joinedCodeRef.current = null;
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
      // Só entra na sala uma vez por código: o StrictMode monta o efeito de
      // reconexão duas vezes e, sem esta trava, o peer pisca na lista da sala
      // (o servidor remove e reinsere o mesmo peer).
      if (joinedCodeRef.current !== session.code) {
        joinedCodeRef.current = session.code;
        signal.send({ type: 'join-room', code: session.code, nickname: session.nickname, isDesktop: isTauriDesktop() });
      }
    } catch {
      if (reconnectCancelledRef.current) return;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      joinedCodeRef.current = null;
      reconnectingRef.current = false;
      setReconnectState('failed');
      setReconnectCanRetry(true);
      setReconnectError('Não foi possível conectar ao servidor. Verifique se o servidor está rodando.');
    }
  };

  useEffect(() => {
    if (isMockMode()) return;

    const link = roomCodeFromLocation(window.location.pathname, window.location.search);
    if (link) {
      setLinkedCode(link.code);
      if (link.ticket) {
        const url = new URL(window.location.href);
        url.searchParams.delete('ticket');
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
      if (link.openApp && !isTauriDesktop()) {
        window.location.assign(desktopRoomUrl(link.code, link.ticket));
      }
      const nick = loadProfile()?.nickname?.trim();
      if (nick) {
        pendingSecretRef.current = false;
        void handleJoinRoom(link.code, nick, undefined, link.ticket);
      }
      return;
    }

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

  const joinLinkRef = useRef<(code: string, ticket?: string | null) => void>(() => {});
  const lastDesktopJoin = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  joinLinkRef.current = (code: string, ticket?: string | null) => {
    const key = `${code}:${ticket ?? ''}`;
    const now = Date.now();
    if (lastDesktopJoin.current.key === key && now - lastDesktopJoin.current.at < 2000) return;
    lastDesktopJoin.current = { key, at: now };
    const nick = nickRef.current.trim() || loadProfile()?.nickname?.trim() || 'Anônimo';
    pendingSecretRef.current = false;
    void handleJoinRoom(code, nick, undefined, ticket);
  };

  const joinDesktopUrls = (urls: string[]) => {
    for (const url of urls) {
      const target = roomTargetFromDesktopUrl(url);
      if (target) joinLinkRef.current(target.code, target.ticket);
    }
  };

  useEffect(() => {
    if (!isTauriDesktop()) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void readDiscordRpcStatus().then((connected) => {
        if (!cancelled) setDiscordConnected(connected);
      });
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    let cancelled = false;
    const stops: Array<() => void> = [];
    const stopAll = () => {
      for (const stop of stops.splice(0)) stop();
    };
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      if (cancelled) return;
      stops.push(await listen<{ code: string; ticket?: string | null }>('telinha-join', (event) => {
        if (event.payload?.code) joinLinkRef.current(event.payload.code, event.payload.ticket);
      }));
      if (cancelled) {
        stopAll();
        return;
      }
      try {
        const pending = await invoke<{ code: string; ticket?: string | null } | null>('take_pending_join');
        if (!cancelled && pending?.code) joinLinkRef.current(pending.code, pending.ticket);
      } catch {
        // O site não tem o comando.
      }
      try {
        const deepLink = await import('@tauri-apps/plugin-deep-link');
        if (cancelled) {
          stopAll();
          return;
        }
        const current = await deepLink.getCurrent();
        if (!cancelled && current?.length) joinDesktopUrls(current);
        stops.push(await deepLink.onOpenUrl((urls) => {
          if (!cancelled) joinDesktopUrls(urls);
        }));
        if (cancelled) stopAll();
      } catch {
        // Plugin ausente no site.
      }
    })();
    return () => {
      cancelled = true;
      stopAll();
    };
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    let cancelled = false;
    void pushDiscordPresence(buildPresence({
      inRoom: screen === 'room' && roomCode.length > 0,
      roomCode,
      roomPrivate,
      hideActivity: hideDiscord,
      isStreaming: isSharing,
      viewerCount: peers.length,
    })).then((connected) => {
      if (!cancelled) setDiscordConnected(connected);
    });
    return () => {
      cancelled = true;
    };
  }, [screen, roomCode, roomPrivate, hideDiscord, isSharing, peers.length]);

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
      {!desktopUpdate.active && version.hasUpdate && (
        <UpdateNotice onUpdate={version.reload} onDismiss={version.dismiss} />
      )}
      {desktopUpdate.update && (
        <DesktopUpdateNotice
          version={desktopUpdate.update.version}
          installing={desktopUpdate.installing}
          progress={desktopUpdate.progress}
          error={desktopUpdate.error}
          onUpdate={desktopUpdate.install}
        />
      )}

      {screen === 'home' && (
        <Home
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          error={error}
          connecting={connecting}
          initialCode={linkedCode ?? undefined}
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
          myClientId={myClientId}
          onSendChat={handleSendChat}
          onRetryChat={handleRetryChat}
          chatUnread={chatUnread}
          onChatOpenChange={handleChatOpenChange}
          notice={restoredNotice}
          streamResolution={streamResolution}
          measuredResolution={measuredResolution}
          streamFrameRate={streamFrameRate}
          measuredFrameRate={measuredFrameRate}
          measuredSurface={measuredSurface}
          streamerBusy={streamerBusy}
          streamerNotice={streamerNotice ?? captureNotice}
          streamerNoticeInformative={!streamerNotice && Boolean(captureNotice)}
          onSelectResolution={handleSelectResolution}
          onSelectFrameRate={handleSelectFrameRate}
          onSwitchSource={handleSwitchSource}
          streamLimitNotice={streamLimitNotice}
          shareCancelNotice={shareCancelNotice?.text ?? null}
          gridMode={gridMode}
          onRequestStream={handleRequestStream}
          onStreamRemoved={handleStreamRemoved}
          showDesktopCta={!isTauriDesktop()}
          showDesktopStabilityHint={webViewerShouldSuggestDesktop({
            isDesktopApp: isTauriDesktop(),
            isSharing,
            peers,
          })}
          qualityLimited={webQualityLimited}
          hideDiscordActivity={hideDiscord}
          discordConnected={discordHideSwitchVisible(isTauriDesktop(), discordConnected)}
          onHideDiscordActivity={(hidden) => {
            setHideDiscordActivity(hidden);
            setHideDiscord(hidden);
          }}
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

      {showDesktopPrompt && (
        <DesktopSharePrompt onContinue={handleContinueInBrowser} />
      )}

      {showSettings && (
        <StreamSettings
          onStart={handleStartSharing}
          onCancel={() => setShowSettings(false)}
          qualityLimited={webQualityLimited}
        />
      )}
      {showDesktopPicker && (
        <DesktopSourcePicker
          onCancel={() => {
            setShowDesktopPicker(false);
            if (desktopPickerMode === 'start') {
              shareCancelIdRef.current += 1;
              setShareCancelNotice({ id: shareCancelIdRef.current, text: SHARE_CANCEL_NOTICE });
            }
          }}
          onConfirm={handleDesktopConfirm}
        />
      )}
    </>
  );
}
