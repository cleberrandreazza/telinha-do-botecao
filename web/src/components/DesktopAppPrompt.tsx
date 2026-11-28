import {
  DESKTOP_APP_BENEFIT,
  DESKTOP_APP_DOWNLOAD_URL,
  DESKTOP_SHARE_PROMPT,
  DESKTOP_VIEWER_HINT,
} from '../lib/desktopPrompt';

const DOWNLOAD_LABEL = 'Baixar App Desktop (Windows)';

export function DesktopDownloadCard() {
  return (
    <section className="mt-4 w-full rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3.5 text-left shadow-lg shadow-emerald-950/20">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-emerald-300">App Desktop para Windows (Portátil)</h2>
          <p className="mt-1 text-xs leading-snug text-slate-300">
            Transmissão nativa 1080p/60fps, áudio isolado por programa e distribuição P2P para até 50 pessoas
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
            Sem instalador • Na primeira abertura, se o Windows alertar, clique em &apos;Mais informações&apos; → &apos;Executar assim mesmo&apos;.
          </p>
        </div>
        <a
          href={DESKTOP_APP_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center justify-center self-center rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2.5 text-sm font-bold leading-none text-slate-950 shadow-glow hover:from-emerald-400 hover:to-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
        >
          Baixar .exe
        </a>
      </div>
    </section>
  );
}

export function DesktopDownloadCapsule() {
  return (
    <a
      href={DESKTOP_APP_DOWNLOAD_URL}
      title={DESKTOP_APP_BENEFIT}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-500/30 bg-[#111318]/95 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 shadow-2xl backdrop-blur-xl hover:border-emerald-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
    >
      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">download</span>
      <span className="truncate">{DOWNLOAD_LABEL}</span>
    </a>
  );
}

export function DesktopViewerHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="flex max-w-md items-start gap-2 rounded-xl border border-white/10 bg-[#111318]/95 px-3 py-2 text-[12px] leading-snug text-on-surface shadow-2xl backdrop-blur-xl"
    >
      <p className="min-w-0">
        {DESKTOP_VIEWER_HINT}{' '}
        <a
          href={DESKTOP_APP_DOWNLOAD_URL}
          className="font-semibold text-emerald-300 underline decoration-emerald-500/50 underline-offset-2"
        >
          {DOWNLOAD_LABEL}
        </a>
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fechar aviso do app desktop"
        className="shrink-0 text-outline hover:text-on-surface cursor-pointer"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
}

export function DesktopSharePrompt({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-share-title"
        className="w-full max-w-md rounded-2xl border border-outline-variant/30 bg-surface-container p-5 shadow-2xl"
      >
        <h2 id="desktop-share-title" className="text-base font-semibold text-on-surface">
          Transmita pelo app desktop
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{DESKTOP_SHARE_PROMPT}</p>
        <div className="mt-5 flex flex-col gap-2">
          <a
            href={DESKTOP_APP_DOWNLOAD_URL}
            className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3 text-sm font-bold text-slate-950 shadow-glow hover:from-emerald-400 hover:to-emerald-500"
          >
            Baixar App Windows (.exe)
          </a>
          <button
            type="button"
            onClick={onContinue}
            className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-2.5 text-sm font-medium text-on-surface-variant cursor-pointer hover:bg-white/5"
          >
            Continuar pelo navegador (máx. 720p)
          </button>
        </div>
      </div>
    </div>
  );
}
