import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { describeCapture, readTrackSettings } from '../lib/diagnostics/index';
import { clampBoxPosition } from '../lib/utils';
import { loadLocalPreviewPosition, saveLocalPreviewPosition } from '../lib/session';

/** Folga entre o preview e a borda do palco. */
const STAGE_MARGIN = 8;

interface LocalPreviewProps {
  stream: MediaStream | null;
  nickname: string;
  /** Palco que limita o preview (o `main` da sala). */
  stageRef?: RefObject<HTMLElement | null>;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

/**
 * Preview local de quem transmite: mostra a própria captura antes/durante
 * a live e a resolução real da track. Medida ausente fica "n/d".
 *
 * O preview é arrastável (pela faixa de baixo, com "Sua transmissão ·
 * apelido"), fica sempre dentro do palco e a posição é lembrada na
 * sessão. O botão de pausa congela apenas o vídeo local — o áudio nunca
 * toca, porque o `<video>` segue sempre `muted`.
 */
export default function LocalPreview({ stream, nickname, stageRef }: LocalPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [capture, setCapture] = useState('n/d');
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [positioned, setPositioned] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [paused, setPaused] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const positionRef = useRef(position);
  positionRef.current = position;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  /** Mede o palco e a caixa do preview (px). */
  const measure = useCallback(() => {
    const stage = stageRef?.current ?? null;
    const box = boxRef.current;
    if (!stage || !box) return null;
    return {
      stage: { width: stage.clientWidth, height: stage.clientHeight },
      box: { width: box.offsetWidth, height: box.offsetHeight },
    };
  }, [stageRef]);

  /** Primeira colocação: canto inferior direito, ou a posição da sessão. */
  const placeInitial = useCallback(() => {
    const sizes = measure();
    if (!sizes) return false;
    const saved = loadLocalPreviewPosition();
    const fallback = {
      x: sizes.stage.width - sizes.box.width - STAGE_MARGIN,
      y: sizes.stage.height - sizes.box.height - STAGE_MARGIN,
    };
    setPosition(clampBoxPosition(saved ?? fallback, sizes.box, sizes.stage, STAGE_MARGIN));
    setPositioned(true);
    return true;
  }, [measure]);

  useLayoutEffect(() => {
    placeInitial();
  }, [placeInitial]);

  // Reserva: se o palco ainda não estava medido, tenta de novo.
  useEffect(() => {
    if (!positioned) placeInitial();
  }, [positioned, placeInitial]);

  // Janela redimensionada: o preview continua dentro do palco.
  useEffect(() => {
    const onResize = () => {
      const sizes = measure();
      if (!sizes) return;
      setPosition((current) => clampBoxPosition(current, sizes.box, sizes.stage, STAGE_MARGIN));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  // Liga a stream local no <video> (sem áudio, para não ecoar a própria voz)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      if (!pausedRef.current) {
        void video.play().catch(() => { /* autoplay bloqueado: o preview volta no próximo gesto */ });
      }
    }
  }, [stream]);

  // O preview local nunca emite áudio (evita eco na sala).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
  }, [stream]);

  // Resolução e fps medidos na track — nada é estimado
  useEffect(() => {
    if (!stream) {
      setCapture('n/d');
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      setCapture('n/d');
      return;
    }
    const read = () => {
      let settings = null;
      try {
        settings = readTrackSettings(track.getSettings() as Record<string, unknown>);
      } catch {
        settings = null;
      }
      setCapture(describeCapture(settings));
    };
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [stream]);

  if (!stream) return null;

  // ── Arrasto pela faixa de baixo ──
  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: positionRef.current.x,
      originY: positionRef.current.y,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const sizes = measure();
    if (!sizes) return;
    const next = clampBoxPosition(
      {
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY),
      },
      sizes.box,
      sizes.stage,
      STAGE_MARGIN,
    );
    positionRef.current = next;
    setPosition(next);
  };

  const onHandlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    saveLocalPreviewPosition(positionRef.current);
  };

  // ── Pausa do vídeo local (o áudio nunca toca) ──
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

  return (
    <div
      ref={boxRef}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      className={`absolute left-0 top-0 z-30 w-56 sm:w-64 rounded-2xl overflow-hidden border border-[#1f222e] bg-[#111318]/95 backdrop-blur-xl shadow-2xl ${
        positioned ? '' : 'opacity-0'
      }`}
    >
      <div className="relative aspect-video bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-contain"
        />
        <div className="absolute inset-0 crt-scanlines pointer-events-none opacity-20" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_45%,rgba(0,0,0,0.6)_100%)] pointer-events-none" />

        {/* Badge: ao vivo (vermelho pulsante) / pausado (âmbar, sem pulso) */}
        {paused ? (
          <span
            title="pausado • sem som"
            className="absolute top-1.5 left-2 flex items-center gap-1.5 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] font-label-mono uppercase tracking-wider text-amber-300"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            pausado
          </span>
        ) : (
          <span className="absolute top-1.5 left-2 flex items-center gap-1.5 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] font-label-mono uppercase tracking-wider text-red-400">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            ao vivo
          </span>
        )}

        {/* Pausar: congela só o vídeo local (o áudio nunca toca) */}
        <button
          type="button"
          onClick={togglePaused}
          title={paused ? 'Reproduzir o preview (sem som)' : 'Pausar o preview (sem som)'}
          aria-label={paused ? 'Reproduzir o preview local' : 'Pausar o preview local'}
          className="absolute top-1.5 right-2 w-7 h-7 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 flex items-center justify-center text-on-surface hover:text-primary hover:border-primary/40 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60 z-10"
        >
          <span className="material-symbols-outlined text-[16px]">{paused ? 'play_circle' : 'pause'}</span>
        </button>
      </div>

      {/* Faixa de arrasto (24px): "Sua transmissão · apelido" + resolução medida */}
      <div
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        title="Arrastar o preview"
        aria-label="Arrastar o preview local"
        className={`flex items-center justify-between gap-2 h-6 px-2.5 border-t border-[#1f222e] touch-none select-none ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <span className="text-[10px] text-on-surface font-medium truncate">
          Sua transmissão <span className="text-outline">· {nickname}</span>
        </span>
        <span className="font-label-mono text-[10px] text-primary shrink-0">{capture}</span>
      </div>
    </div>
  );
}
