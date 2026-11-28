import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import StreamControls, { ZOOM_LEVELS } from './StreamControls';
import StatsPanel from './StatsPanel';
import { useZoomPan } from '../lib/useZoomPan';
import {
  PlaybackMonitor,
  type AudioPlaybackReport,
  type DiagnosticsSnapshot,
  type PlaybackSample,
} from '../lib/diagnostics/index';

interface StreamTileProps {
  /** Stream de vídeo mostrada neste tile. */
  stream: MediaStream;
  /** Apelido de quem transmite. */
  nickname: string;
  /** Estado de mudo deste tile (o volume mora no tile). */
  muted: boolean;
  /** Estado de volume 0..1 deste tile. */
  volume: number;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
  /** Entra ou sai do modo teatro (a stream ocupa a grade inteira). */
  onTheater?: () => void;
  /** Esta stream está em modo teatro. */
  theater?: boolean;
  /** Para de assistir este tile (fecha a recepção daquela live). */
  onStopWatching?: () => void;
  /** Assina o diagnóstico desta recepção. Sem ele, o botão não aparece. */
  subscribeStats?: (cb: (snapshot: DiagnosticsSnapshot) => void) => () => void;
  /** Entrega a reprodução medida neste vídeo. Sem monitor, o painel fica n/d. */
  pushPlayback?: (sample: PlaybackSample) => boolean;
  pushAudioPlayback?: (report: AudioPlaybackReport) => boolean;
  onExportDiagnostics?: () => void;
  /** Fator de zoom local do tile (1 = 100%). */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  /** O tile ocupa a célula inteira da grade (sem proporção 16:9 fixa). */
  fill?: boolean;
  /** Live pausada neste tile (congela o quadro e corta o áudio). */
  paused?: boolean;
  /** Alterna pausa/reprodução deste tile. */
  onTogglePause: () => void;
}

/**
 * Tile compacto de uma transmissão dentro da grade.
 *
 * O tile é a imagem E o som daquele transmissor enquanto a grade está na
 * tela: o `<video>` toca o áudio da própria stream, com volume e mudo por
 * tile (padrão: mudo, para a grade não sair tocando 4 áudios juntos). Ao
 * focar a stream, o tile é desmontado e o `StreamViewer` assume o áudio —
 * nunca existem dois caminhos de áudio para a mesma stream ao mesmo tempo.
 *
 * Os controles são o mesmo menu unificado do player de 1 tela
 * (`StreamControls`), aqui revelados no hover/foco do tile.
 */
export default function StreamTile({
  stream,
  nickname,
  muted,
  volume,
  onToggleMute,
  onVolumeChange,
  onTheater,
  theater = false,
  onStopWatching,
  subscribeStats,
  pushPlayback,
  pushAudioPlayback,
  onExportDiagnostics,
  zoom,
  onZoomChange,
  fill = false,
  paused = false,
  onTogglePause,
}: StreamTileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [internalZoom, setInternalZoom] = useState(1);
  const [showStats, setShowStats] = useState(false);
  const [tileFullscreen, setTileFullscreen] = useState(false);
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [livePlayback, setLivePlayback] = useState<PlaybackSample | null>(null);
  const [liveAudio, setLiveAudio] = useState<AudioPlaybackReport | null>(null);
  const showStatsRef = useRef(false);
  const latestPlayback = useRef<PlaybackSample | null>(null);
  const subscribeRef = useRef(subscribeStats);
  const pushPlaybackRef = useRef(pushPlayback);
  const pushAudioRef = useRef(pushAudioPlayback);
  const exportRef = useRef(onExportDiagnostics);
  showStatsRef.current = showStats;
  subscribeRef.current = subscribeStats;
  pushPlaybackRef.current = pushPlayback;
  pushAudioRef.current = pushAudioPlayback;
  exportRef.current = onExportDiagnostics;

  // O zoom pode vir controlado pelo Room (por peerId) ou ficar no tile.
  const currentZoom = zoom ?? internalZoom;

  useEffect(() => {
    const onChange = () => setTileFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    const node = containerRef.current;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void node.requestFullscreen();
  };

  // Zoom + arrasto: o pan é local do tile e nunca deixa a imagem sair do quadro.
  const { pan, dragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } = useZoomPan(containerRef, currentZoom);

  // ── Bind do stream no vídeo ──
  // O autoplay não pode furar a pausa: enquanto o tile está pausado, o
  // `<video>` fica congelado (e sem som) até o usuário mandar reproduzir.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const audioBlockedRef = useRef(false);
  const playErrorRef = useRef<string | null>(null);

  const playVideo = (video: HTMLVideoElement) => {
    if (pausedRef.current) return;
    void video.play().then(() => {
      audioBlockedRef.current = false;
      playErrorRef.current = null;
    }).catch((error: unknown) => {
      audioBlockedRef.current = true;
      playErrorRef.current = error instanceof Error && error.message ? error.message : 'reprodução bloqueada';
    });
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    const play = () => playVideo(video);
    play();
    video.addEventListener('loadedmetadata', play);
    return () => video.removeEventListener('loadedmetadata', play);
  }, [stream]);

  // ── Pausa/reprodução do tile ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) {
      video.pause();
    } else {
      void playVideo(video);
    }
  }, [paused, stream]);

  // ── Áudio do tile: mudo e volume desta stream ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = muted ? 0 : Math.min(1, Math.max(0, volume));
  }, [muted, volume, stream]);

  // Reprodução medida neste vídeo. O que o monitor não aceita fica no painel
  // aberto; campo ausente continua n/d, sem copiar outra métrica.
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
        blocked: audioBlockedRef.current,
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
    const subscribe = subscribeRef.current;
    if (!subscribe) return;
    let active = true;
    const unsubscribe = subscribe((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [showStats]);

  const applyZoom = (next: number) => {
    const clamped = Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], Math.max(1, next));
    setInternalZoom(clamped);
    onZoomChange?.(clamped);
  };

  return (
    <div
      ref={containerRef}
      aria-label={`Transmissão de ${nickname}`}
      className={`relative rounded-2xl overflow-hidden bg-black border border-[#272a37] shadow-2xl group ${
        fill ? 'h-full w-full min-h-0' : 'aspect-video'
      }`}
    >
      {/* O vídeo do tile é mudo por padrão; o som de cada transmissor é
          ligado no próprio tile (ver o botão de volume no rodapé). */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${currentZoom})`,
          transformOrigin: 'center center',
          touchAction: currentZoom > 1 ? 'none' : undefined,
          cursor: currentZoom > 1 ? (dragging ? 'grabbing' : 'grab') : undefined,
        }}
        className={`w-full h-full object-contain bg-black ${
          dragging ? '' : 'transition-transform duration-200 ease-out'
        }`}
      />

      {/* Overlay de pausa: quadro congelado + aviso no centro do tile */}
      {paused && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center z-10 pointer-events-none autohide-ui">
          <div className="flex flex-col items-center gap-2">
            <span className="w-14 h-14 rounded-full bg-black/70 flex items-center justify-center">
              <span className="material-symbols-outlined text-[28px] text-on-surface">play_circle</span>
            </span>
            <span className="text-[11px] font-label-mono font-bold text-on-surface uppercase tracking-wider leading-none text-center -mr-[0.05em]">
              Transmissão Pausada
            </span>
          </div>
        </div>
      )}

      {/* Badge do transmissor (topo-esquerdo) */}
      <div className="absolute top-2 left-2 h-6 px-2 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 flex items-center gap-1.5 z-10 pointer-events-none autohide-ui">
        <span className="w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse shrink-0" />
        <span className="text-[12px] font-body text-on-surface font-medium leading-none truncate max-w-[110px]">{nickname}</span>
      </div>

      {onTheater && (
        <button
          type="button"
          onClick={onTheater}
          aria-pressed={theater}
          aria-label={theater ? 'Voltar à grade' : 'Modo teatro'}
          className={`absolute top-2 right-2 z-20 w-9 h-9 sm:w-8 sm:h-8 rounded-lg bg-black/70 backdrop-blur-md border flex items-center justify-center transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60 autohide-ui ${
            theater
              ? 'text-primary border-primary/40 hover:border-primary/60'
              : 'text-on-surface border-white/10 hover:text-primary hover:border-primary/40'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">{theater ? 'grid_view' : 'theaters'}</span>
        </button>
      )}

      {/* Controles do rodapé — mesmo menu do player de 1 tela, no hover/foco */}
      <div className="absolute bottom-2 inset-x-2 flex items-center justify-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto focus-within:pointer-events-auto transition-opacity z-10 autohide-ui">
        <StreamControls
          nickname={nickname}
          muted={muted}
          volume={volume}
          onVolumeChange={onVolumeChange}
          onToggleMute={onToggleMute}
          paused={paused}
          onTogglePause={onTogglePause}
          zoom={currentZoom}
          onZoomChange={applyZoom}
          fullscreen={tileFullscreen}
          onToggleFullscreen={toggleFullscreen}
          onShowStats={subscribeStats ? () => setShowStats((open) => !open) : undefined}
          statsActive={showStats}
          onStopWatching={onStopWatching}
        />
      </div>

      {showStats && createPortal(
        <div className="fixed top-16 right-4 z-50">
          <StatsPanel
            snapshot={snapshot}
            trackRequestedFps={typeof stream.getVideoTracks()[0]?.getSettings().frameRate === 'number' ? stream.getVideoTracks()[0].getSettings().frameRate : null}
            livePlayback={snapshot?.sample.playback ?? livePlayback}
            liveAudio={snapshot?.sample.audio ? null : liveAudio}
            onClose={() => setShowStats(false)}
            onExport={() => exportRef.current?.()}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
