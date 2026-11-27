import { formatCode } from '../lib/utils';

interface ReconnectingProps {
  /** Código da sala que estamos tentando restaurar. */
  code: string;
  /** `connecting` = tentando voltar · `failed` = não deu (timeout ou erro). */
  status: 'connecting' | 'failed';
  /** Texto do erro, quando houver. */
  message?: string | null;
  /** Reenvia o `join-room` (só faz sentido quando a sala pode ainda existir). */
  onRetry?: () => void;
  /** Volta para o início e limpa a sessão salva. */
  onCancel: () => void;
}

/**
 * Tela de reconexão automática: mostrada enquanto o app tenta restaurar a
 * sessão da sala depois de um F5 (código + apelido vindos do sessionStorage).
 * Depois de 6 s sem resposta vira estado de falha, com "Tentar de novo" e
 * "Voltar ao início".
 */
export default function Reconnecting({
  code,
  status,
  message,
  onRetry,
  onCancel,
}: ReconnectingProps) {
  const failed = status === 'failed';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[70] flex items-center justify-center px-6 backdrop-blur-sm crt-turn-on"
    >
      {/* Fundo da TV */}
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-black/75" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,rgba(12,14,19,0.85)_100%)]" />
        {!failed && <div className="absolute inset-0 crt-loading-bars opacity-70" />}
        {!failed && <div className="absolute inset-0 crt-scan-sweep pointer-events-none" />}
        <div className="absolute inset-0 crt-scanlines pointer-events-none opacity-20" />
      </div>

      <div className="relative z-10 w-full max-w-sm text-center flex flex-col items-center">
        {failed ? (
          /* ── Estado de falha ── */
          <>
            <div className="mb-5 w-16 h-16 rounded-2xl bg-surface-card border border-amber-500/30 flex items-center justify-center shadow-lg">
              <span className="material-symbols-outlined text-[32px] text-amber-400">cloud_off</span>
            </div>

            <h1 className="font-headline-md text-[19px] text-on-surface font-semibold leading-tight">
              Não conseguimos voltar para a sala
            </h1>

            <p className="mt-2 font-body-md text-[13px] text-on-surface-variant">
              {message || 'Ela pode ter sido encerrada ou o servidor caiu.'}
            </p>

            <div className="mt-7 flex flex-col sm:flex-row gap-2 w-full justify-center">
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary-container text-sm font-semibold transition-colors cursor-pointer"
                >
                  Tentar de novo
                </button>
              )}
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high text-sm font-body font-medium transition-colors cursor-pointer"
              >
                Voltar ao início
              </button>
            </div>
          </>
        ) : (
          /* ── Tentando reconectar ── */
          <>
            <div className="mb-5 w-16 h-16 rounded-2xl bg-surface-card border border-emerald-500/30 flex items-center justify-center shadow-lg">
              <span className="material-symbols-outlined text-[32px] text-emerald-400 animate-spin">
                sync
              </span>
            </div>

            <h1 className="font-headline-md text-[19px] text-on-surface font-semibold leading-tight">
              Reconectando à sala {code ? formatCode(code) : ''}…
            </h1>

            <p className="mt-2 font-body-md text-[13px] text-on-surface-variant">
              Restaurando sua sessão.
            </p>

            <button
              onClick={onCancel}
              className="mt-7 px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high text-sm font-body font-medium transition-colors cursor-pointer"
            >
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
