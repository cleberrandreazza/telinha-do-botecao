import { useState, useRef, useEffect, useCallback } from 'react';

interface StreamViewerProps {
  stream: MediaStream;
  nickname: string;
  onClose: () => void;
  onOpenSidebar: () => void;
  mouseInactive: boolean;
  volume: number;
  onVolumeChange: (v: number) => void;
}

export default function StreamViewer({
  stream,
  nickname,
  onClose,
  onOpenSidebar,
  mouseInactive,
  volume,
  onVolumeChange,
}: StreamViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [crtState, setCrtState] = useState<'turning-on' | 'on' | 'turning-off' | 'off'>('turning-on');
  const [isLoading, setIsLoading] = useState(true);
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
      video.srcObject = stream;

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
        video.removeEventListener('playing', onPlaying);
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

  // ── Volume ──
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = volume === 0;
    }
  }, [volume]);

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

  // ── Stats from track ──
  const videoTrack = stream.getVideoTracks()[0];
  const settings = videoTrack?.getSettings();
  const statsText = settings
    ? `${settings.width || '?'}×${settings.height || '?'} · ${settings.frameRate?.toFixed(0) || '?'}fps`
    : '';

  // Hide cursor in fullscreen when mouse inactive
  const containerStyle: React.CSSProperties = isFullscreen && mouseInactive ? { cursor: 'none' } : {};

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      className={`relative w-full h-full flex items-center justify-center rounded-2xl overflow-hidden ${
        crtState === 'turning-on' ? 'crt-turn-on' : ''
      } ${crtState === 'turning-off' ? 'crt-turn-off' : ''}`}
    >
      {/* Video */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`w-full h-full object-contain bg-black rounded-2xl transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
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

      {/* Stats Panel (top-right, Stitch full panel) */}
      {showStats && (
        <div className="absolute top-16 right-4 z-30 bg-black/85 backdrop-blur-xl border border-white/10 rounded-xl p-3 shadow-2xl text-[11px] font-label-mono text-[#dbdee1] flex flex-col gap-1.5 autohide-ui">
          <div className="flex items-center justify-between pb-1 border-b border-white/10 text-primary font-bold">
            <span className="text-[10px] uppercase tracking-wider">Estatísticas</span>
            <button className="text-white/60 hover:text-white cursor-pointer ml-4" onClick={() => setShowStats(false)}>
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
          <div className="flex items-center justify-between gap-4"><span>Resolução:</span><span className="text-white font-medium">{settings?.width || '?'}x{settings?.height || '?'}</span></div>
          <div className="flex items-center justify-between gap-4"><span>Framerate:</span><span className="text-white font-medium">{settings?.frameRate?.toFixed(0) || '?'} FPS</span></div>
          <div className="flex items-center justify-between gap-4"><span>Bitrate:</span><span className="text-white font-medium">—</span></div>
          <div className="flex items-center justify-between gap-4"><span>Codec:</span><span className="text-white font-medium">VP9 / Opus</span></div>
          <div className="flex items-center justify-between gap-4"><span>Latência:</span><span className="text-primary font-medium">—</span></div>
        </div>
      )}

      {/* Streamer name badge (top-left) */}
      <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-surface/80 backdrop-blur-md border border-outline-variant/30 flex items-center gap-2 z-10 autohide-ui">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-[12px] font-body text-on-surface font-medium">{nickname}</span>
      </div>

      {/* ── Floating Control Island ── */}
      <div
        className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-30 autohide-ui transition-all duration-300 flex flex-col items-center ${
          mouseInactive ? 'opacity-0 translate-y-6 pointer-events-none' : 'opacity-100 translate-y-0'
        }`}
      >
        {/* Volume Popover */}
        {showVolumeSlider && (
          <div className="mb-3 w-48 bg-[#18191c]/95 backdrop-blur-xl border border-[#272a37] rounded-xl p-3 shadow-2xl flex flex-col gap-2 z-50">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#dbdee1] uppercase tracking-wider select-none">Volume da Live</span>
              <span className="font-label-mono text-[11px] font-semibold text-primary">{Math.round(volume * 100)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="text-outline hover:text-white cursor-pointer flex items-center justify-center" onClick={() => onVolumeChange(volume === 0 ? 0.7 : 0)}>
                <span className="material-symbols-outlined text-[16px]">{volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}</span>
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                className="flex-1 h-1.5 bg-[#35373c] rounded-full appearance-none cursor-pointer accent-primary"
              />
              <span className="material-symbols-outlined text-[16px] text-[#dbdee1] select-none">volume_up</span>
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
              onClick={() => onVolumeChange(volume === 0 ? 0.7 : 0)}
              title="Silenciar / Ativar Áudio"
            >
              <span className="material-symbols-outlined text-[18px]">
                {volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}
              </span>
            </button>
            <button
              className="h-7 px-1 flex items-center justify-center text-white/80 hover:text-white border-l border-white/10 transition-colors cursor-pointer"
              onClick={() => setShowVolumeSlider(!showVolumeSlider)}
              title="Ajustar Volume"
            >
              <span className="material-symbols-outlined text-[13px]">expand_less</span>
            </button>
          </div>

          <Divider />

          {/* Stats (Stitch icon: info) */}
          <ControlButton icon="info" title="Estatisticas" onClick={() => setShowStats(!showStats)} active={showStats} />

          {/* Fullscreen */}
          <ControlButton
            icon={isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
            title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            onClick={toggleFullscreen}
          />

          {/* Close */}
          <ControlButton icon="close" title="Fechar transmissao" onClick={handleClose} danger />
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
}: {
  icon: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
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
