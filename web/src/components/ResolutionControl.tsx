import { RESOLUTIONS } from './StreamSettings';

/** Resoluções aceitas pelo encoder (mesma lista do StreamSettings). */
export type StreamResolution = '2160' | '1080' | '720' | '480';

interface ResolutionControlProps {
  /** Resolução selecionada. */
  resolution: StreamResolution;
  /** Resolução medida na captura. null quando o navegador não informa. */
  measured: string | null;
  /** true enquanto a troca está sendo aplicada. */
  busy: boolean;
  /** Chamado com a resolução pedida. */
  onSelect: (resolution: StreamResolution) => void;
  /** Sem relay desktop, 1080p e 4K ficam fora do preset. */
  qualityLimited?: boolean;
}

/**
 * Controle de resolução de quem transmite.
 *
 * A resolução medida vem de fora (diagnóstico real da captura): quando o
 * navegador não informa a faixa capturada, o valor é null e a tela mostra
 * "n/d" — nada é estimado aqui.
 */
export default function ResolutionControl({
  resolution,
  measured,
  busy,
  onSelect,
  qualityLimited = false,
}: ResolutionControlProps) {
  const choices = qualityLimited
    ? RESOLUTIONS.filter((item) => item.value === '720' || item.value === '480')
    : RESOLUTIONS;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-outline font-label-md">
          Resolução
        </span>
        <span
          className="text-[10px] font-label-mono text-primary"
          aria-live="polite"
          aria-label="Resolução medida"
        >
          {busy ? 'Aplicando…' : measured ?? 'n/d'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {choices.map((item) => {
          const active = item.value === resolution;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onSelect(item.value)}
              disabled={busy}
              aria-label={`Resolução ${item.desc}`}
              title={busy ? 'Aplicando a nova resolução…' : `Mudar para ${item.label} (${item.desc})`}
              className={`px-1 py-1.5 rounded-lg border text-center transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-outline-variant/20 bg-surface-container-high/40 text-on-surface hover:bg-surface-container-high hover:border-outline-variant/40'
              }`}
            >
              <span className="block text-[11px] font-label-md font-semibold leading-none">{item.label}</span>
              <span className="block text-[9px] font-label-mono opacity-60 mt-0.5 leading-none">{item.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
