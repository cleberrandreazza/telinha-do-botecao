import { useState, useRef, useEffect, useCallback } from 'react';
import StatsPanel from './StatsPanel';
import StreamControls, { ZOOM_LEVELS } from './StreamControls';
import { useZoomPan } from '../lib/useZoomPan';
import {
  PlaybackMonitor,
  resolvePlayback,
  shouldRebindSrcObject,
  type AudioPlaybackReport,
  type DiagnosticsSnapshot,
  type PlaybackSample,
} from '../lib/diagnostics/index';

interface StreamViewerProps {
  stream: MediaStream;
  nickname: string;
  onClose: () => void;
  mouseInactive: boolean;
  volume: number;
  onVolumeChange: (v: number) => void;
  subscribeStats?: (cb: (snapshot: DiagnosticsSnapshot) => void) => () => void;
  pushPlayback?: (sample: PlaybackSample) => boolean;
  pushAudioPlayback?: (report: AudioPlaybackReport) => boolean;
  onExportDiagnostics?: () => void;
}

export default function StreamViewer({
  stream,
  nickname,
  onClose,
  mouseInactive,
  volume,
  onVolumeChange,
  subscribeStats,
  pushPlayback,
  pushAudioPlayback,
  onExportDiagnostics,
}: StreamViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [crtState, setCrtState] = useState<'turning-on' | 'on' | 'turning-off' | 'off'>('turning-on');
  const [isLoading, setIsLoading] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [liveAudio, setLiveAudio] = useState<AudioPlaybackReport | null>(null);
  const [zoomIndex, setZoomIndex] = useState(0);
  const minLoaderDone = useRef(false);
  const streamReady = useRef(false);

  // ── Attach stream to video ──
  useEffect(() => {
    if (videoRef.current && stream) {
      setIsLoading(true);
      minLoaderDone.current = false;
      streamReady.current = false;

      const video = videoRef.current;

      const tryFinishLoading = () => {
        if (minLoaderDone.current && streamReady.current) {
          setIsLoading(false);
        }
      };

      const onPlaying = () => {
        streamReady.current = true;
        tryFinishLoading();
      };

      // Listen BEFORE setting srcObject to catch early events (canvas streams fire instantly)
      video.addEventListener('playing', onPlaying);

      const bindTracks = () => {
        const nextIds = stream.getTracks().map((track) => track.id);
        const current = video.srcObject instanceof MediaStream ? video.srcObject : null;
        const currentIds = current ? current.getTracks().map((track) => track.id) : [];
        if (shouldRebindSrcObject(currentIds, nextIds)) {
          video.srcObject = new MediaStream(stream.getTracks());
        }
      };
      const describePlayError = (err: unknown) => {
        if (err instanceof DOMException || err instanceof Error) return `${err.name}: ${err.message}`;
        return String(err);
      };
      const startPlayback = async () => {
        bindTracks();
        const level = volumeRef.current;
        const wantSound = level > 0;
        video.volume = wantSound ? level : 0;
        video.muted = !wantSound;
        let audibleError: string | null = null;
        let mutedError: string | null = null;
        try {
          await video.play();
        } catch (err) {
          audibleError = describePlayError(err);
          if (wantSound) {
            video.muted = true;
            try {
              await video.play();
            } catch (mutedErr) {
              mutedError = describePlayError(mutedErr);
            }
          }
        }
        if (cancelled) return;
        const result = resolvePlayback({
          wantSound,
          audibleError: wantSound ? audibleError : null,
          mutedError: wantSound ? mutedError : audibleError,
        });
        video.muted = result.muted;
        setAudioBlocked(result.blocked);
        setPlayError(result.error);
        if (result.error) console.warn('[WebRTC] play()', result.error);
      };
      let cancelled = false;
      const onTrackChange = () => {
        void startPlayback();
      };
      stream.addEventListener('addtrack', onTrackChange);
      stream.addEventListener('removetrack', onTrackChange);
      void startPlayback();

      // Minimum loader display time (lets CRT animation play)
      const minTimer = setTimeout(() => {
        minLoaderDone.current = true;
        tryFinishLoading();
      }, 800);

      // Fallback: poll for already-playing state (catches edge cases)
      const fallbackCheck = setInterval(() => {
        if (!video.paused && video.readyState >= 2) {
          streamReady.current = true;
          tryFinishLoading();
          clearInterval(fallbackCheck);
        }
      }, 100);

      return () => {
        cancelled = true;
        video.removeEventListener('playing', onPlaying);
        stream.removeEventListener('addtrack', onTrackChange);
        stream.removeEventListener('removetrack', onTrackChange);
        clearTimeout(minTimer);
        clearInterval(fallbackCheck);
      };
    }
  }, [stream]);

  // ── CRT turn-on animation ──
  useEffect(() => {
    setCrtState('turning-on');
    const timer = setTimeout(() => setCrtState('on'), 600);
    return () => clearTimeout(timer);
  }, [stream]);

  // ── Zoom ──
  // Trocar de live volta o zoom para 100%.
  useEffect(() => {
    setZoomIndex(0);
  }, [stream]);

  const zoomIn = useCallback(() => {
    setZoomIndex((index) => Math.min(index + 1, ZOOM_LEVELS.length - 1));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomIndex((index) => Math.max(index - 1, 0));
  }, []);

  const resetZoom = useCallback(() => {
    setZoomIndex(0);
  }, []);

  /** Zoom atual (1 = 100%). */
  const zoom = ZOOM_LEVELS[zoomIndex];

  // Zoom + arrasto: com zoom > 1, arrastar sobre o vídeo move o quadro
  // (limitado às bordas). O pan é local do player.
  const { pan, dragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } = useZoomPan(containerRef, zoom);

  // Volume 0 silencia. Desmutar fica no gesto (botão ou slider), não neste efeito.
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    if (volume === 0) video.muted = true;
  }, [volume]);

  const describePlayError = (err: unknown) => {
    if (err instanceof DOMException || err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
  };

  const commitVolume = (value: number) => {
    onVolumeChange(value);
    const video = videoRef.current;
    if (!video) return;
    video.volume = value;
    video.muted = value === 0;
    if (value === 0) return;
    video.play().then(() => {
      setAudioBlocked(false);
      setPlayError(null);
    }).catch((err) => {
      const text = describePlayError(err);
      setPlayError(text);
      setAudioBlocked(true);
      console.warn('[WebRTC] play()', text);
    });
  };

  const enableAudio = () => {
    commitVolume(volumeRef.current > 0 ? volumeRef.current : 0.7);
  };

  // ── Play/Pause ──
  const togglePause = useCallback(() => {
    if (!videoRef.current) return;
    if (isPaused) {
      videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
    setIsPaused(!isPaused);
  }, [isPaused]);

  // ── Fullscreen ──
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomIn();
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomOut();
    } else if (event.key === '0') {
      event.preventDefault();
      resetZoom();
    } else if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      toggleFullscreen();
    }
  }, [zoomIn, zoomOut, resetZoom, toggleFullscreen]);

  const CHROME_IDLE_MS = 2500;
  const [chromeIdle, setChromeIdle] = useState(false);
  const [chromeHeld, setChromeHeld] = useState(false);
  const idleTimer = useRef<number | null>(null);
  const gestureRef = useRef({ x: 0, y: 0, moved: false });
  const clickTimer = useRef<number | null>(null);
  const showChrome = !chromeIdle || chromeHeld || isPaused;

  const armChrome = useCallback(() => {
    setChromeIdle(false);
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setChromeIdle(true), CHROME_IDLE_MS);
  }, []);

  useEffect(() => {
    armChrome();
    return () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    };
  }, [armChrome]);

  const onStagePointerDown = (event: React.PointerEvent<HTMLVideoElement>) => {
    gestureRef.current = { x: event.clientX, y: event.clientY, moved: false };
    containerRef.current?.focus({ preventScroll: true });
    onPointerDown(event);
  };
  const onStagePointerMove = (event: React.PointerEvent<HTMLVideoElement>) => {
    const gesture = gestureRef.current;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6) gesture.moved = true;
    onPointerMove(event);
  };
  const onStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, a, select, textarea, [data-player-controls], .player-chrome')) return;
    if (gestureRef.current.moved || dragging || isLoading) return;
    if (event.detail > 1) return;
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      togglePause();
    }, 250);
  };
  const onStageDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, a, select, textarea, [data-player-controls], .player-chrome')) return;
    if (gestureRef.current.moved || isLoading) return;
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    toggleFullscreen();
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // ── Close with CRT turn-off animation ──
  const handleClose = useCallback(() => {
    setCrtState('turning-off');
    setTimeout(() => {
      onClose();
    }, 500);
  }, [onClose]);

  // ── Live diagnostics: playback always, React only while the panel is open ──
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [livePlayback, setLivePlayback] = useState<PlaybackSample | null>(null);
  const showStatsRef = useRef(false);
  const latestPlayback = useRef<PlaybackSample | null>(null);
  const pushPlaybackRef = useRef(pushPlayback);
  const pushAudioRef = useRef(pushAudioPlayback);
  const exportRef = useRef(onExportDiagnostics);
  const blockedRef = useRef(false);
  const playErrorRef = useRef<string | null>(null);
  showStatsRef.current = showStats;
  pushPlaybackRef.current = pushPlayback;
  pushAudioRef.current = pushAudioPlayback;
  exportRef.current = onExportDiagnostics;
  blockedRef.current = audioBlocked;
  playErrorRef.current = playError;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const monitor = new PlaybackMonitor(video, (sample) => {
      latestPlayback.current = sample;
      const accepted = pushPlaybackRef.current?.(sample) ?? false;
      if (showStatsRef.current && !accepted) setLivePlayback(sample);
    });
    monitor.start();
    const reportAudio = () => {
      const current = video.srcObject instanceof MediaStream ? video.srcObject : stream;
      const report: AudioPlaybackReport = {
        muted: video.muted,
        volume: video.volume,
        paused: video.paused,
        blocked: blockedRef.current,
        playError: playErrorRef.current,
        elementAudioTracks: current.getAudioTracks().length,
        readyState: video.readyState,
      };
      const accepted = pushAudioRef.current?.(report) ?? false;
      if (showStatsRef.current && !accepted) setLiveAudio(report);
    };
    reportAudio();
    const audioTimer = setInterval(reportAudio, 1000);
    return () => {
      monitor.stop();
      clearInterval(audioTimer);
    };
  }, [stream]);

  useEffect(() => {
    if (!showStats) return;
    setLivePlayback(latestPlayback.current);
    if (!subscribeStats) return;
    let active = true;
    const unsubscribe = subscribeStats((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [showStats, subscribeStats]);

  const videoTrack = stream.getVideoTracks()[0];
  const settings = videoTrack?.getSettings();
  const trackRequestedFps = typeof settings?.frameRate === 'number' ? settings.frameRate : null;

  const containerStyle: React.CSSProperties = !showChrome || (isFullscreen && mouseInactive && !chromeHeld) ? { cursor: 'none' } : {};

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={armChrome}
      onMouseLeave={() => {
        setChromeHeld(false);
        if (!isPaused) setChromeIdle(true);
      }}
      onClick={onStageClick}
      onDoubleClick={onStageDoubleClick}
      aria-label="Player da live assistida"
      className={`relative w-full h-full flex items-center justify-center rounded-2xl overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
        crtState === 'turning-on' ? 'crt-turn-on' : ''
      } ${crtState === 'turning-off' ? 'crt-turn-off' : ''}`}
    >
      {/* Video — zoom e arrasto são só transform: o container não muda de tamanho */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          touchAction: zoom > 1 ? 'none' : undefined,
          cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : undefined,
        }}
        className={`w-full h-full object-contain bg-black rounded-2xl transition-opacity ${
          dragging ? '' : 'transition-transform duration-200 ease-out'
        } ${isLoading ? 'opacity-0' : 'opacity-100'}`}
      />

      {/* Loading State — CRT TV with loading effect */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black rounded-2xl z-20">
          {/* CRT scanlines full-screen overlay */}
          <div className="absolute inset-0 crt-scanlines pointer-events-none opacity-20 z-10" />
          {/* Ambient glow */}
          <div className="absolute w-80 h-80 rounded-full bg-primary/5 blur-3xl pointer-events-none" />

          <div className="relative z-20 flex flex-col items-center text-center max-w-md w-full gap-5">
            {/* ── Retro CRT TV ── */}
            <div className="relative flex flex-col items-center select-none">
              {/* Antennas */}
              <div className="relative z-10 flex items-end justify-center w-full h-9 mb-[-3px] pointer-events-none">
                <svg className="w-40 h-9 overflow-visible" fill="none" viewBox="0 0 160 36" xmlns="http://www.w3.org/2000/svg">
                  <line x1="76" y1="34" x2="44" y2="6" stroke="#10b981" strokeWidth="2.5" strokeLinecap="square" />
                  <line x1="44" y1="6" x2="40" y2="2" stroke="#10b981" strokeWidth="2.5" strokeLinecap="square" />
                  <circle cx="40" cy="3" r="3" fill="#34d399" />
                  <line x1="84" y1="34" x2="116" y2="6" stroke="#10b981" strokeWidth="2.5" strokeLinecap="square" />
                  <line x1="116" y1="6" x2="120" y2="2" stroke="#10b981" strokeWidth="2.5" strokeLinecap="square" />
                  <circle cx="120" cy="3" r="3" fill="#34d399" />
                  <rect x="70" y="29" width="20" height="7" rx="2.5" fill="#1e293b" stroke="#064e3b" strokeWidth="1" />
                  <circle cx="80" cy="32.5" r="1.8" fill="#4edea3" />
                </svg>
              </div>

              {/* TV Body */}
              <div className="relative w-56 sm:w-64 h-40 sm:h-44 rounded-2xl bg-[#111827] p-2.5 shadow-2xl border-4 border-[#1f2937] flex items-stretch gap-2.5 ring-2 ring-[#059669]/40">
                {/* Top highlight */}
                <div className="absolute inset-x-0 top-0 h-1.5 bg-white/[0.08] rounded-t-xl pointer-events-none" />
                {/* Bottom shadow */}
                <div className="absolute inset-x-0 bottom-0 h-2 bg-black/50 rounded-b-xl pointer-events-none" />

                {/* ── Screen area with loading effect ── */}
                <div className="relative flex-1 rounded-xl overflow-hidden bg-[#030b06] border-4 border-[#0f172a] shadow-[inset_0_0_14px_rgba(0,0,0,0.95)] flex items-center justify-center">
                  {/* Loading bars animation */}
                  <div className="absolute inset-0 crt-loading-bars" />
                  {/* Scan line sweep */}
                  <div className="absolute inset-0 crt-scan-sweep pointer-events-none" />
                  {/* Scanlines */}
                  <div className="absolute inset-0 crt-scanlines pointer-events-none opacity-50" />
                  {/* Glare / shine */}
                  <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.07] to-transparent pointer-events-none" />
                  {/* CRT radial curvature / vignette */}
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.85)_100%)] pointer-events-none" />

                </div>

                {/* ── Side panel with knobs ── */}
                <div className="w-12 sm:w-14 rounded-xl bg-[#0f172a] border-2 border-[#1e293b] p-1.5 flex flex-col justify-between items-center shadow-inner relative">
                  <div className="flex flex-col items-center gap-2.5 pt-1 w-full">
                    <div className="relative w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#1e293b] border-2 border-[#10b981]/50 shadow-md flex items-center justify-center">
                      <div className="w-1 h-3 bg-[#34d399] rounded-full -translate-y-1.5" />
                      <div className="w-2 h-2 rounded-full bg-[#0f172a]" />
                    </div>
                    <div className="relative w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#1e293b] border-2 border-[#10b981]/40 shadow-md flex items-center justify-center">
                      <div className="w-1 h-2.5 bg-[#34d399] rounded-full -translate-y-1" />
                      <div className="w-1.5 h-1.5 rounded-full bg-[#0f172a]" />
                    </div>
                  </div>
                  <div className="w-full flex flex-col items-center gap-1 px-1">
                    <div className="w-full h-0.5 bg-[#334155] rounded-full" />
                    <div className="w-full h-0.5 bg-[#334155] rounded-full" />
                    <div className="w-full h-0.5 bg-[#334155] rounded-full" />
                    <div className="w-full h-0.5 bg-[#334155] rounded-full" />
                  </div>
                  <div className="flex items-center gap-1 pb-0.5">
                    <div className="w-2 h-2 rounded-full bg-[#10b981] shadow-[0_0_6px_#10b981,0_0_12px_#10b981] animate-pulse" />
                    <span className="font-label-mono text-[8px] font-bold text-[#6ee7b7] uppercase tracking-tighter">PWR</span>
                  </div>
                </div>
              </div>

              {/* TV Feet */}
              <div className="w-48 sm:w-56 h-3 flex items-center justify-between px-8 -mt-[1px]">
                <div className="w-5 h-2.5 bg-[#0b0f19] rounded-b-sm border-t border-[#1e293b]" />
                <div className="w-5 h-2.5 bg-[#0b0f19] rounded-b-sm border-t border-[#1e293b]" />
              </div>
            </div>

            {/* ── Loading text ── */}
            <div className="flex flex-col gap-1.5 items-center mt-1">
              <h3 className="font-headline-md text-[17px] sm:text-[19px] text-on-surface font-semibold tracking-tight">
                Conectando à transmissão...
              </h3>
              <p className="font-body-md text-[13px] text-on-surface-variant">
                {nickname}
              </p>
            </div>
          </div>
        </div>
      )}


      {/* Analog flash overlay on turn-on */}
      {crtState === 'turning-on' && (
        <div className="analog-flash-overlay absolute inset-0 pointer-events-none rounded-2xl" />
      )}

      {/* Pause overlay (Stitch: backdrop-blur + styled badge) */}
      {isPaused && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] z-20 flex flex-col items-center justify-center gap-2 rounded-2xl">
          <div className="w-14 h-14 rounded-full bg-black/70 border border-white/20 flex items-center justify-center shadow-2xl text-primary">
            <span className="material-symbols-outlined text-[32px]">pause</span>
          </div>
          <span className="font-headline-sm text-sm font-semibold text-white tracking-wide bg-black/60 px-3 py-1 rounded-full border border-white/10">Transmissão Pausada</span>
        </div>
      )}

      {showStats && (
        <div className="absolute top-16 right-4 z-30">
          <StatsPanel
            snapshot={snapshot}
            trackRequestedFps={trackRequestedFps}
            livePlayback={snapshot?.sample.playback ?? livePlayback}
            liveAudio={snapshot?.sample.audio ? null : liveAudio}
            onClose={() => setShowStats(false)}
            onExport={() => exportRef.current?.()}
          />
        </div>
      )}

      {/* Streamer name badge (top-left) */}
      <div className={`absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-surface/80 backdrop-blur-md border border-outline-variant/30 flex items-center gap-2 z-10 transition-opacity duration-300 ${showChrome ? 'opacity-100' : 'opacity-0'}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-[12px] font-body text-on-surface font-medium">{nickname}</span>
      </div>

      {audioBlocked && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={enableAudio}
            className="h-10 px-4 rounded-full bg-primary text-on-primary font-label-md text-[13px] font-semibold shadow-2xl cursor-pointer"
          >
            Ativar áudio
          </button>
          {playError && (
            <span className="max-w-sm text-center text-[11px] text-white bg-black/80 border border-white/10 rounded-lg px-2 py-1">
              {playError}
            </span>
          )}
        </div>
      )}

      <div
        onMouseEnter={() => setChromeHeld(true)}
        onMouseLeave={() => setChromeHeld(false)}
        onFocus={() => setChromeHeld(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setChromeHeld(false);
        }}
        className={`player-chrome absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-10 transition-opacity duration-300 ${
          showChrome ? 'is-open opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <StreamControls
          nickname={nickname}
          muted={volume === 0}
          volume={volume}
          onVolumeChange={commitVolume}
          onToggleMute={() => commitVolume(volume === 0 ? 0.7 : 0)}
          paused={isPaused}
          onTogglePause={togglePause}
          zoom={zoom}
          onZoomChange={(next) => setZoomIndex(Math.max(0, ZOOM_LEVELS.findIndex((level) => level === next)))}
          fullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          onShowStats={subscribeStats ? () => setShowStats((open) => !open) : undefined}
          statsActive={showStats}
          onClose={handleClose}
        />
      </div>
    </div>
  );
}
