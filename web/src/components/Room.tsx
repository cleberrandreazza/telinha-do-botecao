import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ChatMessage, GridMode, PeerInfo, StreamInfo } from '../lib/types';
import { getInitials, colorFromString } from '../lib/profile';
import { detectScreenShareSupport, readScreenShareEnvironment } from '../lib/screenShare';
import CrtEmptyState from './CrtEmptyState';
import LocalPreview from './LocalPreview';
import StreamViewer from './StreamViewer';
import StreamTile from './StreamTile';
import StatsPanel from './StatsPanel';
import ChatPanel from './ChatPanel';
import type { StreamResolution } from './ResolutionControl';
import StreamerBar from './StreamerBar';
import type { StreamFrameRate } from './StreamSettings';
import type { DisplaySource } from '../lib/sourceSwitch';
import SettingsModal, { loadSettings, type BotecaoSettings } from './SettingsModal';
import BotecaoIcon from './BotecaoIcon';
import { SHARE_SLOTS_FULL_NOTICE, areShareSlotsFull, gridClassForMode, gridFullLabel, limitNoticeForMode, maxStreamsForMode, remoteSlotsForMode } from '../lib/grid';
import type { AudioPlaybackReport, DiagnosticsSnapshot, PlaybackSample } from '../lib/diagnostics/index';

interface RoomProps {
  code: string;
  myPeerId: string;
  nickname: string;
  peers: PeerInfo[];
  streams: StreamInfo[];
  localStream: MediaStream | null;
  isSharing: boolean;
  onStartSharing: () => void;
  onStopSharing: () => void;
  onLeaveRoom: () => void;
  subscribeStats?: (peerId: string, cb: (snapshot: DiagnosticsSnapshot) => void) => () => void;
  pushPlayback?: (peerId: string, sample: PlaybackSample) => boolean;
  pushAudioPlayback?: (peerId: string, report: AudioPlaybackReport) => boolean;
  audioNotice?: string | null;
  exportDiagnostics?: (peerId: string) => void;
  subscribeSenderDiagnostics?: (cb: () => void) => () => void;
  getSenderSnapshots?: () => DiagnosticsSnapshot[];
  exportSenderDiagnostics?: (connectionId: string) => void;
  /** Mensagens do chat da sala. */
  chatMessages?: ChatMessage[];
  /** Identificador estável do cliente (sobrevive ao F5). */
  myClientId?: string;
  /** Envia uma mensagem no chat da sala. */
  onSendChat?: (text: string) => void;
  /** Reenvia uma mensagem que ficou sem o eco do servidor. */
  onRetryChat?: (message: ChatMessage) => void;
  /** Quantidade de mensagens recebidas com o chat fechado. */
  chatUnread?: number;
  /** Avisa o App que o painel de chat abriu/fechou (para o contador). */
  onChatOpenChange?: (open: boolean) => void;
  /** Aviso temporário exibido sobre a sala (ex.: sessão restaurada). */
  notice?: string | null;
  /** Resolução selecionada da live (quem transmite). */
  streamResolution?: StreamResolution;
  /** Resolução medida na captura (null = o navegador não informa). */
  measuredResolution?: string | null;
  /** Taxa de quadros selecionada da live. */
  streamFrameRate?: StreamFrameRate;
  /** Taxa de quadros medida na captura (null = o navegador não informa). */
  measuredFrameRate?: number | null;
  /** Superfície capturada ("browser"/"window"/"monitor") ou null. */
  measuredSurface?: string | null;
  /** true enquanto uma mudança da barra do streamer está sendo aplicada. */
  streamerBusy?: boolean;
  /** Aviso curto de falha na troca (fonte, resolução ou quadros). */
  streamerNotice?: string | null;
  /** O aviso explica a resolução nativa da captura; não é uma falha. */
  streamerNoticeInformative?: boolean;
  /** Troca a resolução da live durante a transmissão. */
  onSelectResolution?: (resolution: StreamResolution) => void;
  /** Troca a taxa de quadros da live durante a transmissão. */
  onSelectFrameRate?: (frameRate: StreamFrameRate) => void;
  /** Troca a fonte capturada (aba, janela ou tela). */
  onSwitchSource?: (source: DisplaySource) => void;
  /** Aviso de limite de transmissões simultâneas. */
  streamLimitNotice?: string | null;
  /** Aviso de cancelamento do seletor nativo de compartilhamento. */
  shareCancelNotice?: string | null;
  /** Modo da grade (1, 2 ou 4 telas). A sala escolhe sozinha, pelo número de transmissões. */
  gridMode?: GridMode;
  /** O App pede a live de um peer quando o usuário escolhe alguém na lista. */
  onRequestStream?: (peerId: string) => void;
  /** O App libera o slot quando uma stream é ocultada da grade. */
  onStreamRemoved?: (peerId: string) => void;
}

export default function Room({
  code,
  myPeerId,
  nickname,
  peers,
  streams,
  localStream,
  isSharing,
  onStartSharing,
  onStopSharing,
  onLeaveRoom,
  subscribeStats,
  pushPlayback,
  pushAudioPlayback,
  audioNotice,
  exportDiagnostics,
  subscribeSenderDiagnostics,
  getSenderSnapshots,
  exportSenderDiagnostics,
  chatMessages = [],
  myClientId,
  onSendChat,
  onRetryChat,
  chatUnread = 0,
  onChatOpenChange,
  notice,
  streamResolution = '1080',
  measuredResolution = null,
  streamFrameRate = 30,
  measuredFrameRate = null,
  measuredSurface = null,
  streamerBusy = false,
  streamerNotice = null,
  streamerNoticeInformative = false,
  onSelectResolution,
  onSelectFrameRate,
  onSwitchSource,
  streamLimitNotice = null,
  shareCancelNotice = null,
  gridMode = 4,
  onRequestStream,
  onStreamRemoved,
}: RoomProps) {
  const [mouseInactive, setMouseInactive] = useState(false);
  // A live começa muda: o som só liga quando a pessoa pede.
  const [volume, setVolume] = useState(0);

  const [showSettings, setShowSettings] = useState(false);
  const [showSenderStats, setShowSenderStats] = useState(false);
  const [senderSnapshots, setSenderSnapshots] = useState<DiagnosticsSnapshot[]>([]);
  const [senderConnectionId, setSenderConnectionId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ── Grade de transmissões (até 4) ──
  /** Stream em tela cheia (modo foco). null = mostrando a grade. */
  const [focusedStreamId, setFocusedStreamId] = useState<string | null>(null);
  /** Stream em modo teatro: ocupa a grade inteira até voltar ao layout anterior. */
  const [theaterPeerId, setTheaterPeerId] = useState<string | null>(null);
  /** Pausa de cada tile antes de entrar no teatro, para restaurar ao sair. */
  const theaterPauseSnapshot = useRef<Record<string, boolean> | null>(null);
  /** Volume e mudo por transmissor — um tile não controla o som do outro. */
  const [tileAudio, setTileAudio] = useState<Record<string, { muted: boolean; volume: number }>>({});
  /** Zoom por tile da grade (1 = 100%). */
  const [tileZoom, setTileZoom] = useState<Record<string, number>>({});
  /** Live pausada por tile (só o quadro/audio daquele tile para). */
  const [tilePaused, setTilePaused] = useState<Record<string, boolean>>({});

  // Chat aberto por padrão no desktop; fechado em telas pequenas.
  const [chatOpen, setChatOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(min-width: 1024px)').matches;
  });

  // O App usa isso para contar as mensagens que chegam com o chat fechado.
  useEffect(() => {
    onChatOpenChange?.(chatOpen);
  }, [chatOpen, onChatOpenChange]);

  // Captura de tela só existe em navegador de computador, em contexto seguro.
  const screenShare = useMemo(() => detectScreenShareSupport(readScreenShareEnvironment()), []);
  /** Todas as vagas de transmissão ocupadas por outras pessoas. */
  const otherSharers = peers.filter(p => p.isSharing && p.id !== myPeerId).length;
  const shareSlotsFull = !isSharing && areShareSlotsFull(otherSharers);
  const canShare = isSharing || (screenShare.supported && !shareSlotsFull);

  useEffect(() => {
    if (!showSenderStats || !subscribeSenderDiagnostics || !getSenderSnapshots) return;
    const pull = () => {
      const next = getSenderSnapshots();
      setSenderSnapshots(next);
      setSenderConnectionId((current) => {
        if (current && next.some((item) => item.sample.connectionId === current)) return current;
        return next[0]?.sample.connectionId ?? null;
      });
    };
    pull();
    return subscribeSenderDiagnostics(pull);
  }, [showSenderStats, subscribeSenderDiagnostics, getSenderSnapshots]);

  useEffect(() => {
    if (!isSharing) setShowSenderStats(false);
  }, [isSharing]);

  const mouseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build remote streams list (exclude local)
  const remoteStreams = streams.filter(s => s.peerId !== myPeerId);

  // ── Grade: o modo escolhido (1, 2 ou 4 telas) define quantas cabem ──
  const visibleStreams = remoteStreams;
  /** Quem transmite vê o próprio preview na primeira célula da grade. */
  const showPreview = isSharing && !!localStream;
  /** Quantas lives dos outros cabem na grade no modo atual. */
  const gridLimit = remoteSlotsForMode(gridMode, showPreview);
  const gridStreams = visibleStreams.slice(0, gridLimit);
  /** Peers cujas lives estamos assistindo agora (um slot da grade cada). */
  const watching = useMemo(
    () => new Set(remoteStreams.map(s => s.peerId)),
    [remoteStreams]
  );
  /** Peers da grade (tile visível agora). */
  const gridPeerIds = useMemo(
    () => new Set(gridStreams.map(s => s.peerId)),
    [gridStreams]
  );
  /** A grade já está no limite de slots do modo? */
  const gridFull = watching.size >= gridLimit && otherSharers > 0;
  /** Tile que ocupa a grade inteira no modo teatro. */
  const theaterStream = theaterPeerId
    ? remoteStreams.find(s => s.peerId === theaterPeerId) ?? null
    : null;
  /** Stream em tela cheia (modo foco). */
  const focusedStream = focusedStreamId
    ? visibleStreams.find(s => s.peerId === focusedStreamId) ?? null
    : null;
  /** No modo 1 a live ocupa o palco inteiro (como antes da grade). */
  const singleStream = focusedStream || showPreview ? null : gridMode === 1 && gridStreams.length === 1 ? gridStreams[0] : null;
  const shownStream = focusedStream ?? singleStream;
  /** No modo 1 a grade só aparece com 2+ lives (com uma, ela fica sozinha). */
  const showGrid = !focusedStream && (showPreview || (gridMode === 1 ? gridStreams.length >= 2 : gridStreams.length >= 1));
  const activePeerId = shownStream?.peerId ?? null;
  /** Aviso de limite: o App avisa quando o pedido é barrado; a Room avisa
      quando a grade já está com o número máximo de lives. */
  const limitNotice =
    streamLimitNotice ??
    (gridFull ? limitNoticeForMode(gridMode) : null);
  /** Células vazias da grade: cada uma vira um slot fantasma 16:9. */
  const emptySlots = Math.max(0, maxStreamsForMode(gridMode) - gridStreams.length - (showPreview ? 1 : 0));

  // A stream em foco acabou (saiu da sala): volta para a grade.
  // Só some quando a live realmente acabou — não enquanto ela está chegando.
  useEffect(() => {
    if (focusedStreamId && !remoteStreams.some(s => s.peerId === focusedStreamId)) {
      setFocusedStreamId(null);
    }
  }, [remoteStreams, focusedStreamId]);

  /** A stream escolhida ocupa a grade inteira. As outras pausam; ela continua como estava. */
  const enterTheater = (peerId: string) => {
    if (theaterPauseSnapshot.current === null) theaterPauseSnapshot.current = { ...tilePaused };
    setTheaterPeerId(peerId);
    setTilePaused((prev) => {
      const next = { ...prev };
      for (const s of remoteStreams) {
        if (s.peerId !== peerId) next[s.peerId] = true;
      }
      return next;
    });
  };

  /** Volta ao layout e à pausa de antes do teatro. */
  const exitTheater = () => {
    const snapshot = theaterPauseSnapshot.current;
    theaterPauseSnapshot.current = null;
    setTheaterPeerId(null);
    if (!snapshot) return;
    setTilePaused((prev) => {
      const next = { ...prev };
      for (const [id, wasPaused] of Object.entries(snapshot)) next[id] = wasPaused;
      return next;
    });
  };

  // Quem saiu da sala não pode continuar em teatro.
  useEffect(() => {
    if (theaterPeerId && !remoteStreams.some(s => s.peerId === theaterPeerId)) {
      exitTheater();
    }
  }, [remoteStreams, theaterPeerId]);

  // A primeira live que chega toca; as que chegam com outra já na tela vêm
  // pausadas. O mudo já é o padrão de cada tile.
  const seenStreamIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(remoteStreams.map(s => s.peerId));
    const arrived = remoteStreams.filter(s => !seenStreamIds.current.has(s.peerId));
    if (arrived.length > 0) {
      const alreadyShown = remoteStreams.length > arrived.length;
      setTilePaused(prev => {
        const next = { ...prev };
        arrived.forEach((s, index) => {
          next[s.peerId] = alreadyShown || index > 0;
        });
        return next;
      });
      setTileAudio(prev => {
        if (!arrived.some(s => s.peerId in prev)) return prev;
        const next = { ...prev };
        for (const s of arrived) delete next[s.peerId];
        return next;
      });
    }
    seenStreamIds.current = current;
  }, [remoteStreams]);

  // ── Controles da grade ──
  /** Assiste a live de um peer que está na lista (ainda não recebida). */
  const handleWatch = (peerId: string) => {
    if (watching.has(peerId)) {
      setFocusedStreamId(peerId);
      return;
    }
    onRequestStream?.(peerId);
  };

  /** Fecha a stream em tela cheia: volta para a grade ou esvazia a sala. */
  const handleViewerClose = () => {
    const peerId = shownStream?.peerId;
    setFocusedStreamId(null);
    if (peerId && gridStreams.length < 2 && !showPreview) {
      // Era a única live: solta o slot para o App (some da grade de vez).
      onStreamRemoved?.(peerId);
    }
  };

  /** "Parar de assistir": fecha a recepção daquela live (o transmissor segue). */
  const handleStopWatching = (peerId: string) => {
    setFocusedStreamId((current) => (current === peerId ? null : current));
    setTilePaused((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    onStreamRemoved?.(peerId);
  };

  /** Pausa/reproduz um tile (só aquele quadro e áudio param). */
  const handleToggleTilePause = (peerId: string) => {
    setTilePaused((prev) => ({ ...prev, [peerId]: !prev[peerId] }));
  };

  const handleToggleTileMute = (peerId: string) => {
    setTileAudio(prev => {
      const current = prev[peerId] ?? { muted: true, volume: 0.7 };
      return { ...prev, [peerId]: { ...current, muted: !current.muted } };
    });
  };

  const handleTileVolume = (peerId: string, volume: number) => {
    setTileAudio(prev => {
      const current = prev[peerId] ?? { muted: true, volume: 0.7 };
      const next = Math.min(1, Math.max(0, volume));
      return { ...prev, [peerId]: { volume: next, muted: next === 0 } };
    });
  };

  const handleTileZoom = (peerId: string, zoom: number) => {
    setTileZoom(prev => ({ ...prev, [peerId]: zoom }));
  };

  /** Estado de som de um tile (mudo por padrão: o áudio fica com o StreamViewer). */
  const tileAudioOf = (peerId: string) => tileAudio[peerId] ?? { muted: true, volume: 0.7 };
  const subscribeActive = useCallback((cb: (snapshot: DiagnosticsSnapshot) => void) => {
    if (!subscribeStats || !activePeerId) return () => {};
    return subscribeStats(activePeerId, cb);
  }, [subscribeStats, activePeerId]);
  const pushActive = useCallback((sample: PlaybackSample) => {
    if (!pushPlayback || !activePeerId) return false;
    return pushPlayback(activePeerId, sample);
  }, [pushPlayback, activePeerId]);
  const pushAudioActive = useCallback((report: AudioPlaybackReport) => {
    if (!pushAudioPlayback || !activePeerId) return false;
    return pushAudioPlayback(activePeerId, report);
  }, [pushAudioPlayback, activePeerId]);
  const exportActive = useCallback(() => {
    if (activePeerId) exportDiagnostics?.(activePeerId);
  }, [exportDiagnostics, activePeerId]);
  const selectedSender = senderSnapshots.find((item) => item.sample.connectionId === senderConnectionId) ?? senderSnapshots[0] ?? null;

  // ── Track fullscreen state ──
  useEffect(() => {
    const onFsChange = () => {
      const active = document.fullscreenElement !== null;
      setIsFullscreen(active);
      document.body.classList.toggle('fullscreen-ui', active);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.body.classList.remove('fullscreen-ui');
    };
  }, []);

  // ── Mouse inactivity auto-hide (3s) em tela cheia ──
  const resetMouseTimer = useCallback(() => {
    setMouseInactive(false);
    document.body.classList.remove('mouse-inactive');
    if (mouseTimer.current) clearTimeout(mouseTimer.current);
    mouseTimer.current = setTimeout(() => {
      setMouseInactive(true);
      document.body.classList.add('mouse-inactive');
    }, 3000);
  }, []);

  useEffect(() => {
    const handler = () => resetMouseTimer();
    window.addEventListener('mousemove', handler);
    window.addEventListener('mousedown', handler);
    resetMouseTimer();
    return () => {
      window.removeEventListener('mousemove', handler);
      window.removeEventListener('mousedown', handler);
      document.body.classList.remove('mouse-inactive');
      if (mouseTimer.current) clearTimeout(mouseTimer.current);
    };
  }, [resetMouseTimer]);

  // ── Hide cursor in fullscreen when inactive ──
  useEffect(() => {
    if (isFullscreen && mouseInactive) {
      document.documentElement.style.cursor = 'none';
    } else {
      document.documentElement.style.cursor = '';
    }
    return () => { document.documentElement.style.cursor = ''; };
  }, [isFullscreen, mouseInactive]);

  // Only show peers who are sharing
  const listPeers = peers.filter(p => p.isSharing);
  return (
    <div className="w-full h-screen overflow-hidden relative flex flex-col bg-background">
      {/* ── Ambient Background Glow ── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none z-0">
        <div
          className="absolute w-[500px] h-[500px] rounded-full bg-primary/15 blur-[100px] -top-24 -left-20"
          style={{ animation: 'floatOrb1 18s ease-in-out infinite alternate' }}
        />
        <div
          className="absolute w-[600px] h-[600px] rounded-full bg-[#064e3b]/25 blur-[120px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ animation: 'floatOrb2 22s ease-in-out infinite alternate' }}
        />
        <div
          className="absolute w-[450px] h-[450px] rounded-full bg-[#04b4a2]/15 blur-[95px] -bottom-20 -right-20"
          style={{ animation: 'floatOrb3 16s ease-in-out infinite alternate' }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,rgba(12,14,19,0.85)_100%)]" />
      </div>

      {/* ── Settings Modal ── */}
      {showSettings && (
        <SettingsModal
          nickname={nickname}
          onClose={() => setShowSettings(false)}
          onSave={(s) => { /* settings saved to localStorage by the modal */ }}
        />
      )}

      {/* ── Main Canvas + Chat da sala ── */}
      <div className="flex-1 flex min-h-0 w-full">
        <main className="flex-1 min-w-0 h-full p-2.5 sm:p-3 flex flex-col overflow-hidden relative cursor-default z-10">
          <div className="flex-1 min-h-0 w-full flex flex-col gap-2 sm:gap-2.5">
            {isSharing && audioNotice && (
              <div
                role="alert"
                className="shrink-0 flex items-start gap-2.5 rounded-xl border border-amber-300/70 bg-amber-500 px-3.5 py-2.5 text-[13px] font-semibold leading-snug text-amber-950 shadow-[0_8px_24px_rgba(245,158,11,0.35)]"
              >
                <span className="material-symbols-outlined text-[20px] leading-none shrink-0" aria-hidden="true">volume_off</span>
                <p className="min-w-0">{audioNotice}</p>
              </div>
            )}
            <div className="flex-1 min-h-0 w-full flex items-center justify-center">
              {showGrid ? (
                /* ── Grade: 1, 2 ou 4 transmissões ao mesmo tempo.
                    No teatro, só a stream escolhida ocupa o palco. ── */
                <div className={theaterStream ? 'w-full h-full min-h-0' : `grid ${gridClassForMode(gridMode)} gap-2.5 sm:gap-3 w-full h-full`}>
                  {/* Preview de quem transmite: sempre a primeira célula */}
                  {showPreview && (
                    <LocalPreview
                      stream={localStream}
                      nickname={nickname}
                      holdPaused={Boolean(theaterStream)}
                      resolution={streamResolution}
                      frameRate={streamFrameRate}
                      onStopSharing={onStopSharing}
                      onShowStats={() => setShowSenderStats((open) => !open)}
                      statsActive={showSenderStats}
                      notice={Boolean(streamerNotice) && !streamerNoticeInformative}
                      className={theaterStream ? 'hidden' : undefined}
                      settings={
                        <StreamerBar
                          measuredSurface={measuredSurface}
                          onSelectSource={(source) => onSwitchSource?.(source)}
                          resolution={streamResolution}
                          measuredResolution={measuredResolution}
                          onSelectResolution={(next) => onSelectResolution?.(next)}
                          frameRate={streamFrameRate}
                          measuredFrameRate={measuredFrameRate}
                          onSelectFrameRate={(fps) => onSelectFrameRate?.(fps)}
                          busy={streamerBusy}
                          notice={streamerNotice}
                          informative={streamerNoticeInformative}
                        />
                      }
                    />
                  )}
                  {(theaterStream ? [theaterStream] : gridStreams).map((s) => {
                    const audio = tileAudioOf(s.peerId);
                    const inTheater = theaterStream?.peerId === s.peerId;
                    return (
                      <StreamTile
                        key={s.peerId}
                        stream={s.stream}
                        nickname={s.nickname}
                        muted={audio.muted}
                        volume={audio.volume}
                        onToggleMute={() => handleToggleTileMute(s.peerId)}
                        onVolumeChange={(v) => handleTileVolume(s.peerId, v)}
                        onTheater={() => (inTheater ? exitTheater() : enterTheater(s.peerId))}
                        theater={inTheater}
                        onStopWatching={() => handleStopWatching(s.peerId)}
                        subscribeStats={subscribeStats ? (cb) => subscribeStats(s.peerId, cb) : undefined}
                        pushPlayback={pushPlayback ? (sample) => pushPlayback(s.peerId, sample) : undefined}
                        pushAudioPlayback={pushAudioPlayback ? (report) => pushAudioPlayback(s.peerId, report) : undefined}
                        onExportDiagnostics={exportDiagnostics ? () => exportDiagnostics(s.peerId) : undefined}
                        zoom={tileZoom[s.peerId]}
                        onZoomChange={(z) => handleTileZoom(s.peerId, z)}
                        paused={tilePaused[s.peerId] ?? false}
                        onTogglePause={() => handleToggleTilePause(s.peerId)}
                        fill
                      />
                    );
                  })}
                  {/* Slots fantasma: as células vazias da grade, para o
                      layout do modo ficar completo (2x2 no modo 4). */}
                  {!theaterStream && Array.from({ length: emptySlots }).map((_, index) => (
                    <div
                      key={`ghost-${index}`}
                      className="flex h-full min-h-0 rounded-2xl border border-dashed border-outline-variant/25 bg-surface-container-low/30 items-center justify-center pointer-events-none"
                    >
                      <span className="text-[10px] font-label-mono text-outline/70 uppercase tracking-wider text-center px-2">
                        aguardando transmissão
                      </span>
                    </div>
                  ))}
                </div>
              ) : shownStream ? (
                /* ── Uma stream só, ou uma stream focada em tela cheia ── */
                <>
                  {(gridStreams.length > 1 || showPreview) && (
                    <button
                      type="button"
                      onClick={() => setFocusedStreamId(null)}
                      className="absolute top-16 left-4 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#111318]/95 backdrop-blur-xl border border-[#272a37] shadow-2xl text-[11px] font-label-mono text-on-surface hover:text-primary hover:border-primary/40 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60"
                    >
                      <span className="material-symbols-outlined text-[15px]">arrow_back</span>
                      <span>Voltar à grade</span>
                    </button>
                  )}
                  <StreamViewer
                    stream={shownStream.stream}
                    nickname={shownStream.nickname}
                    onClose={handleViewerClose}
                    mouseInactive={mouseInactive}
                    volume={volume}
                    onVolumeChange={setVolume}
                    subscribeStats={activePeerId ? subscribeActive : undefined}
                    pushPlayback={activePeerId ? pushActive : undefined}
                    pushAudioPlayback={activePeerId ? pushAudioActive : undefined}
                    onExportDiagnostics={activePeerId ? exportActive : undefined}
                  />
                </>
              ) : (
                <CrtEmptyState
                  onShare={onStartSharing}
                  shareDisabled={!canShare}
                  shareTitle={canShare ? undefined : shareSlotsFull ? SHARE_SLOTS_FULL_NOTICE : screenShare.message}
                />
              )}
            </div>
          </div>

          {/* Compartilhar e chat no fundo da tela.
              O ícone some com o chat aberto; a transmissão se encerra pelo preview ou pelo chat. */}
          <div className="absolute bottom-4 right-4 z-40 flex items-center gap-2">
            {!isSharing && !chatOpen && (
            <HoverTip
              label={
                canShare
                  ? 'Compartilhar Tela'
                  : shareSlotsFull
                    ? SHARE_SLOTS_FULL_NOTICE
                    : screenShare.message
              }
            >
              <button
                type="button"
                onClick={onStartSharing}
                disabled={!canShare}
                aria-label="Compartilhar Tela"
                className="w-11 h-11 rounded-2xl bg-[#111318]/95 backdrop-blur-xl border border-[#272a37] shadow-2xl flex items-center justify-center text-on-surface hover:text-primary hover:border-primary/50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <BotecaoIcon />
              </button>
            </HoverTip>
            )}
            <HoverTip label={chatOpen ? 'Fechar o chat' : 'Abrir o chat'}>
              <button
                type="button"
                onClick={() => setChatOpen((open) => !open)}
                aria-label={chatOpen ? 'Fechar o chat' : 'Abrir o chat'}
                className={`relative ${chatOpen ? 'lg:hidden' : ''} w-11 h-11 rounded-2xl bg-[#111318]/95 backdrop-blur-xl border shadow-2xl flex items-center justify-center transition-colors cursor-pointer ${
                  chatOpen ? 'text-primary border-primary/40' : 'text-on-surface border-[#272a37] hover:text-primary hover:border-primary/50'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">chat</span>
                {!chatOpen && chatUnread > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-on-primary text-[10px] font-bold flex items-center justify-center">
                    {chatUnread > 99 ? '99+' : chatUnread}
                  </span>
                )}
              </button>
            </HoverTip>
          </div>

          {/* Aviso da sala (ex.: sessão restaurada após o F5) */}
          {notice && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 max-w-[90%] flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#111318]/95 backdrop-blur-xl border border-primary/30 shadow-2xl">
              <span className="material-symbols-outlined text-[16px] text-primary shrink-0">check_circle</span>
              <span className="text-[12px] text-on-surface leading-snug">{notice}</span>
            </div>
          )}

          {/* Diagnóstico: abre sobre o vídeo, nunca sobre o painel de chat */}
          {showSenderStats && (
            <div className="absolute top-4 right-4 z-30">
              <StatsPanel
                snapshot={selectedSender}
                onClose={() => setShowSenderStats(false)}
                onExport={() => {
                  if (selectedSender) exportSenderDiagnostics?.(selectedSender.sample.connectionId);
                }}
                connections={senderSnapshots.map((item, index) => ({
                  connectionId: item.sample.connectionId,
                  label: `Conexão ${index + 1}`,
                }))}
                selectedConnectionId={senderConnectionId ?? null}
                onSelectConnection={setSenderConnectionId}
                emptyHint="Nenhum espectador conectado. A codificação só é medida quando existe uma conexão WebRTC."
              />
            </div>
          )}
        </main>

        {/* Chat da sala: coluna ao lado no desktop, overlay de tela cheia abaixo de lg */}
        <ChatPanel
          messages={chatMessages}
          myPeerId={myPeerId}
          myClientId={myClientId}
          myNickname={nickname}
          onSend={(text) => onSendChat?.(text)}
          onRetry={onRetryChat}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          roomCode={code}
          onLeaveRoom={onLeaveRoom}
          peers={peers}
          isSharing={isSharing}
          canShare={canShare}
          shareTitle={canShare ? undefined : shareSlotsFull ? SHARE_SLOTS_FULL_NOTICE : screenShare.message}
          onStartSharing={onStartSharing}
          onStopSharing={onStopSharing}
        />
      </div>

    </div>
  );
}

/** Popup no hover, no mesmo visual dos outros painéis. O texto não vai em title. */
function HoverTip({ label, children, side = 'top' }: { label: string; children: ReactNode; side?: 'top' | 'left' }) {
  const place = side === 'left'
    ? 'right-full top-1/2 -translate-y-1/2 mr-2'
    : 'bottom-full left-1/2 -translate-x-1/2 mb-2';
  return (
    <div className="relative group/tip">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${place} px-2.5 py-1 rounded-lg bg-[#18191c]/95 backdrop-blur-xl border border-[#272a37] shadow-2xl text-[11px] text-on-surface whitespace-nowrap opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all duration-150 z-50`}
      >
        {label}
      </span>
    </div>
  );
}
