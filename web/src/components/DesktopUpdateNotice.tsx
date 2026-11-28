interface DesktopUpdateNoticeProps {
  version: string;
  installing: boolean;
  progress: number | null;
  error: string | null;
  onUpdate: () => void;
}

/** Release nova do .exe. A troca só começa quando a pessoa pede. */
export default function DesktopUpdateNotice({
  version,
  installing,
  progress,
  error,
  onUpdate,
}: DesktopUpdateNoticeProps) {
  const percent = progress === null ? null : Math.min(100, Math.round(progress * 100));
  const label = installing
    ? (percent === null ? 'Baixando…' : `Baixando ${percent}%`)
    : 'Atualizar aplicativo agora';

  return (
    <div
      role="status"
      className="fixed top-3 left-1/2 z-[80] -translate-x-1/2 flex flex-wrap items-center justify-center gap-2.5 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-primary/40 bg-[#0c0e13]/95 px-3 py-2 text-on-surface shadow-[0_8px_28px_rgba(16,185,129,0.18)] backdrop-blur-md"
    >
      <span className="material-symbols-outlined text-primary text-[18px] leading-none shrink-0" aria-hidden="true">system_update</span>
      <p className="text-[13px] font-medium leading-snug">Versão {version} do aplicativo</p>
      <button
        type="button"
        onClick={onUpdate}
        disabled={installing}
        className="h-8 px-3 rounded-full bg-primary text-on-primary text-[12px] font-semibold cursor-pointer disabled:cursor-wait disabled:opacity-80 focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        {label}
      </button>
      {error && <p className="basis-full text-center text-[12px] text-amber-200/90">{error}</p>}
    </div>
  );
}
