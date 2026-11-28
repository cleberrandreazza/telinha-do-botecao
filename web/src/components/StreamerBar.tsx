import { SOURCE_OPTIONS, sourceLabel, type DisplaySource } from '../lib/sourceSwitch';
import ResolutionControl, { type StreamResolution } from './ResolutionControl';
import { FRAMERATES, type StreamFrameRate } from './StreamSettings';

interface StreamerBarProps {
  /** Superfície capturada de verdade ("browser"/"window"/"monitor") ou null. */
  measuredSurface: string | null;
  /** Pedido de troca de fonte. */
  onSelectSource: (source: DisplaySource) => void;
  /** Resolução selecionada. */
  resolution: StreamResolution;
  /** Resolução medida na captura. null quando o navegador não informa. */
  measuredResolution: string | null;
  /** Chamado com a resolução pedida. */
  onSelectResolution: (resolution: StreamResolution) => void;
  /** Taxa de quadros selecionada. */
  frameRate: StreamFrameRate;
  /** Taxa de quadros medida na captura. null quando o navegador não informa. */
  measuredFrameRate: number | null;
  /** Chamado com a taxa de quadros pedida. */
  onSelectFrameRate: (frameRate: StreamFrameRate) => void;
  /** true enquanto uma mudança está sendo aplicada. */
  busy: boolean;
  /** Aviso com o motivo real de uma falha (faixa âmbar). */
  notice: string | null;
  /** O aviso explica a captura; não é uma falha. */
  informative?: boolean;
  /** Sem relay desktop, a resolução não passa de 720p. */
  qualityLimited?: boolean;
}

/**
 * Configurações de quem transmite — abertas pelo menu do preview local.
 *
 * Reúne as três coisas que o transmissor mexe durante a live: trocar o
 * conteúdo capturado, a resolução e a taxa de quadros.
 *
 * A fonte que aparece como ativa é a MEDIDA (o que o navegador entregou),
 * não a pedida: o seletor nativo é quem decide aba, janela ou tela, e a
 * escolha aqui é só uma dica. Todo número mostrado vem da faixa capturada
 * — sem dado do navegador, "n/d" (docs/diagnostics.md).
 */
export default function StreamerBar({
  measuredSurface,
  onSelectSource,
  resolution,
  measuredResolution,
  onSelectResolution,
  frameRate,
  measuredFrameRate,
  onSelectFrameRate,
  busy,
  notice,
  informative = false,
  qualityLimited = false,
}: StreamerBarProps) {
  const activeSource = measuredSurface ?? null;

  return (
    <div className="flex flex-col gap-2 items-stretch max-w-[min(22rem,calc(100vw-2rem))]">
      {/* Falha: faixa âmbar. Aviso da captura: faixa neutra, não é defeito. */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`px-2.5 py-1.5 rounded-lg border text-[11px] leading-snug ${
            informative
              ? 'bg-surface-container/80 border-outline-variant/30 text-on-surface-variant'
              : 'bg-amber-500/10 border-amber-500/20 text-amber-200/90'
          }`}
        >
          {notice}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-xl bg-[#111318]/95 backdrop-blur-xl border border-[#272a37] p-2">
        {/* ── Trocar conteúdo ── */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-outline font-label-md">
              Trocar conteúdo
            </span>
            <span
              className="text-[10px] font-label-mono text-primary"
              aria-live="polite"
              aria-label="Fonte capturada"
            >
              {busy ? 'Trocando…' : sourceLabel(activeSource)}
            </span>
          </div>
          <div className="flex p-1 rounded-xl bg-[#111318]/95 backdrop-blur-xl border border-[#272a37]">
            {SOURCE_OPTIONS.map((option) => {
              const active = option.value === activeSource;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onSelectSource(option.value)}
                  disabled={busy}
                  aria-label={`Trocar conteúdo: ${option.label}`}
                  aria-pressed={active}
                  title={busy ? 'Aplicando a nova fonte…' : option.hint}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-label-md transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? 'bg-primary/15 text-primary border border-primary/40'
                      : 'border-transparent text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="px-0.5 text-[10px] leading-snug text-outline">
            O navegador decide o que capturar no seletor nativo.
          </p>
        </div>

        {/* ── Qualidade (resolução) ── */}
        <ResolutionControl
          resolution={resolution}
          measured={measuredResolution}
          busy={busy}
          onSelect={onSelectResolution}
          qualityLimited={qualityLimited}
        />

        {/* ── Taxa de quadros ── */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-outline font-label-md">
              Taxa de quadros
            </span>
            <span
              className="text-[10px] font-label-mono text-primary"
              aria-live="polite"
              aria-label="Taxa de quadros medida"
            >
              {busy ? 'Aplicando…' : measuredFrameRate === null ? 'n/d' : `${measuredFrameRate} fps`}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {FRAMERATES.map((item) => {
              const active = item.value === frameRate;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onSelectFrameRate(item.value as StreamFrameRate)}
                  disabled={busy}
                  aria-label={`Taxa de quadros ${item.desc}`}
                  title={busy ? 'Aplicando a nova taxa de quadros…' : `${item.label} — ${item.desc}`}
                  className={`px-1 py-1.5 rounded-lg border text-center transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-outline-variant/20 bg-surface-container-high/40 text-on-surface hover:bg-surface-container-high hover:border-outline-variant/40'
                  }`}
                >
                  <span className="block text-[11px] font-label-md font-semibold leading-none">
                    {item.value}
                  </span>
                  <span className="block text-[9px] font-label-mono opacity-60 mt-0.5 leading-none">
                    {item.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
