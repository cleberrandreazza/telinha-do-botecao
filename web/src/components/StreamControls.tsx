import { useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Menu unificado de player (spec Tela B3).
 *
 * O mesmo componente serve o player de 1 tela (`StreamViewer`), o tile da
 * grade (`StreamTile`) e o preview de quem transmite (`LocalPreview`):
 * mesmo visual, mesmas opções, mesma ordem.
 *
 * Ordem fixa: Som (só com onToggleMute) · Pausar/Reproduzir · Zoom
 * (só com onZoomChange) · Tela cheia (só com onToggleFullscreen) ·
 * Diagnóstico (só com onShowStats) · Configurações (só no preview) ·
 * Parar de assistir (só na grade) · Parar transmissão (só no preview) ·
 * Fechar (só no player de 1 tela).
 */

/** Níveis de zoom: 100% → 125% → 150% → 175% → 200%. */
export const ZOOM_LEVELS = [1, 1.25, 1.5, 1.75, 2] as const;

interface StreamControlsProps {
  /** Apelido de quem transmite (usado nos rótulos acessíveis). */
  nickname: string;
  /** O áudio está mudo? */
  muted?: boolean;
  /** Volume 0..1. */
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  /** Liga/desliga o áudio (o volume continua o último escolhido). Sem ele, não há botão de som. */
  onToggleMute?: () => void;
  /** A imagem está pausada? */
  paused: boolean;
  onTogglePause: () => void;
  /** Fator de zoom atual (1 = 100%). Sem onZoomChange, o preview não mostra zoom. */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  /** Entra/sai da tela cheia do player. Sem ele, o botão não aparece. */
  onToggleFullscreen?: () => void;
  /** Abre o diagnóstico (só quando o player tem subscribeStats). */
  onShowStats?: () => void;
  /** O painel de diagnóstico está aberto? */
  statsActive?: boolean;
  /** Abre/fecha as configurações da transmissão (só no preview). */
  onShowSettings?: () => void;
  /** As configurações estão abertas? */
  settingsActive?: boolean;
  /** Há um aviso da captura: ponto âmbar no ícone de configurações. */
  settingsNotice?: boolean;
  /** Conteúdo das configurações, mostrado acima da barra quando abertas. */
  settingsPanel?: ReactNode;
  /** Para de assistir (só na grade): fecha o receiver daquele peer. */
  onStopWatching?: () => void;
  /** Encerra a própria transmissão (só no preview). */
  onStopSharing?: () => void;
  /** Fecha o player (só no modo 1 tela). */
  onClose?: () => void;
  /** O menu fica no topo do preview: os popovers abrem para baixo. */
  popoverBelow?: boolean;
}

/** "1x", "1,25x", "1,5x" — número no formato brasileiro com o "x" do zoom. */
function formatZoom(value: number): string {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`;
}

export default function StreamControls({
  nickname,
  muted = false,
  volume = 0,
  onVolumeChange,
  onToggleMute,
  paused,
  onTogglePause,
  zoom = 1,
  onZoomChange,
  onToggleFullscreen,
  onShowStats,
  statsActive,
  onShowSettings,
  settingsActive,
  settingsNotice,
  settingsPanel,
  onStopWatching,
  onStopSharing,
  onClose,
  popoverBelow = false,
}: StreamControlsProps) {
  const [showVolume, setShowVolume] = useState(false);
  const [showZoom, setShowZoom] = useState(false);

  const isMuted = muted || volume <= 0;
  const volumeIcon = isMuted ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up';
  const zoomIndex = Math.max(0, ZOOM_LEVELS.findIndex((level) => level === zoom));
  const lastIndex = ZOOM_LEVELS.length - 1;

  const popoverGap = popoverBelow ? 'mt-3' : 'mb-3';
  const zoomPercent = (zoomIndex / lastIndex) * 100;

  const settingsPopover = settingsActive && settingsPanel ? (
    <div className={`${popoverGap} max-h-80 min-h-0 overflow-y-auto rounded-xl bg-[#111318]/95 backdrop-blur-xl shadow-2xl z-50`}>
      {settingsPanel}
    </div>
  ) : null;

  const volumePopover = showVolume && onToggleMute && onVolumeChange ? (
    <div className={`${popoverGap} w-52 bg-[#18191c]/95 backdrop-blur-xl border border-[#272a37] rounded-xl px-3.5 py-3 shadow-2xl flex flex-col gap-2 z-50`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-[#dbdee1] uppercase tracking-wider select-none">Volume da Live</span>
        <span className="font-label-mono text-[11px] font-semibold text-primary">{Math.round(volume * 100)}%</span>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onToggleMute}
          className="text-outline hover:text-white cursor-pointer flex items-center justify-center shrink-0 w-4"
          title={isMuted ? 'Ativar áudio' : 'Silenciar'}
          aria-label={isMuted ? `Ativar áudio de ${nickname}` : `Silenciar áudio de ${nickname}`}
        >
          <span className="material-symbols-outlined text-[16px]">{volumeIcon}</span>
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={isMuted ? 0 : volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          aria-label={`Volume de ${nickname}`}
          className="volume-slider flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, rgb(16, 185, 129) ${(isMuted ? 0 : volume) * 100}%, rgb(53, 55, 60) ${(isMuted ? 0 : volume) * 100}%)`,
          }}
        />
        <span className="material-symbols-outlined text-[16px] text-[#dbdee1] select-none shrink-0 w-4">volume_up</span>
      </div>
    </div>
  ) : null;

  const zoomPopover = showZoom && onZoomChange ? (
    <div className={`${popoverGap} w-52 bg-[#18191c]/95 backdrop-blur-xl border border-[#272a37] rounded-xl px-3.5 py-3 shadow-2xl flex flex-col gap-2 z-50`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-[#dbdee1] uppercase tracking-wider select-none">Zoom</span>
        <span className="font-label-mono text-[11px] font-semibold text-primary">{formatZoom(zoom)}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => onZoomChange(ZOOM_LEVELS[Math.max(0, zoomIndex - 1)])}
          disabled={zoomIndex === 0}
          className="text-outline hover:text-white cursor-pointer flex items-center justify-center shrink-0 w-4 disabled:opacity-35 disabled:cursor-not-allowed"
          aria-label="Diminuir zoom"
        >
          <span className="material-symbols-outlined text-[16px]">zoom_out</span>
        </button>
        <input
          type="range"
          min={0}
          max={lastIndex}
          step={1}
          value={zoomIndex}
          onChange={(e) => onZoomChange(ZOOM_LEVELS[Number(e.target.value)] ?? 1)}
          aria-label="Zoom da transmissão"
          className="volume-slider flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, rgb(16, 185, 129) ${zoomPercent}%, rgb(53, 55, 60) ${zoomPercent}%)`,
          }}
        />
        <button
          type="button"
          onClick={() => onZoomChange(ZOOM_LEVELS[Math.min(lastIndex, zoomIndex + 1)])}
          disabled={zoomIndex === lastIndex}
          className="text-[#dbdee1] hover:text-white cursor-pointer flex items-center justify-center shrink-0 w-4 disabled:opacity-35 disabled:cursor-not-allowed"
          aria-label="Aumentar zoom"
        >
          <span className="material-symbols-outlined text-[16px]">zoom_in</span>
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="flex flex-col items-center min-h-0 max-h-full">
      {!popoverBelow && settingsPopover}
      {!popoverBelow && volumePopover}
      {!popoverBelow && zoomPopover}

      {/* Ilha compacta. O play fica entre o som e o zoom, na mesma ordem em todo player. */}
      <div className="shrink-0 px-2 py-1 rounded-full bg-black/75 backdrop-blur-xl border border-white/10 shadow-2xl flex items-center gap-1">
        <div className="flex items-center gap-1">
        {/* 1. Som — botão split (ícone + chevron abre o popover) */}
        {onToggleMute && (
        <div className="flex items-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors">
          <button
            type="button"
            onClick={onToggleMute}
            className="w-7 h-7 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60"
            title={isMuted ? 'Ativar áudio' : 'Silenciar'}
            aria-label={isMuted ? `Ativar áudio de ${nickname}` : `Silenciar áudio de ${nickname}`}
          >
            <span className="material-symbols-outlined text-[18px]">{volumeIcon}</span>
          </button>
          <button
            type="button"
            onClick={() => { setShowZoom(false); setShowVolume((open) => !open); }}
            className="h-7 px-1 flex items-center justify-center text-white/80 hover:text-white border-l border-white/10 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60"
            title="Ajustar Volume"
            aria-label="Ajustar o volume da live"
          >
            <span className="material-symbols-outlined text-[13px]">expand_less</span>
          </button>
        </div>
        )}
        </div>

        {/* 2. Pausar / Reproduzir — sempre no centro do menu */}
        <ControlButton
          icon={paused ? 'play_circle' : 'pause'}
          title={paused ? 'Reproduzir' : 'Pausar'}
          ariaLabel={paused ? `Reproduzir transmissão de ${nickname}` : `Pausar transmissão de ${nickname}`}
          onClick={onTogglePause}
        />

        <div className="flex items-center gap-1">
        {/* 3. Zoom — lupa + slider, no mesmo estilo do volume */}
        {onZoomChange && (
        <div className="flex items-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors">
          <button
            type="button"
            onClick={() => onZoomChange(1)}
            className="w-7 h-7 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60"
            aria-label={`Zoom ${formatZoom(zoom)}. Voltar ao 100%`}
          >
            <span className="material-symbols-outlined text-[18px]">search</span>
          </button>
          <button
            type="button"
            onClick={() => { setShowVolume(false); setShowZoom((open) => !open); }}
            className="h-7 px-1 flex items-center justify-center text-white/80 hover:text-white border-l border-white/10 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60"
            aria-label="Ajustar o zoom"
          >
            <span className="material-symbols-outlined text-[13px]">{popoverBelow ? 'expand_more' : 'expand_less'}</span>
          </button>
        </div>
        )}

        {/* 4. Tela cheia */}
        {onToggleFullscreen && (
        <ControlButton
          icon="fullscreen"
          title="Tela cheia"
          ariaLabel="Tela cheia da transmissão"
          onClick={onToggleFullscreen}
        />
        )}

        {/* 5. Diagnóstico (só quando o player tem subscribeStats) */}
        {onShowStats && (
          <ControlButton
            icon="info"
            title="Diagnóstico"
            ariaLabel={`Diagnóstico da transmissão de ${nickname}`}
            onClick={onShowStats}
            active={statsActive}
          />
        )}

        {/* 6. Configurações da transmissão (só no preview) */}
        {onShowSettings && (
          <div className="relative">
            <ControlButton
              icon="settings"
              title="Configurações"
              ariaLabel="Configurações da transmissão"
              onClick={onShowSettings}
              active={settingsActive}
            />
            {settingsNotice && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400 pointer-events-none" />
            )}
          </div>
        )}

        {/* 7. Parar de assistir (só na grade) */}
        {onStopWatching && (
          <ControlButton
            icon="visibility_off"
            title="Parar de assistir"
            ariaLabel={`Parar de assistir a transmissão de ${nickname}`}
            onClick={onStopWatching}
            danger
          />
        )}

        {/* 8. Parar transmissão (só no preview) */}
        {onStopSharing && (
          <ControlButton
            icon="stop_screen_share"
            title="Parar transmissão"
            ariaLabel="Parar transmissão"
            onClick={onStopSharing}
            danger
          />
        )}

        {/* 9. Fechar (só no player de 1 tela) */}
        {onClose && (
          <ControlButton
            icon="close"
            title="Fechar transmissão"
            ariaLabel="Fechar transmissão"
            onClick={onClose}
            danger
          />
        )}
        </div>
      </div>

      {popoverBelow && zoomPopover}
      {popoverBelow && volumePopover}
      {popoverBelow && settingsPopover}
    </div>
  );
}

/* ── Helpers ── */

function ControlButton({
  icon,
  title,
  ariaLabel,
  onClick,
  active,
  danger,
  disabled,
}: {
  icon: string;
  title: string;
  ariaLabel: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent ${
        danger
          ? 'text-white/80 hover:text-error hover:bg-error-container/20'
          : active
          ? 'text-primary bg-white/10'
          : 'text-white/80 hover:text-white hover:bg-white/10'
      }`}
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
    </button>
  );
}
