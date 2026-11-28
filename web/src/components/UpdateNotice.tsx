interface UpdateNoticeProps {
  onUpdate: () => void;
  onDismiss: () => void;
}

/** Aviso de deploy. Não recarrega sozinho: a live só cai se a pessoa pedir. */
export default function UpdateNotice({ onUpdate, onDismiss }: UpdateNoticeProps) {
  return (
    <div
      role="status"
      className="fixed top-3 left-1/2 z-[80] -translate-x-1/2 flex items-center gap-2.5 max-w-[calc(100vw-1.5rem)] rounded-full border border-primary/40 bg-[#0c0e13]/95 px-3 py-2 text-on-surface shadow-[0_8px_28px_rgba(16,185,129,0.18)] backdrop-blur-md"
    >
      <span className="material-symbols-outlined text-primary text-[18px] leading-none shrink-0" aria-hidden="true">system_update</span>
      <p className="text-[13px] font-medium leading-none whitespace-nowrap">Nova versão disponível</p>
      <button
        type="button"
        onClick={onUpdate}
        className="h-8 px-3 rounded-full bg-primary text-on-primary text-[12px] font-semibold cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        Atualizar
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="h-8 px-3 rounded-full border border-white/15 text-[12px] font-medium text-on-surface/80 cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        Depois
      </button>
    </div>
  );
}
