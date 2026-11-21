import { useState, useEffect, useRef, useCallback } from 'react';
import type { PeerInfo, StreamInfo } from '../lib/types';
import { getInitials, colorFromString } from '../lib/profile';
import CrtEmptyState from './CrtEmptyState';
import StreamViewer from './StreamViewer';
import StatsPanel from './StatsPanel';
import SettingsModal, { loadSettings, type BotecaoSettings } from './SettingsModal';
import type { DiagnosticsSnapshot, PlaybackSample } from '../lib/diagnostics/index';

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
  exportDiagnostics?: (peerId: string) => void;
  subscribeSenderDiagnostics?: (cb: () => void) => () => void;
  getSenderSnapshots?: () => DiagnosticsSnapshot[];
  exportSenderDiagnostics?: (connectionId: string) => void;
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
  exportDiagnostics,
  subscribeSenderDiagnostics,
  getSenderSnapshots,
  exportSenderDiagnostics,
}: RoomProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const [mouseInactive, setMouseInactive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [volume, setVolume] = useState(0.7);

  const [showSettings, setShowSettings] = useState(false);
  const [showSenderStats, setShowSenderStats] = useState(false);
  const [senderSnapshots, setSenderSnapshots] = useState<DiagnosticsSnapshot[]>([]);
  const [senderConnectionId, setSenderConnectionId] = useState<string | null>(null);
  const [streamDismissed, setStreamDismissed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  // Auto-select first remote stream when available (unless user dismissed)
  useEffect(() => {
    if (remoteStreams.length > 0 && !activeStreamId && !streamDismissed) {
      setActiveStreamId(remoteStreams[0].peerId);
    }
    // If active stream left, reset
    if (activeStreamId && !remoteStreams.find(s => s.peerId === activeStreamId)) {
      setActiveStreamId(remoteStreams.length > 0 ? remoteStreams[0].peerId : null);
    }
  }, [remoteStreams.length, activeStreamId, streams, streamDismissed]);

  const activeStream = remoteStreams.find(s => s.peerId === activeStreamId) || null;
  const activePeerId = activeStream?.peerId ?? null;
  const subscribeActive = useCallback((cb: (snapshot: DiagnosticsSnapshot) => void) => {
    if (!subscribeStats || !activePeerId) return () => {};
    return subscribeStats(activePeerId, cb);
  }, [subscribeStats, activePeerId]);
  const pushActive = useCallback((sample: PlaybackSample) => {
    if (!pushPlayback || !activePeerId) return false;
    return pushPlayback(activePeerId, sample);
  }, [pushPlayback, activePeerId]);
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

  // Switch stream
  const handleSwitchStream = (peerId: string) => {
    setStreamDismissed(false);
    setActiveStreamId(peerId);
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
            <div className="flex flex-col gap-1 overflow-y-auto pr-0.5 flex-1">
              {listPeers.map((peer) => {
                const isSelf = peer.id === myPeerId;
                const hasRemoteStream = remoteStreams.some(s => s.peerId === peer.id);
                const isActive = peer.id === activeStreamId;
                const isClickable = hasRemoteStream && !isSelf;
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
                    title={isSelf ? `${peer.nickname} (Você)` : hasRemoteStream ? `Assistir ${peer.nickname}` : `${peer.nickname} - nao esta transmitindo`}
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
                          {peer.isSharing && (
                            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 opacity-80" />
                          )}
                        </div>
                        <span className="text-[10px] font-label-mono truncate text-outline leading-none mt-0.5">
                          {isActive ? 'Assistindo agora' : peer.isSharing ? 'Disponível' : 'Offline'}
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
            className={`w-full h-9 px-3 rounded-xl flex items-center justify-center gap-2 transition-all border cursor-pointer font-label-md text-[13px] shadow-sm ${
              isSharing
                ? 'bg-error-container/20 hover:bg-error-container/30 text-error border-error/30'
                : 'bg-surface-container hover:bg-surface-container-high text-on-surface border-[#1f222e]'
            }`}
          >
            <span className={`material-symbols-outlined text-[18px] ${!isSharing ? 'text-primary' : ''}`}>
              {isSharing ? 'stop_screen_share' : 'screen_share'}
            </span>
            <span className="truncate font-medium">
              {isSharing ? 'Parar Transmissao' : 'Compartilhar Tela'}
            </span>
          </button>
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

      {/* ── Main Canvas ── */}
      <main className="w-full h-full p-2.5 sm:p-3 flex items-center justify-center overflow-hidden relative cursor-default z-10">
        {activeStream ? (
          <StreamViewer
            stream={activeStream.stream}
            nickname={activeStream.nickname}
            onClose={() => { setActiveStreamId(null); setStreamDismissed(true); }}
            onOpenSidebar={() => setSidebarOpen(true)}
            mouseInactive={mouseInactive}
            volume={volume}
            onVolumeChange={setVolume}
            subscribeStats={activePeerId ? subscribeActive : undefined}
            pushPlayback={activePeerId ? pushActive : undefined}
            onExportDiagnostics={activePeerId ? exportActive : undefined}
          />
        ) : (
          <CrtEmptyState onOpenSidebar={() => setSidebarOpen(true)} />
        )}
      </main>
      {showSenderStats && (
        <div className="fixed top-4 right-4 z-40">
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
            selectedConnectionId={selectedSender?.sample.connectionId ?? null}
            onSelectConnection={setSenderConnectionId}
            emptyHint="Nenhum espectador conectado. A codificação só é medida quando existe uma conexão WebRTC."
          />
        </div>
      )}
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
