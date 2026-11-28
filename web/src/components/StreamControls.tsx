import type { ReactNode } from 'react';

/**
 * Barra inferior do player, no arranjo do YouTube.
 *
 * Esquerda: reproduzir e volume (o slider abre ao lado do alto-falante).
 * Direita: zoom, estatísticas e, por último, tela cheia.
 * O preview e a grade usam a mesma barra; cada um só liga os botões que tem.
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
  /** O player deste botão já está em tela cheia. */
  fullscreen?: boolean;
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
}

function zoomPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
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
  fullscreen = false,
  onShowStats,
  statsActive,
  onShowSettings,
  settingsActive,
  settingsNotice,
  settingsPanel,
  onStopWatching,
  onStopSharing,
  onClose,
}: StreamControlsProps) {
  const isMuted = muted || volume <= 0;
  const volumeIcon = isMuted ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up';
  const zoomIndex = Math.max(0, ZOOM_LEVELS.findIndex((level) => level === zoom));
  const lastIndex = ZOOM_LEVELS.length - 1;
  const shownVolume = isMuted ? 0 : volume;

  return (
    <div data-player-controls className="flex w-full min-w-0 flex-col justify-end">
      {settingsActive && settingsPanel && (
        <div className="mb-2 mr-2 max-h-80 min-h-0 self-end overflow-y-auto rounded-xl bg-[#111318]/95 shadow-2xl backdrop-blur-xl">
          {settingsPanel}
        </div>
      )}

      <div className="flex w-full items-center justify-between gap-2 pb-1.5 pl-2 pr-2 pt-1 sm:pl-3 sm:pr-3">
        <div className="flex min-w-0 items-center gap-0.5">
          <ControlButton
            icon={paused ? 'play_arrow' : 'pause'}
            title={paused ? 'Reproduzir' : 'Pausar'}
            ariaLabel={paused ? `Reproduzir transmissão de ${nickname}` : `Pausar transmissão de ${nickname}`}
            onClick={onTogglePause}
            large
          />

          {onToggleMute && onVolumeChange && (
            <div className="group/volume flex items-center">
              <ControlButton
                icon={volumeIcon}
                title={isMuted ? 'Ativar áudio' : 'Silenciar'}
                ariaLabel={isMuted ? `Ativar áudio de ${nickname}` : `Silenciar áudio de ${nickname}`}
                onClick={onToggleMute}
              />
              <div className="max-w-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover:max-w-24 group-hover:opacity-100 group-hover/volume:max-w-24 group-hover/volume:opacity-100 group-focus-within/volume:max-w-24 group-focus-within/volume:opacity-100">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={shownVolume}
                  onChange={(event) => onVolumeChange(Number(event.target.value))}
                  aria-label={`Volume de ${nickname}`}
                  className="volume-slider mx-1.5 h-1 w-16 cursor-pointer appearance-none rounded-full"
                  style={{
                    background: `linear-gradient(to right, rgb(16, 185, 129) ${shownVolume * 100}%, rgba(255,255,255,0.35) ${shownVolume * 100}%)`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {onZoomChange && (
            <div className="mr-1 flex items-center">
              <ControlButton
                icon="remove"
                title="Diminuir zoom"
                ariaLabel="Diminuir zoom"
                onClick={() => onZoomChange(ZOOM_LEVELS[Math.max(0, zoomIndex - 1)])}
                disabled={zoomIndex === 0}
              />
              <button
                type="button"
                onClick={() => onZoomChange(1)}
                title="Voltar ao 100%"
                aria-label={`Zoom ${zoomPercent(zoom)}. Voltar ao 100%`}
                className="inline-flex h-8 min-w-12 items-center justify-center rounded-md px-1 font-label-mono text-[12px] font-semibold leading-none text-white/90 hover:bg-white/10 hover:text-white cursor-pointer focus-visible:ring-2 focus-visible:ring-white/70"
              >
                {zoomPercent(zoom)}
              </button>
              <ControlButton
                icon="add"
                title="Aumentar zoom"
                ariaLabel="Aumentar zoom"
                onClick={() => onZoomChange(ZOOM_LEVELS[Math.min(lastIndex, zoomIndex + 1)])}
                disabled={zoomIndex === lastIndex}
              />
            </div>
          )}

          {onShowStats && (
            <ControlButton
              icon="info"
              title="Estatísticas"
              ariaLabel={`Estatísticas da transmissão de ${nickname}`}
              onClick={onShowStats}
              active={statsActive}
            />
          )}

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
                <span className="pointer-events-none absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
              )}
            </div>
          )}

          {onStopWatching && (
            <ControlButton
              icon="visibility_off"
              title="Parar de assistir"
              ariaLabel={`Parar de assistir a transmissão de ${nickname}`}
              onClick={onStopWatching}
              danger
            />
          )}

          {onStopSharing && (
            <ControlButton
              icon="stop_screen_share"
              title="Parar transmissão"
              ariaLabel="Parar transmissão"
              onClick={onStopSharing}
              danger
            />
          )}

          {onClose && (
            <ControlButton
              icon="close"
              title="Fechar transmissão"
              ariaLabel="Fechar transmissão"
              onClick={onClose}
              danger
            />
          )}

          {onToggleFullscreen && (
            <ControlButton
              icon={fullscreen ? 'fullscreen_exit' : 'fullscreen'}
              title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              ariaLabel={fullscreen ? 'Sair da tela cheia' : 'Tela cheia da transmissão'}
              onClick={onToggleFullscreen}
              active={fullscreen}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  icon,
  title,
  ariaLabel,
  onClick,
  active,
  danger,
  disabled,
  large,
}: {
  icon: string;
  title: string;
  ariaLabel: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`${large ? 'h-10 w-10' : 'h-8 w-8'} flex items-center justify-center rounded-full transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent ${
        danger
          ? 'text-white/90 hover:bg-white/10 hover:text-white'
          : active
            ? 'bg-white/15 text-white'
            : 'text-white/90 hover:bg-white/10 hover:text-white'
      }`}
    >
      <span className={`material-symbols-outlined ${large ? 'text-[28px]' : 'text-[22px]'}`}>{icon}</span>
    </button>
  );
}
