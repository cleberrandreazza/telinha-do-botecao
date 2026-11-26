import { useEffect, useRef, useState } from 'react';
import StreamControls, { ZOOM_LEVELS } from './StreamControls';
import { useZoomPan } from '../lib/useZoomPan';

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
  /** Coloca a stream em tela cheia (modo foco). */
  onFocus: () => void;
  /** Para de assistir este tile (fecha a recepção daquela live). */
  onStopWatching?: () => void;
  /** Abre o StatsPanel sobre este tile. */
  onShowStats?: () => void;
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
  onFocus,
  onStopWatching,
  onShowStats,
  zoom,
  onZoomChange,
  fill = false,
  paused = false,
  onTogglePause,
}: StreamTileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [internalZoom, setInternalZoom] = useState(1);

  // O zoom pode vir controlado pelo Room (por peerId) ou ficar no tile.
  const currentZoom = zoom ?? internalZoom;

  // Zoom + arrasto: o pan é local do tile e nunca deixa a imagem sair do quadro.
  const { pan, dragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } = useZoomPan(containerRef, currentZoom);

  // ── Bind do stream no vídeo ──
  // O autoplay não pode furar a pausa: enquanto o tile está pausado, o
  // `<video>` fica congelado (e sem som) até o usuário mandar reproduzir.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    const play = () => { if (pausedRef.current) return; void video.play().catch(() => {}); };
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
      void video.play().catch(() => {});
    }
  }, [paused, stream]);

  // ── Áudio do tile: mudo e volume desta stream ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = muted ? 0 : Math.min(1, Math.max(0, volume));
  }, [muted, volume, stream]);

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

      {/* Scanlines da moldura CRT por cima do vídeo */}
      <div className="absolute inset-0 crt-scanlines opacity-20 pointer-events-none" />

      {/* Overlay de pausa: quadro congelado + aviso no centro do tile */}
      {paused && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center z-10 pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <span className="w-14 h-14 rounded-full bg-black/70 flex items-center justify-center">
              <span className="material-symbols-outlined text-[28px] text-on-surface">play_circle</span>
            </span>
            <span className="text-[11px] font-label-mono font-bold text-on-surface uppercase tracking-wider">
              Transmissão Pausada
            </span>
          </div>
        </div>
      )}

      {/* Badge do transmissor (topo-esquerdo) */}
      <div className="absolute top-2 left-2 px-2 py-1 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 flex items-center gap-1.5 z-10 pointer-events-none">
        <span className="w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
        <span className="text-[9px] font-label-mono font-bold text-primary uppercase tracking-wider">AO VIVO</span>
        <span className="text-[12px] font-body text-on-surface font-medium truncate max-w-[110px]">{nickname}</span>
      </div>

      {/* Expandir (modo foco) — topo-direito */}
      <button
        type="button"
        onClick={onFocus}
        title={`Abrir ${nickname} em tela cheia`}
        aria-label={`Abrir transmissão de ${nickname} em tela cheia`}
        className="absolute top-2 right-2 w-9 h-9 sm:w-8 sm:h-8 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 flex items-center justify-center text-on-surface hover:text-primary hover:border-primary/40 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60 z-10"
      >
        <span className="material-symbols-outlined text-[18px]">open_in_full</span>
      </button>

      {/* Controles do rodapé — mesmo menu do player de 1 tela, no hover/foco */}
      <div className="absolute bottom-2 inset-x-2 flex items-center justify-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto focus-within:pointer-events-auto transition-opacity z-10">
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
          onToggleFullscreen={() => { void containerRef.current?.requestFullscreen(); }}
          onShowStats={onShowStats}
          onStopWatching={onStopWatching}
        />
      </div>
    </div>
  );
}
