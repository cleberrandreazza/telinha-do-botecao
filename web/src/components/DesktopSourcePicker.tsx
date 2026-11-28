import { useCallback, useEffect, useState } from 'react';
import {
  listCaptureSources,
  openNativeCapture,
  streamConfigForShare,
  type CaptureQuality,
  type CaptureSource,
} from '../lib/nativeCapture';
import type { StreamConfig } from '../lib/webrtc';

interface DesktopSourcePickerProps {
  onCancel: () => void;
  onConfirm: (stream: MediaStream, config: StreamConfig) => void;
}

const QUALITIES: { value: CaptureQuality; label: string }[] = [
  { value: '720', label: '720p' },
  { value: '1080', label: '1080p' },
  { value: 'native', label: 'Nativa' },
];

export default function DesktopSourcePicker({ onCancel, onConfirm }: DesktopSourcePickerProps) {
  const [tab, setTab] = useState<'window' | 'monitor'>('window');
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<CaptureQuality>('1080');
  const [fps, setFps] = useState<30 | 60>(30);
  const [captureAudio, setCaptureAudio] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listCaptureSources();
      setSources(next);
      setSelectedId((current) => (current && next.some((source) => source.id === current && source.kind === tab) ? current : null));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível listar as fontes.');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = sources.filter((source) => source.kind === tab);
  const selected = visible.find((source) => source.id === selectedId) ?? null;

  const transmit = async () => {
    if (!selected || starting) return;
    setStarting(true);
    setError(null);
    const request = {
      sourceId: selected.id,
      kind: selected.kind,
      quality,
      fps,
      captureAudio,
    };
    try {
      const stream = await openNativeCapture(request);
      onConfirm(stream, streamConfigForShare(request));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar a captura.');
      setStarting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-source-title"
        className="flex w-full max-w-4xl max-h-[min(760px,92vh)] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0f1419] shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <h2 id="desktop-source-title" className="font-sans text-base font-semibold text-white">
              Compartilhar tela
            </h2>
            <p className="font-body text-xs text-white/50">Escolha uma janela ou uma tela do computador</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-2 py-1 text-sm text-white/70 hover:bg-white/10 hover:text-white"
          >
            Fechar
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-white/10 bg-[#14191f] px-4 py-2">
          <div className="flex rounded-lg bg-black/30 p-1">
            <TabButton active={tab === 'window'} onClick={() => { setTab('window'); setSelectedId(null); }}>
              Aplicativos
            </TabButton>
            <TabButton active={tab === 'monitor'} onClick={() => { setTab('monitor'); setSelectedId(null); }}>
              Telas
            </TabButton>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || starting}
            className="ml-auto rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-40"
          >
            {loading ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#14191f] p-4">
          {error && (
            <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100" role="status">
              {error}
            </p>
          )}
          {loading && visible.length === 0 ? (
            <p className="py-16 text-center text-sm text-white/50">Buscando miniaturas…</p>
          ) : visible.length === 0 ? (
            <p className="py-16 text-center text-sm text-white/50">
              {tab === 'window' ? 'Nenhuma janela visível.' : 'Nenhuma tela encontrada.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {visible.map((source) => {
                const active = source.id === selected?.id;
                const label = source.appName.trim() || source.title;
                return (
                  <button
                    key={`${source.kind}-${source.id}`}
                    type="button"
                    onClick={() => setSelectedId(source.id)}
                    onDoubleClick={() => {
                      setSelectedId(source.id);
                    }}
                    aria-pressed={active}
                    className={`overflow-hidden rounded-lg text-left transition ${
                      active ? 'ring-2 ring-[#10b981]' : 'ring-1 ring-white/10 hover:ring-white/30'
                    }`}
                  >
                    <div className="aspect-video bg-black">
                      {source.thumbnail ? (
                        <img src={source.thumbnail} alt="" className="h-full w-full object-contain" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-white/40">Sem miniatura</div>
                      )}
                    </div>
                    <div className="bg-[#0f1419] px-2.5 py-2">
                      <div className="truncate text-sm font-medium text-white">{label}</div>
                      <div className="truncate text-[11px] text-white/45">
                        {source.title !== label ? `${source.title} · ` : ''}
                        {source.width}x{source.height}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 bg-[#0f1419] px-4 py-3">
          <Segmented
            label="Qualidade"
            value={quality}
            options={QUALITIES}
            onChange={setQuality}
          />
          <Segmented
            label="FPS"
            value={String(fps)}
            options={[{ value: '30', label: '30' }, { value: '60', label: '60' }]}
            onChange={(value) => setFps(value === '60' ? 60 : 30)}
          />
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={captureAudio}
              onChange={(event) => setCaptureAudio(event.target.checked)}
              className="accent-[#10b981]"
            />
            Compartilhar áudio
          </label>
          <button
            type="button"
            onClick={() => void transmit()}
            disabled={!selected || starting}
            className="ml-auto rounded-lg bg-[#10b981] px-4 py-2 text-sm font-semibold text-white hover:bg-[#059669] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? 'Conectando…' : 'Transmitir agora'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        active ? 'bg-[#10b981] text-white' : 'text-white/70 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">{label}</span>
      <div className="flex rounded-lg bg-[#14191f] p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              value === option.value ? 'bg-[#10b981] text-white' : 'text-white/70 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
