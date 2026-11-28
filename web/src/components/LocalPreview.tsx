import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import BotecaoIcon from './BotecaoIcon';
import StreamControls from './StreamControls';

interface LocalPreviewProps {
  stream: MediaStream | null;
  nickname: string;
  /** Encerra a transmissão (opção do menu). */
  onStopSharing: () => void;
  /** Configurações da transmissão, abertas pelo menu. */
  settings: ReactNode;
  /** Há um aviso da captura: o ícone de configurações ganha um ponto âmbar. */
  notice?: boolean;
  /** Abre o diagnóstico de quem transmite. */
  onShowStats?: () => void;
  /** O painel de diagnóstico está aberto. */
  statsActive?: boolean;
  /** Pausa o vídeo local sem mudar a pausa que a pessoa escolheu. */
  holdPaused?: boolean;
  /** Classes extras do tile (por exemplo, some no modo teatro). */
  className?: string;
  /** Resolução escolhida, sem o "p" (1080 → "1080p"). */
  resolution?: string;
  /** Taxa de quadros escolhida. */
  frameRate?: number;
}

/**
 * Preview local de quem transmite: a primeira célula da grade, só para quem
 * transmite. Mostra a própria captura.
 *
 * Usa o mesmo menu dos outros players (`StreamControls`), sem som, zoom
 * nem tela cheia. O menu fica sempre visível no rodapé, com Diagnóstico,
 * Configurações e Parar transmissão. O preview entra pausado; a pausa
 * congela só o vídeo local.
 */
export default function LocalPreview({ stream, nickname, onStopSharing, settings, notice = false, onShowStats, statsActive = false, holdPaused = false, className, resolution, frameRate }: LocalPreviewProps) {
  const controlsRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const holdPausedRef = useRef(holdPaused);
  holdPausedRef.current = holdPaused;

  // Liga a stream local no <video> (sem áudio, para não ecoar a própria voz)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.muted = true;
    if (video.srcObject !== stream) video.srcObject = stream;
    if (pausedRef.current || holdPausedRef.current) video.pause();
    else void video.play().catch(() => { /* o play fica para o botão do menu */ });
  }, [stream]);

  // O teatro pausa o preview sem apagar a pausa escolhida no menu.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused || holdPaused) video.pause();
    else void video.play().catch(() => {});
  }, [paused, holdPaused, stream]);

  // Configurações abertas: Esc ou clique fora fecham.
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    const onDown = (event: MouseEvent) => {
      if (controlsRef.current && !controlsRef.current.contains(event.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [settingsOpen]);

  if (!stream) return null;

  const togglePaused = () => {
    const video = videoRef.current;
    if (!video) return;
    if (pausedRef.current) {
      void video.play().catch(() => {});
      setPaused(false);
    } else {
      video.pause();
      setPaused(true);
    }
  };

  const configLabel = resolution && frameRate ? `${resolution}p ${frameRate}fps` : null;

  return (
    <div
      aria-label="Sua transmissão"
      className={`relative h-full w-full min-h-0 flex flex-col rounded-2xl overflow-hidden bg-black border border-[#272a37] shadow-2xl ${className ?? ''}`}
    >
      <div className="relative flex-1 min-h-0 overflow-hidden bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="w-full h-full object-contain bg-black"
        />
        {paused && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center z-10 pointer-events-none">
            <div className="flex flex-col items-center gap-2">
              <span className="w-14 h-14 rounded-full bg-black/70 flex items-center justify-center">
                <BotecaoIcon size={28} />
              </span>
              <span className="text-[11px] font-label-mono font-bold text-on-surface tracking-wider leading-none text-center -mr-[0.05em]">
                preview pausado
              </span>
            </div>
          </div>
        )}

        {/* Selo do preview e, logo abaixo, a configuração escolhida. */}
        <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1.5 pointer-events-none">
          <div className="h-6 px-2 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 motion-safe:animate-pulse shrink-0" />
            <span className="text-[12px] font-body text-on-surface font-medium leading-none truncate max-w-[140px]">Sua transmissão</span>
          </div>
          {configLabel && (
            <div className="h-6 px-2 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 flex items-center">
              <span className="text-[12px] font-label-mono text-on-surface font-medium leading-none">{configLabel}</span>
            </div>
          )}
        </div>

        {/* Menu do preview: sempre visível, sem zoom nem tela cheia */}
        <div className="absolute top-2 bottom-2 inset-x-2 flex flex-col items-center justify-end z-20 pointer-events-none">
          <div ref={controlsRef} className="min-h-0 max-h-full flex flex-col pointer-events-auto">
            <StreamControls
              nickname={nickname}
              paused={paused}
              onTogglePause={togglePaused}
              onShowStats={onShowStats}
              statsActive={statsActive}
              onShowSettings={() => setSettingsOpen((open) => !open)}
              settingsActive={settingsOpen}
              settingsNotice={notice}
              settingsPanel={settings}
              onStopSharing={onStopSharing}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
