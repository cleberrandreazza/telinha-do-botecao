import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ChatMessage, PeerInfo, StreamInfo } from '../lib/types';
import { getInitials, colorFromString } from '../lib/profile';
import { detectScreenShareSupport, readScreenShareEnvironment } from '../lib/screenShare';
import CrtEmptyState from './CrtEmptyState';
import LocalPreview from './LocalPreview';
import StreamViewer from './StreamViewer';
import StreamTile from './StreamTile';
import StatsPanel from './StatsPanel';
import ChatPanel from './ChatPanel';
import ResolutionControl, { type StreamResolution } from './ResolutionControl';
import SettingsModal, { loadSettings, type BotecaoSettings } from './SettingsModal';
import { MAX_SIMULTANEOUS_STREAMS } from '../lib/constants';
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
  /** true enquanto a troca de resolução está sendo aplicada. */
  resolutionBusy?: boolean;
  /** Aviso curto de falha na troca de resolução. */
  resolutionNotice?: string | null;
  /** Troca a resolução da live durante a transmissão. */
  onSelectResolution?: (resolution: StreamResolution) => void;
  /** Aviso de limite de transmissões simultâneas. */
  streamLimitNotice?: string | null;
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
  onSendChat,
  onRetryChat,
  chatUnread = 0,
  onChatOpenChange,
  notice,
  streamResolution = '1080',
  measuredResolution = null,
  resolutionBusy = false,
  resolutionNotice = null,
  onSelectResolution,
  streamLimitNotice = null,
  onRequestStream,
  onStreamRemoved,
}: RoomProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mouseInactive, setMouseInactive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [volume, setVolume] = useState(0.7);

  const [showSettings, setShowSettings] = useState(false);
  const [showSenderStats, setShowSenderStats] = useState(false);
  const [senderSnapshots, setSenderSnapshots] = useState<DiagnosticsSnapshot[]>([]);
  const [senderConnectionId, setSenderConnectionId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ── Grade de transmissões (até 4) ──
  /** Stream em tela cheia (modo foco). null = mostrando a grade. */
  const [focusedStreamId, setFocusedStreamId] = useState<string | null>(null);
  /** Streams ocultas da grade por quem está assistindo (local). */
  const [dismissedStreams, setDismissedStreams] = useState<Set<string>>(() => new Set());
  /** Volume e mudo por transmissor — um tile não controla o som do outro. */
  const [tileAudio, setTileAudio] = useState<Record<string, { muted: boolean; volume: number }>>({});
  /** Zoom por tile da grade (1 = 100%). */
  const [tileZoom, setTileZoom] = useState<Record<string, number>>({});

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
  const canShare = isSharing || screenShare.supported;

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

  const sidebarRef = useRef<HTMLElement>(null);
  const mouseOverSidebar = useRef(false);
  const sidebarLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build remote streams list (exclude local)
  const remoteStreams = streams.filter(s => s.peerId !== myPeerId);

  // ── Grade: até MAX_SIMULTANEOUS_STREAMS na tela, o resto fica na sidebar ──
  const visibleStreams = remoteStreams.filter(s => !dismissedStreams.has(s.peerId));
  const gridStreams = visibleStreams.slice(0, MAX_SIMULTANEOUS_STREAMS);
  const overflowStreams = visibleStreams.slice(MAX_SIMULTANEOUS_STREAMS);
  const overflowPeerIds = useMemo(
    () => new Set(overflowStreams.map(s => s.peerId)),
    [overflowStreams]
  );
  /** Stream em tela cheia (modo foco). */
  const focusedStream = focusedStreamId
    ? visibleStreams.find(s => s.peerId === focusedStreamId) ?? null
    : null;
  /** Com uma stream só, ela fica em tela cheia (como antes da grade). */
  const singleStream = focusedStream ? null : gridStreams.length === 1 ? gridStreams[0] : null;
  const shownStream = focusedStream ?? singleStream;
  const showGrid = !focusedStream && gridStreams.length >= 2;
  const activePeerId = shownStream?.peerId ?? null;
  /** Aviso de limite: o App avisa quando a pedido é barrado; a Room avisa
      quando já existem mais streams do que cabem na grade. */
  const limitNotice =
    streamLimitNotice ??
    (overflowStreams.length > 0 ? 'Máximo de 4 transmissões simultâneas' : null);
  /** Células vazias da grade (até 4): cada uma vira um slot fantasma 16:9. */
  const emptySlots = Math.max(0, MAX_SIMULTANEOUS_STREAMS - gridStreams.length);

  // A stream em foco acabou (saiu da sala): volta para a grade.
  // Só some quando a live realmente acabou — não enquanto ela está chegando.
  useEffect(() => {
    if (focusedStreamId && !remoteStreams.some(s => s.peerId === focusedStreamId)) {
      setFocusedStreamId(null);
    }
  }, [remoteStreams, focusedStreamId]);

  // ── Controles da grade ──
  const handleSwitchStream = (peerId: string) => {
    const isDismissed = dismissedStreams.has(peerId);
    const isKnown = remoteStreams.some(s => s.peerId === peerId);
    if (!isKnown) {
      // Ainda não estamos recebendo essa live: o App pede (e avisa quando o
      // limite de 4 slots já estourou).
      onRequestStream?.(peerId);
      return;
    }
    if (isDismissed) {
      // Reabre na grade a live que estava oculta.
      setDismissedStreams(prev => {
        if (!prev.has(peerId)) return prev;
        const next = new Set(prev);
        next.delete(peerId);
        return next;
      });
    }
    setFocusedStreamId(peerId);
  };

  /** Fecha a stream em tela cheia: volta para a grade ou esvazia a sala. */
  const handleViewerClose = () => {
    const peerId = shownStream?.peerId;
    setFocusedStreamId(null);
    if (peerId && gridStreams.length < 2) {
      setDismissedStreams(prev => {
        const next = new Set(prev);
        next.add(peerId);
        return next;
      });
      onStreamRemoved?.(peerId);
    }
  };

  /** Oculta um tile da grade (local) e libera o slot no App. */
  const handleRemoveStream = (peerId: string) => {
    setDismissedStreams(prev => {
      const next = new Set(prev);
      next.add(peerId);
      return next;
    });
    onStreamRemoved?.(peerId);
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
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ── Mouse inactivity auto-hide (3s) — skip if mouse is over sidebar ──
  const resetMouseTimer = useCallback(() => {
    setMouseInactive(false);
    document.body.classList.remove('mouse-inactive');
    if (mouseTimer.current) clearTimeout(mouseTimer.current);
    mouseTimer.current = setTimeout(() => {
      // Don't hide UI while mouse is hovering over the sidebar
      if (mouseOverSidebar.current) return;
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

  // ── Sidebar: never close while mouse is over it ──
  const handleSidebarMouseEnter = () => {
    mouseOverSidebar.current = true;
    if (sidebarLeaveTimer.current) {
      clearTimeout(sidebarLeaveTimer.current);
      sidebarLeaveTimer.current = null;
    }
  };

  const handleSidebarMouseLeave = () => {
    mouseOverSidebar.current = false;
    sidebarLeaveTimer.current = setTimeout(() => {
      if (!mouseOverSidebar.current) {
        setSidebarOpen(false);
      }
    }, 350);
  };

  // Close sidebar on click outside — but NOT if mouse is still over sidebar
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sidebarOpen && sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setSidebarOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sidebarOpen]);

  // Copy room code
  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

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

      {/* ── Arc Open Button (top-left, visible when sidebar closed) ── */}
      {!sidebarOpen && (
        <div className="fixed top-4 left-4 z-40 flex items-center gap-2 autohide-ui">
          <button
            onClick={() => setSidebarOpen(true)}
            className="group h-9 px-2.5 rounded-xl bg-[#111318]/90 hover:bg-surface-container border border-[#272a37] shadow-xl backdrop-blur-md text-on-surface flex items-center gap-2 transition-all cursor-pointer hover:border-primary/50"
            title="Abrir menu lateral"
          >
            <BotecaoIcon />
            <span className="font-medium text-white text-[15px] tracking-tight pl-0.5">Telinha do Botecão</span>
          </button>
        </div>
      )}

      {/* ── Arc Sidebar ── */}
      <aside
        ref={sidebarRef}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
        className={`arc-sidebar fixed top-3 left-3 bottom-3 w-[290px] z-50 bg-[#111318]/95 backdrop-blur-2xl border border-[#272a37] rounded-2xl shadow-2xl flex flex-col justify-between p-3.5 select-none overflow-hidden autohide-ui ${
          sidebarOpen ? '' : 'sidebar-collapsed'
        }`}
      >
        <div className="flex flex-col gap-3 min-h-0 flex-1 overflow-hidden">
          {/* Sidebar Header */}
          <div className="pb-2.5 border-b border-[#1f222e] flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <BotecaoIcon />
                <span className="font-medium text-white text-[15px] tracking-tight">Telinha do Botecão</span>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
                title="Recolher barra lateral"
              >
                <span className="material-symbols-outlined text-[18px]">left_panel_close</span>
              </button>
            </div>

            {/* Room code + Sair */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyCode}
                className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-container/60 hover:bg-surface-container-high/60 border border-outline-variant/20 transition-colors group/code"
                title="Copiar código da sala"
              >
                <span className="material-symbols-outlined text-[14px] text-outline group-hover/code:text-primary transition-colors">
                  {copied ? 'check' : 'content_copy'}
                </span>
                <span className="font-body text-[11px] text-on-surface-variant font-semibold tracking-wider">
                  {code}
                </span>
              </button>
              <button
                onClick={onLeaveRoom}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-container/60 hover:bg-error-container/20 border border-outline-variant/20 hover:border-error/30 text-on-surface-variant hover:text-error transition-all cursor-pointer"
                title="Sair da sala"
              >
                <span className="material-symbols-outlined text-[14px]">logout</span>
                <span className="font-body text-[11px] font-medium">Sair</span>
              </button>
            </div>
          </div>

          {/* Stream Tabs */}
          <div className="flex flex-col gap-2 min-h-0 flex-1 overflow-hidden">
            <div className="px-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[11px] font-bold text-on-surface-variant tracking-wider uppercase font-label-md">
                TRANSMISSÕES AO VIVO
              </span>
            </div>
            {/* Aviso de limite de transmissões simultâneas */}
            {limitNotice && (
              <p
                role="status"
                className="mx-1 px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200/90 leading-snug flex items-start gap-1.5"
              >
                <span className="material-symbols-outlined text-[13px] shrink-0 mt-px">info</span>
                <span>{limitNotice}</span>
              </p>
            )}
            <div className="flex flex-col gap-1 overflow-y-auto pr-0.5 flex-1">
              {listPeers.map((peer) => {
                const isSelf = peer.id === myPeerId;
                const hasRemoteStream = remoteStreams.some(s => s.peerId === peer.id);
                const isActive = peer.id === activePeerId;
                const isOverflow = overflowPeerIds.has(peer.id);
                // Quem está transmitindo pode ser clicado mesmo sem a live
                // recebida: o App tenta pedir (e avisa se o limite estourou).
                const isClickable = !isSelf && (hasRemoteStream || peer.isSharing);
                const initials = getInitials(peer.nickname);
                return (
                  <button
                    key={peer.id}
                    onClick={() => isClickable && handleSwitchStream(peer.id)}
                    disabled={!isClickable}
                    className={`stream-tab-item group relative flex items-center justify-between px-2.5 py-2 rounded-xl border transition-all duration-200 select-none text-left ${
                      isActive && !isSelf
                        ? 'bg-primary/10 border-primary/40 cursor-pointer'
                        : isClickable
                        ? 'hover:bg-surface-container-high/60 hover:border-outline-variant/30 bg-transparent border-transparent cursor-pointer'
                        : 'bg-transparent border-transparent opacity-70 cursor-default'
                    }`}
                    title={isSelf ? `${peer.nickname} (Você)` : hasRemoteStream ? `Assistir ${peer.nickname}` : `Pedir a live de ${peer.nickname}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div
                        className="w-7 h-7 rounded-lg bg-surface-container-high border border-outline-variant/30 text-on-surface flex items-center justify-center font-label-md text-[11px] font-semibold shrink-0"
                        style={
                          isSelf && peer.isSharing
                            ? { backgroundColor: 'rgba(78, 222, 163, 0.15)', borderColor: 'rgba(78, 222, 163, 0.4)', color: '#4edea3' }
                            : isActive
                            ? { backgroundColor: 'rgba(78, 222, 163, 0.15)', borderColor: 'rgba(78, 222, 163, 0.4)', color: '#4edea3' }
                            : {}
                        }
                      >
                        {initials}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-headline-sm text-[13px] truncate leading-none transition-colors font-medium ${
                            isSelf && peer.isSharing ? 'text-primary' : isActive ? 'text-primary' : 'text-on-surface group-hover:text-white'
                          }`}>
                            {peer.nickname}
                          </span>
                          {isSelf && (
                            <span className="text-[9px] font-label-mono text-outline bg-surface-container-high px-1.5 py-0.5 rounded-full shrink-0">Você</span>
                          )}
                          {isOverflow && (
                            <span className="text-[9px] font-label-mono text-amber-300 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded-full shrink-0">
                              fora da grade
                            </span>
                          )}
                          {peer.isSharing && (
                            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 opacity-80" />
                          )}
                        </div>
                        <span className="text-[10px] font-label-mono truncate text-outline leading-none mt-0.5">
                          {isActive ? 'Assistindo agora' : isOverflow ? 'Fora da grade' : peer.isSharing ? 'Disponível' : 'Offline'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 w-5 justify-center">
                      {isClickable && (
                        <span className="material-symbols-outlined text-[16px] text-outline group-hover:text-primary transition-colors opacity-0 group-hover:opacity-100 transition-opacity">
                          play_circle
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom: Online count ABOVE divider → Share button → User profile */}
        <div className="flex flex-col gap-2 relative w-full shrink-0">
          {/* Online count with hover popover — ABOVE the divider line */}
          <div className="relative group/online">
            <div className="flex items-center gap-1.5 cursor-default px-2 py-1">
              <span className="material-symbols-outlined text-[14px] text-outline">group</span>
              <span className="text-[11px] font-label-md text-outline font-medium">
                {peers.length} {peers.length === 1 ? 'pessoa' : 'pessoas'} na sala
              </span>
            </div>
            {/* Popover — opens upward */}
            <div className="absolute left-0 right-0 bottom-full mb-1 bg-[#18191c]/95 backdrop-blur-xl border border-[#272a37] rounded-xl p-2.5 shadow-2xl z-50 opacity-0 invisible group-hover/online:opacity-100 group-hover/online:visible transition-all duration-150">
              <span className="text-[10px] font-bold text-on-surface-variant tracking-wider uppercase font-label-md px-1 pb-1.5 block">
                PARTICIPANTES
              </span>
              <div className="flex flex-col gap-0.5 max-h-[180px] overflow-y-auto">
                {peers.map((peer) => {
                  const isSelf = peer.id === myPeerId;
                  return (
                    <div key={`pop-${peer.id}`} className="flex items-center gap-2 px-1.5 py-1 rounded-lg">
                      <div
                        className="w-5 h-5 rounded-md bg-surface-container-high border border-outline-variant/30 text-on-surface flex items-center justify-center text-[9px] font-semibold font-label-md shrink-0"
                        style={isSelf ? { backgroundColor: 'rgba(78, 222, 163, 0.15)', borderColor: 'rgba(78, 222, 163, 0.4)', color: '#4edea3' } : {}}
                      >
                        {getInitials(peer.nickname)}
                      </div>
                      <span className={`text-[11px] truncate ${isSelf ? 'text-primary font-medium' : 'text-on-surface-variant'}`}>
                        {peer.nickname}
                      </span>
                      {isSelf && (
                        <span className="text-[8px] font-label-mono text-outline bg-surface-container-high px-1 py-0.5 rounded-full">Você</span>
                      )}
                      {peer.isSharing && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 ml-auto" title="Transmitindo" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Divider line */}
          <div className="border-t border-[#1f222e]" />

          {/* Share/Stop button */}
          <button
            onClick={isSharing ? onStopSharing : onStartSharing}
            disabled={!canShare}
            title={canShare ? undefined : screenShare.message}
            className={`w-full h-9 px-3 rounded-xl flex items-center justify-center gap-2 transition-all border font-label-md text-[13px] shadow-sm ${
              isSharing
                ? 'bg-error-container/20 hover:bg-error-container/30 text-error border-error/30 cursor-pointer'
                : canShare
                  ? 'bg-surface-container hover:bg-surface-container-high text-on-surface border-[#1f222e] cursor-pointer'
                  : 'bg-surface-container text-on-surface/50 border-[#1f222e] cursor-not-allowed opacity-60'
            }`}
          >
            <span className={`material-symbols-outlined text-[18px] ${!isSharing && canShare ? 'text-primary' : ''}`}>
              {isSharing ? 'stop_screen_share' : 'screen_share'}
            </span>
            <span className="truncate font-medium">
              {isSharing ? 'Parar Transmissao' : 'Compartilhar Tela'}
            </span>
          </button>
          {!isSharing && !screenShare.supported && (
            <p className="text-[11px] leading-snug text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-xl px-2.5 py-2">
              {screenShare.message}
            </p>
          )}
          {isSharing && audioNotice && (
            <p className="text-[11px] leading-snug text-yellow-200/90 bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-2.5 py-2">
              {audioNotice}
            </p>
          )}
          {/* Resolução da live: só para quem transmite, junto do botão de
              compartilhamento — nunca no StatsPanel, no chat ou no overlay. */}
          {isSharing && (
            <ResolutionControl
              resolution={streamResolution}
              measured={measuredResolution}
              busy={resolutionBusy}
              onSelect={(next) => onSelectResolution?.(next)}
            />
          )}
          {isSharing && resolutionNotice && (
            <p className="text-[11px] leading-snug text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-xl px-2.5 py-2">
              {resolutionNotice}
            </p>
          )}
          {isSharing && (
            <button
              onClick={() => setShowSenderStats((open) => !open)}
              className={`w-full h-9 px-3 rounded-xl flex items-center justify-center gap-2 transition-all border cursor-pointer font-label-md text-[13px] ${
                showSenderStats
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-surface-container hover:bg-surface-container-high text-on-surface border-[#1f222e]'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">monitoring</span>
              <span className="truncate font-medium">Diagnóstico</span>
            </button>
          )}

          {/* User profile (Discord/Arc style) */}
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-surface-container-low border border-[#1f222e] mt-1">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="w-7 h-7 rounded-full bg-primary/20 border border-primary/40 text-primary flex items-center justify-center font-headline-sm text-[11px] font-bold shrink-0"
              >
                {getInitials(nickname)}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-headline-sm text-[12px] text-on-surface font-semibold truncate leading-tight">
                  {nickname}
                </span>
                <span className="text-[10px] text-outline font-label-mono truncate">
                  Online
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* Settings */}
              <button
                onClick={() => setShowSettings(true)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
                title="Configurações"
              >
                <span className="material-symbols-outlined text-[16px]">settings</span>
              </button>
            </div>
          </div>

        </div>
      </aside>

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
        <main className="flex-1 min-w-0 h-full p-2.5 sm:p-3 flex items-center justify-center overflow-hidden relative cursor-default z-10">
          {showGrid ? (
            /* ── Grade: até MAX_SIMULTANEOUS_STREAMS transmissões ao mesmo tempo ── */
            <div className="w-full h-full flex flex-col gap-2 sm:gap-2.5 overflow-y-auto">
              <div className="flex items-center justify-between gap-2 px-1 shrink-0">
                <span className="text-[10px] font-label-mono uppercase tracking-wider text-outline">
                  {gridStreams.length} na grade
                </span>
                <span className="text-[10px] font-label-mono text-outline/80 hidden sm:inline">
                  clique num tile para abrir em tela cheia
                </span>
              </div>
              {limitNotice && (
                <p
                  role="status"
                  className="shrink-0 mx-1 px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200/90 leading-snug flex items-start gap-1.5"
                >
                  <span className="material-symbols-outlined text-[13px] shrink-0 mt-px">info</span>
                  <span>{limitNotice}</span>
                </p>
              )}
              <div
                className={`grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 w-full shrink-0 my-auto ${
                  isSharing && localStream ? 'pb-[13rem] sm:pb-0 sm:pr-[17rem]' : ''
                }`}
              >
                {gridStreams.map((s) => {
                  const audio = tileAudioOf(s.peerId);
                  return (
                    <StreamTile
                      key={s.peerId}
                      stream={s.stream}
                      nickname={s.nickname}
                      muted={audio.muted}
                      volume={audio.volume}
                      onToggleMute={() => handleToggleTileMute(s.peerId)}
                      onVolumeChange={(v) => handleTileVolume(s.peerId, v)}
                      onFocus={() => handleSwitchStream(s.peerId)}
                      onRemove={() => handleRemoveStream(s.peerId)}
                      zoom={tileZoom[s.peerId]}
                      onZoomChange={(z) => handleTileZoom(s.peerId, z)}
                    />
                  );
                })}
                {/* Slots fantasma: as células vazias da grade (16:9, como um
                    tile) e, quando existem transmissões além do limite, uma
                    faixa compacta avisando que há mais gente transmitindo. */}
                {Array.from({ length: emptySlots }).map((_, index) => (
                  <div
                    key={`ghost-${index}`}
                    className="flex aspect-video rounded-2xl border border-dashed border-outline-variant/25 bg-surface-container-low/30 items-center justify-center pointer-events-none"
                  >
                    <span className="text-[10px] font-label-mono text-outline/70 uppercase tracking-wider text-center px-2">
                      aguardando transmissão
                    </span>
                  </div>
                ))}
                {overflowStreams.length > 0 && (
                  <div className="flex h-14 items-center justify-center rounded-2xl border border-dashed border-amber-500/25 bg-amber-500/5 pointer-events-none">
                    <span className="text-[10px] font-label-mono text-amber-200/80 uppercase tracking-wider text-center px-2">
                      aguardando transmissão
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : shownStream ? (
            /* ── Uma stream só, ou uma stream focada em tela cheia ── */
            <>
              {gridStreams.length > 1 && (
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
                onOpenSidebar={() => setSidebarOpen(true)}
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
            <CrtEmptyState onOpenSidebar={() => setSidebarOpen(true)} />
          )}

          {/* Preview de quem transmite: a própria captura, com a resolução real */}
          {isSharing && localStream && (
            <LocalPreview stream={localStream} nickname={nickname} />
          )}

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
          onSend={(text) => onSendChat?.(text)}
          onRetry={onRetryChat}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
        />
      </div>

      {/* ── Botão flutuante do chat ── */}
      <button
        onClick={() => setChatOpen((open) => !open)}
        title={chatOpen ? 'Fechar o chat' : 'Abrir o chat'}
        aria-label={chatOpen ? 'Fechar o chat' : 'Abrir o chat'}
        className={`absolute ${chatOpen ? 'lg:right-[336px] right-4' : 'right-4'} ${
          isSharing && localStream ? 'bottom-[200px] sm:bottom-[215px]' : 'bottom-4'
        } z-30 w-11 h-11 rounded-2xl bg-[#111318]/95 backdrop-blur-xl border border-[#272a37] shadow-2xl flex items-center justify-center transition-colors cursor-pointer ${
          chatOpen ? 'text-primary border-primary/40' : 'text-on-surface hover:text-primary hover:border-primary/50'
        }`}
      >
        <span className="material-symbols-outlined text-[20px]">chat</span>
        {!chatOpen && chatUnread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-on-primary text-[10px] font-bold flex items-center justify-center">
            {chatUnread > 99 ? '99+' : chatUnread}
          </span>
        )}
      </button>
    </div>
  );
}

/* ── Botecao pixel-art TV icon ── */
function BotecaoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" shapeRendering="crispEdges" className="shrink-0">
      <rect x="5" y="2" width="2" height="2" fill="#10b981" />
      <rect x="7" y="4" width="2" height="2" fill="#10b981" />
      <rect x="17" y="2" width="2" height="2" fill="#10b981" />
      <rect x="15" y="4" width="2" height="2" fill="#10b981" />
      <rect x="11" y="5" width="2" height="2" fill="#34d399" />
      <rect x="2" y="6" width="20" height="15" fill="#1e293b" />
      <rect x="2" y="6" width="20" height="2" fill="#334155" />
      <rect x="2" y="6" width="2" height="15" fill="#334155" />
      <rect x="20" y="6" width="2" height="15" fill="#0f172a" />
      <rect x="2" y="19" width="20" height="2" fill="#0f172a" />
      <rect x="4" y="8" width="13" height="10" fill="#064e3b" />
      <rect x="5" y="9" width="11" height="8" fill="#10b981" />
      <rect x="6" y="10" width="4" height="2" fill="#a7f3d0" />
      <rect x="6" y="13" width="2" height="2" fill="#6ee7b7" />
      <rect x="12" y="14" width="3" height="2" fill="#047857" />
      <rect x="18" y="9" width="2" height="2" fill="#34d399" />
      <rect x="18" y="13" width="2" height="2" fill="#94a3b8" />
      <rect x="18" y="16" width="2" height="1" fill="#475569" />
      <rect x="5" y="21" width="3" height="1" fill="#0f172a" />
      <rect x="16" y="21" width="3" height="1" fill="#0f172a" />
    </svg>
  );
}
