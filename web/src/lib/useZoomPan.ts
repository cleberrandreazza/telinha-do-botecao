import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { clampPan, panLimit, type PanOffset } from './utils';

/**
 * Zoom com arrasto (pan) do vídeo de um player ou tile.
 *
 * Com zoom > 1, arrastar sobre o vídeo move o conteúdo — limitado às
 * bordas do quadro (a imagem nunca sai do quadro). O pan é estado local
 * do componente que usa o hook: não é global.
 */

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

export interface ZoomPan {
  /** Deslocamento atual do conteúdo, em px. */
  pan: PanOffset;
  /** Está arrastando agora? */
  dragging: boolean;
  /** Zera o pan (volta o conteúdo ao centro). */
  resetPan: () => void;
  /** Props para espalhar no elemento do vídeo. */
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
}

export function useZoomPan(
  frameRef: RefObject<HTMLElement | null>,
  zoom: number,
): ZoomPan {
  const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanOffset>({ x: 0, y: 0 });
  panRef.current = pan;

  /** Limite do pan para o quadro atual e o zoom atual. */
  const limitFor = useCallback(() => {
    const frame = frameRef.current;
    return panLimit(frame?.clientWidth ?? 0, frame?.clientHeight ?? 0, zoom);
  }, [frameRef, zoom]);

  // Zoom 1 => sem pan; zoom maior => o pan é re-limitado ao novo tamanho.
  useEffect(() => {
    setPan((current) => {
      if (zoom <= 1) return { x: 0, y: 0 };
      return clampPan(current, limitFor());
    });
  }, [zoom, limitFor]);

  // Redimensionar a janela muda o quadro: o pan é re-limitado.
  useEffect(() => {
    const onResize = () => {
      setPan((current) => (zoom <= 1 ? { x: 0, y: 0 } : clampPan(current, limitFor())));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [zoom, limitFor]);

  const resetPan = useCallback(() => setPan({ x: 0, y: 0 }), []);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (zoom <= 1) return;
    // Só o vídeo começa o arrasto — botões e sliders ficam de fora.
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, a, select, textarea')) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: panRef.current.x,
      originY: panRef.current.y,
    };
    setDragging(true);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }, [zoom]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampPan({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    }, limitFor());
    setPan(next);
  }, [limitFor]);

  const endDrag = useCallback((event: React.PointerEvent) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  }, []);

  return {
    pan,
    dragging,
    resetPan,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
}
