import type { GridMode } from '../lib/types';
import { GRID_MODES } from '../lib/grid';

interface GridModeSelectorProps {
  /** Modo atual da grade. */
  value: GridMode;
  /** Chamado quando o usuário escolhe outro modo. */
  onChange: (mode: GridMode) => void;
}

/** Rótulo acessível de cada modo (o botão mostra só o número). */
const MODE_LABEL: Record<GridMode, string> = {
  1: '1 tela',
  2: '2 telas',
  4: '4 telas',
};

/**
 * Seletor segmentado do modo da grade (1 | 2 | 4).
 *
 * Fica na barra do palco, ao lado do contador de transmissões. O botão
 * ativo é o único com destaque; os outros ficam no tom de outline.
 */
export default function GridModeSelector({ value, onChange }: GridModeSelectorProps) {
  return (
    <div
      role="group"
      aria-label="Telas por página"
      className="flex items-center gap-1 p-1 rounded-xl bg-surface-container/80 border border-outline-variant/20"
    >
      {GRID_MODES.map((mode) => {
        const active = mode === value;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            aria-label={MODE_LABEL[mode]}
            aria-pressed={active}
            title={MODE_LABEL[mode]}
            className={`w-8 h-7 rounded-lg text-[11px] font-label-mono font-bold transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60 ${
              active
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-outline border border-transparent hover:text-on-surface hover:bg-white/5'
            }`}
          >
            {mode}
          </button>
        );
      })}
    </div>
  );
}
