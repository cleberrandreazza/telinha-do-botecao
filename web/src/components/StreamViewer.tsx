import { useState, useRef, useEffect, useCallback } from 'react';
import StatsPanel from './StatsPanel';
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
  onOpenSidebar: () => void;
  mouseInactive: boolean;
  volume: number;
  onVolumeChange: (v: number) => void;
  subscribeStats?: (cb: (snapshot: DiagnosticsSnapshot) => void) => () => void;
  pushPlayback?: (sample: PlaybackSample) => boolean;
  pushAudioPlayback?: (report: AudioPlaybackReport) => boolean;
  onExportDiagnostics?: () => void;
}

/** Níveis de zoom da live assistida: 100% → 125% → 150% → 175% → 200%. */
const ZOOM_LEVELS = [1, 1.25, 1.5, 1.75, 2] as const;

export default function StreamViewer({
  stream,
  nickname,
  onClose,
  onOpenSidebar,
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
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
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

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    // Não mexe em digitação: input, textarea e contenteditable ficam de fora.
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
    }
  }, [zoomIn, zoomOut, resetZoom]);

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

  // Hide cursor in fullscreen when mouse inactive
  const containerStyle: React.CSSProperties = isFullscreen && mouseInactive ? { cursor: 'none' } : {};

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Player da live assistida"
      className={`relative w-full h-full flex items-center justify-center rounded-2xl overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
        crtState === 'turning-on' ? 'crt-turn-on' : ''
      } ${crtState === 'turning-off' ? 'crt-turn-off' : ''}`}
    >
      {/* Video — zoom é só transform: o container não muda de tamanho */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ transform: `scale(${ZOOM_LEVELS[zoomIndex]})`, transformOrigin: 'center center' }}
        className={`w-full h-full object-contain bg-black rounded-2xl transition-opacity transition-transform duration-200 ease-out ${isLoading ? 'opacity-0' : 'opacity-100'}`}
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

      {/* Gradient overlay top + bottom (matches Stitch) */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 pointer-events-none transition-opacity duration-300 autohide-ui rounded-2xl" />

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
        <div className="absolute top-16 right-4 z-30 autohide-ui">
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
      <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-surface/80 backdrop-blur-md border border-outline-variant/30 flex items-center gap-2 z-10 autohide-ui">
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

      {/* ── Floating Control Island ── */}
      <div
        className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-30 autohide-ui transition-all duration-300 flex flex-col items-center ${
          mouseInactive ? 'opacity-0 translate-y-6 pointer-events-none' : 'opacity-100 translate-y-0'
        }`}
      >
        {/* Volume Popover */}
        {showVolumeSlider && (
          <div className="mb-3 w-52 bg-[#18191c]/95 backdrop-blur-xl border border-[#272a37] rounded-xl px-3.5 py-3 shadow-2xl flex flex-col gap-2 z-50">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#dbdee1] uppercase tracking-wider select-none">Volume da Live</span>
              <span className="font-label-mono text-[11px] font-semibold text-primary">{Math.round(volume * 100)}%</span>
            </div>
            <div className="flex items-center gap-2.5">
              <button className="text-outline hover:text-white cursor-pointer flex items-center justify-center shrink-0 w-4" onClick={() => commitVolume(volume === 0 ? 0.7 : 0)}>
                <span className="material-symbols-outlined text-[16px]">{volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}</span>
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => commitVolume(parseFloat(e.target.value))}
                className="volume-slider flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, rgb(16, 185, 129) ${volume * 100}%, rgb(53, 55, 60) ${volume * 100}%)`
                }}
              />
              <span className="material-symbols-outlined text-[16px] text-[#dbdee1] select-none shrink-0 w-4">volume_up</span>
            </div>
          </div>
        )}

        {/* Toolbar Buttons Pill (Stitch: rounded-full bg-black/75) */}
        <div className="px-2.5 py-1.5 rounded-full bg-black/75 backdrop-blur-xl border border-white/10 shadow-2xl flex items-center gap-1.5">
          {/* Sidebar toggle */}
          <ControlButton icon="dock_to_right" title="Abrir menu lateral" onClick={onOpenSidebar} />

          <Divider />

          {/* Play/Pause */}
          <ControlButton
            icon={isPaused ? 'play_arrow' : 'pause'}
            title={isPaused ? 'Reproduzir' : 'Pausar'}
            onClick={togglePause}
          />

          {/* Volume split button (Stitch: mute + chevron) */}
          <div className="flex items-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors">
            <button
              className="w-7 h-7 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
              onClick={() => commitVolume(volume === 0 ? 0.7 : 0)}
              title="Silenciar / Ativar Áudio"
              aria-label="Silenciar ou ativar o áudio da live"
            >
              <span className="material-symbols-outlined text-[18px]">
                {volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}
              </span>
            </button>
            <button
              className="h-7 px-1 flex items-center justify-center text-white/80 hover:text-white border-l border-white/10 transition-colors cursor-pointer"
              onClick={() => setShowVolumeSlider(!showVolumeSlider)}
              title="Ajustar Volume"
              aria-label="Ajustar o volume da live"
            >
              <span className="material-symbols-outlined text-[13px]">expand_less</span>
            </button>
          </div>

          <Divider />

          {/* Zoom — só visual, não toca em captura, áudio, SDP nem diagnóstico */}
          <ControlButton
            icon="zoom_out"
            title="Diminuir zoom (tecla -)"
            onClick={zoomOut}
            disabled={zoomIndex === 0}
          />

          <span
            className="min-w-[40px] text-center font-label-mono text-[11px] font-semibold text-primary select-none"
            title="Zoom atual"
            aria-live="polite"
          >
            {Math.round(ZOOM_LEVELS[zoomIndex] * 100)}%
          </span>

          <ControlButton
            icon="zoom_in"
            title="Aumentar zoom (tecla +)"
            onClick={zoomIn}
            disabled={zoomIndex === ZOOM_LEVELS.length - 1}
          />

          <ControlButton
            icon="fit_screen"
            title="Restaurar zoom (tecla 0)"
            onClick={resetZoom}
            disabled={zoomIndex === 0}
          />

          <Divider />

          {/* Stats (Stitch icon: info) */}
          <ControlButton icon="info" title="Estatísticas" onClick={() => setShowStats(!showStats)} active={showStats} />

          {/* Fullscreen */}
          <ControlButton
            icon={isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
            title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            onClick={toggleFullscreen}
          />

          {/* Close */}
          <ControlButton icon="close" title="Fechar transmissão" onClick={handleClose} danger />
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ── */

function ControlButton({
  icon,
  title,
  onClick,
  active,
  danger,
  disabled,
}: {
  icon: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent ${
        danger
          ? 'text-white/80 hover:text-error hover:bg-error-container/20 ml-0.5'
          : active
          ? 'text-primary bg-white/10'
          : 'text-white/80 hover:text-white hover:bg-white/10'
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
    </button>
  );
}

function Divider() {
  return <div className="h-4 w-[1px] bg-white/15 mx-0.5" />;
}
