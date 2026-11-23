import { useEffect, useRef, useState } from 'react';

/** Níveis de zoom do tile: 100% → 125% → 150% → 175% → 200%. */
const ZOOM_LEVELS = [1, 1.25, 1.5, 1.75, 2] as const;

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
  /** Oculta a stream da grade (local, nunca derruba a transmissão de outra pessoa). */
  onRemove?: () => void;
  /** Abre o StatsPanel sobre este tile. */
  onShowStats?: () => void;
  /** Fator de zoom local do tile (1 = 100%). */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
}

/** "1x", "1,25x", "1,5x" — número no formato brasileiro com o "x" do zoom. */
function formatZoom(value: number): string {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`;
}

/** Classe dos botões da moldura CRT: alvo de toque ok, foco sempre visível. */
const TILE_BUTTON =
  'w-7 h-7 rounded-full flex items-center justify-center text-on-surface hover:text-white hover:bg-white/10 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent';

/**
 * Tile compacto de uma transmissão dentro da grade.
 *
 * O tile é a imagem E o som daquele transmissor enquanto a grade está na
 * tela: o `<video>` toca o áudio da própria stream, com volume e mudo por
 * tile (padrão: mudo, para a grade não sair tocando 4 áudios juntos). Ao
 * focar a stream, o tile é desmontado e o `StreamViewer` assume o áudio —
 * nunca existem dois caminhos de áudio para a mesma stream ao mesmo tempo.
 */
export default function StreamTile({
  stream,
  nickname,
  muted,
  volume,
  onToggleMute,
  onVolumeChange,
  onFocus,
  onRemove,
  onShowStats,
  zoom,
  onZoomChange,
}: StreamTileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [internalZoom, setInternalZoom] = useState(1);

  // O zoom pode vir controlado pelo Room (por peerId) ou ficar no tile.
  const currentZoom = zoom ?? internalZoom;

  // ── Bind do stream no vídeo ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    const play = () => { void video.play().catch(() => {}); };
    play();
    video.addEventListener('loadedmetadata', play);
    return () => video.removeEventListener('loadedmetadata', play);
  }, [stream]);

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

  const zoomIndex = Math.max(0, ZOOM_LEVELS.findIndex((level) => level === currentZoom));
  const isMuted = muted || volume <= 0;
  const volumeIcon = isMuted ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up';

  return (
    <div
      ref={containerRef}
      aria-label={`Transmissão de ${nickname}`}
      className="relative rounded-2xl overflow-hidden bg-black border border-[#272a37] shadow-2xl aspect-video group"
    >
      {/* O vídeo do tile é mudo por padrão; o som de cada transmissor é
          ligado no próprio tile (ver o botão de volume no rodapé). */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        style={{ transform: `scale(${currentZoom})`, transformOrigin: 'center center' }}
        className="w-full h-full object-contain bg-black transition-transform duration-200 ease-out"
      />

      {/* Scanlines da moldura CRT por cima do vídeo */}
      <div className="absolute inset-0 crt-scanlines opacity-20 pointer-events-none" />

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

      {/* Controles do rodapé — escondidos até hover/foco */}
      <div className="absolute bottom-2 inset-x-2 rounded-full bg-black/75 backdrop-blur-xl border border-white/10 px-2 py-1 flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto focus-within:pointer-events-auto transition-opacity z-10">
        {/* Áudio */}
        <button
          type="button"
          onClick={onToggleMute}
          title={isMuted ? 'Ativar áudio' : 'Silenciar'}
          aria-label={isMuted ? `Ativar áudio de ${nickname}` : `Silenciar áudio de ${nickname}`}
          className={TILE_BUTTON}
        >
          <span className="material-symbols-outlined text-[16px]">{volumeIcon}</span>
        </button>

        {/* Volume do tile */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={isMuted ? 0 : volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          title="Volume deste transmissor"
          aria-label={`Volume de ${nickname}`}
          className="w-10 sm:w-14 h-1 accent-primary cursor-pointer"
        />

        {/* Zoom: menos */}
        <button
          type="button"
          onClick={() => applyZoom(ZOOM_LEVELS[Math.max(0, zoomIndex - 1)])}
          disabled={zoomIndex === 0}
          title="Diminuir zoom"
          aria-label="Diminuir zoom"
          className={TILE_BUTTON}
        >
          <span className="material-symbols-outlined text-[16px]">zoom_out</span>
        </button>

        {/* Indicador do zoom (clicável = volta para 100%) */}
        <button
          type="button"
          onClick={() => applyZoom(1)}
          title="Voltar ao zoom 100%"
          aria-label={`Zoom ${formatZoom(currentZoom)}. Voltar ao 100%`}
          className="min-w-[38px] h-7 px-1 rounded-full flex items-center justify-center text-[10px] font-label-mono font-bold text-primary hover:bg-white/10 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          {formatZoom(currentZoom)}
        </button>

        {/* Zoom: mais */}
        <button
          type="button"
          onClick={() => applyZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, zoomIndex + 1)])}
          disabled={zoomIndex === ZOOM_LEVELS.length - 1}
          title="Aumentar zoom"
          aria-label="Aumentar zoom"
          className={TILE_BUTTON}
        >
          <span className="material-symbols-outlined text-[16px]">zoom_in</span>
        </button>

        {/* Tela cheia do tile (não da página) */}
        <button
          type="button"
          onClick={() => { void containerRef.current?.requestFullscreen(); }}
          title="Tela cheia deste tile"
          aria-label={`Tela cheia da transmissão de ${nickname}`}
          className={TILE_BUTTON}
        >
          <span className="material-symbols-outlined text-[16px]">fullscreen</span>
        </button>

        {/* Modo foco */}
        <button
          type="button"
          onClick={onFocus}
          title="Abrir em tela cheia"
          aria-label={`Abrir ${nickname} em tela cheia (modo foco)`}
          className={TILE_BUTTON}
        >
          <span className="material-symbols-outlined text-[16px]">zoom_out_map</span>
        </button>

        {/* Diagnóstico do tile (opcional) */}
        {onShowStats && (
          <button
            type="button"
            onClick={onShowStats}
            title="Diagnóstico desta transmissão"
            aria-label={`Diagnóstico da transmissão de ${nickname}`}
            className={TILE_BUTTON}
          >
            <span className="material-symbols-outlined text-[16px]">info</span>
          </button>
        )}

        {/* Fechar: só esconde da grade, não derruba a transmissão */}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Ocultar da grade"
            aria-label={`Ocultar transmissão de ${nickname} da grade`}
            className={`${TILE_BUTTON} hover:text-error`}
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        )}
      </div>
    </div>
  );
}
