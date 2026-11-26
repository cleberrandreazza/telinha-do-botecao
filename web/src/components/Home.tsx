import { useState, useEffect } from 'react';
import { cleanCode, formatCode } from '../lib/utils';
import { loadProfile, saveProfile } from '../lib/profile';

interface HomeProps {
  onCreateRoom: (nickname: string, password?: string) => void;
  onJoinRoom: (code: string, nickname: string, password?: string) => void;
  error: string | null;
  connecting: boolean;
}

/** Erro de campo: aparece colado ao input que-o causou. */
type FieldError = { field: 'nickname' | 'code'; message: string } | null;

// A cor da borda fica fora do INPUT: no estado de erro a borda precisa
// ficar vermelha (Tela A) e, com `border-white/10` no mesmo lugar, quem
// vence dependeria da ordem de geração do Tailwind.
const INPUT = 'w-full bg-surface-input/90 text-white placeholder:text-slate-500 border rounded-xl px-4 py-3 text-sm transition-all outline-none';
const LABEL = 'block text-xs font-semibold uppercase tracking-wider text-slate-300';

export default function Home({ onCreateRoom, onJoinRoom, error, connecting }: HomeProps) {
  // No desktop as duas colunas aparecem juntas; no mobile o segmented
  // control escolhe qual delas fica visível.
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [nickname, setNickname] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<FieldError>(null);

  // Carrega perfil salvo ao montar
  useEffect(() => {
    const saved = loadProfile();
    if (saved) {
      setNickname(saved.nickname);
    }
  }, []);

  // ── Criar sala ──
  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) {
      setFieldError({ field: 'nickname', message: 'O apelido é obrigatório.' });
      return;
    }
    setFieldError(null);
    saveProfile(nickname.trim());
    onCreateRoom(nickname.trim(), createPassword || undefined);
  };

  // ── Entrar numa sala ──
  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) {
      setFieldError({ field: 'nickname', message: 'O apelido é obrigatório.' });
      return;
    }
    if (code.trim().length < 6) {
      setFieldError({ field: 'code', message: 'O código precisa ter 6 caracteres.' });
      return;
    }
    setFieldError(null);
    saveProfile(nickname.trim());
    onJoinRoom(cleanCode(code), nickname.trim(), joinPassword || undefined);
  };

  return (
    <div className="relative min-h-screen flex flex-col justify-between px-4 py-8 sm:py-12 antialiased selection:bg-emerald-500/30 selection:text-emerald-300">
      {/* Ambient Backdrop */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-[15%] left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-emerald-500/10 rounded-full blur-[110px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full screen-noise opacity-40" />
      </div>

      {/* Main Content */}
      <main className="relative z-10 w-full max-w-md md:max-w-3xl mx-auto my-auto flex flex-col items-center">
        {/* Header / Brand */}
        <header className="text-center mb-8 flex flex-col items-center">
          {/* Retro TV Icon */}
          <div className="mb-4 relative group">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-surface-card to-surface-lowest border border-emerald-500/30 flex items-center justify-center shadow-lg shadow-emerald-950/40">
              <svg
                className="w-9 h-9 text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                viewBox="0 0 24 24"
              >
                <path d="m8 3 4 4 4-4" />
                <rect width={20} height={15} x={2} y={7} rx={3} />
                <rect className="fill-emerald-950/40" width={12} height={9} x={4} y={10} rx={1.5} />
                <circle cx={18} cy={11.5} r={1} fill="currentColor" />
                <circle cx={18} cy={15.5} r={1} fill="currentColor" />
                <path className="stroke-emerald-300/70" d="M6 13h8" strokeLinecap="round" strokeWidth={1.2} />
              </svg>
            </div>
            {/* Live pulse badge */}
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-surface-base" />
            </span>
          </div>

          {/* Title */}
          <h1 className="text-3xl sm:text-[34px] font-extrabold tracking-tight text-white mb-2 leading-tight">
            Telinha{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-amber-400">
              do Botecão
            </span>
          </h1>
          <p className="text-slate-400 text-sm font-medium tracking-normal max-w-xs sm:max-w-sm">
            Compartilhe sua tela sem travar, sem conta, sem custo
          </p>
        </header>

        {/* Segmented control — só no mobile (no desktop as colunas ficam lado a lado) */}
        <div
          role="tablist"
          aria-label="Criar ou entrar numa sala"
          className="md:hidden w-full grid grid-cols-2 gap-1.5 p-1.5 bg-surface-lowest/90 border border-white/5 rounded-xl mb-4"
        >
          <button
            role="tab"
            type="button"
            aria-selected={tab === 'create'}
            onClick={() => setTab('create')}
            className={`tab-btn py-2.5 px-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer focus:outline-none ${
              tab === 'create'
                ? 'text-white bg-surface-card-hover shadow-sm border border-white/10'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
            }`}
          >
            <svg className={`w-4 h-4 ${tab === 'create' ? 'text-emerald-400' : ''}`} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>Criar</span>
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={tab === 'join'}
            onClick={() => setTab('join')}
            className={`tab-btn py-2.5 px-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer focus:outline-none ${
              tab === 'join'
                ? 'text-white bg-surface-card-hover shadow-sm border border-white/10'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
            }`}
          >
            <svg className={`w-4 h-4 ${tab === 'join' ? 'text-amber-300' : 'text-slate-400'}`} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
            </svg>
            <span>Entrar</span>
          </button>
        </div>

        {/* Interaction Card */}
        <section className="w-full bg-surface-card/90 backdrop-blur-md border border-surface-border rounded-2xl p-6 sm:p-7 shadow-card-glow">
          {/* Apelido compartilhado pelas duas ações */}
          <div className="space-y-1.5">
            <label htmlFor="home-nickname" className={LABEL}>
              Seu apelido
            </label>
            <input
              id="home-nickname"
              type="text"
              value={nickname}
              onChange={(e) => { setNickname(e.target.value); if (fieldError?.field === 'nickname') setFieldError(null); }}
              placeholder="Ex: João do Boteco"
              maxLength={30}
              required
              autoFocus
              aria-describedby={fieldError?.field === 'nickname' ? 'home-nickname-error' : undefined}
              aria-invalid={fieldError?.field === 'nickname' ? true : undefined}
              className={`${INPUT} ${fieldError?.field === 'nickname' ? 'border-red-400 focus:border-red-400 focus:ring-red-500/20' : 'border-white/10 focus:border-emerald-500 focus:ring-emerald-500/20'}`}
            />
            {fieldError?.field === 'nickname' && (
              <p id="home-nickname-error" role="alert" className="text-xs text-red-300 pt-1">
                {fieldError.message}
              </p>
            )}
          </div>

          {/* Erro geral — bloco único, acima das colunas */}
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="mt-4 p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm"
            >
              {error}
            </div>
          )}

          {/* Duas colunas lado a lado no desktop */}
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/5 mt-6">
            {/* ── Coluna CRIAR SALA ── */}
            <div className={`py-6 md:py-0 md:pr-7 ${tab === 'join' ? 'hidden md:block' : ''}`}>
              <h2 className="font-label-md uppercase tracking-wider text-[11px] text-outline flex items-center gap-1.5 mb-4">
                <span className="material-symbols-outlined text-[15px]">add</span>
                Criar sala
              </h2>

              {/* noValidate: a validação é nossa (mensagem no campo + borda
                  vermelha). O balão nativo do browser destoa do layout. */}
              <form onSubmit={handleCreate} noValidate className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="create-password" className={LABEL}>
                    Senha <span className="text-slate-500 normal-case font-normal">(opcional)</span>
                  </label>
                  <input
                    id="create-password"
                    type="password"
                    value={createPassword}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    placeholder="Deixe vazio para sala aberta"
                    className={`${INPUT} border-white/10 focus:border-emerald-500 focus:ring-emerald-500/20`}
                  />
                </div>

                <button
                  type="submit"
                  disabled={!nickname.trim() || connecting}
                  className="w-full mt-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-slate-950 font-bold py-3.5 px-5 rounded-xl shadow-glow transition-all duration-200 transform active:scale-[0.99] flex items-center justify-center gap-2 group cursor-pointer disabled:cursor-not-allowed disabled:shadow-none"
                >
                  <span>{connecting ? 'Criando...' : 'Criar Sala Agora'}</span>
                  {!connecting && (
                    <svg className="w-4 h-4 stroke-[2.5] transition-transform duration-200 group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </form>
            </div>

            {/* ── Coluna ENTRAR NA SALA ── */}
            <div className={`py-6 md:py-0 md:pl-7 ${tab === 'create' ? 'hidden md:block' : ''}`}>
              <h2 className="font-label-md uppercase tracking-wider text-[11px] text-outline flex items-center gap-1.5 mb-4">
                <span className="material-symbols-outlined text-[15px]">login</span>
                Entrar na sala
              </h2>

              <form onSubmit={handleJoin} noValidate className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="join-code" className={LABEL}>
                    Código da sala
                  </label>
                  <input
                    id="join-code"
                    type="text"
                    value={formatCode(code)}
                    onChange={(e) => { setCode(cleanCode(e.target.value)); if (fieldError?.field === 'code') setFieldError(null); }}
                    placeholder="ABC-DEF"
                    maxLength={7}
                    required
                    aria-describedby={fieldError?.field === 'code' ? 'join-code-error' : undefined}
                    aria-invalid={fieldError?.field === 'code' ? true : undefined}
                    className={`${INPUT} ${fieldError?.field === 'code' ? 'border-red-400' : 'border-white/10'} text-amber-400 placeholder:text-slate-600 text-center text-base sm:text-lg font-mono font-bold tracking-widest uppercase ${fieldError?.field === 'code' ? 'focus:border-red-400 focus:ring-red-500/20' : 'focus:border-amber-400 focus:ring-amber-400/20'}`}
                  />
                  {fieldError?.field === 'code' && (
                    <p id="join-code-error" role="alert" className="text-xs text-red-300 pt-1">
                      {fieldError.message}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="join-password" className={LABEL}>
                    Senha <span className="text-slate-500 normal-case font-normal">(se necessário)</span>
                  </label>
                  <input
                    id="join-password"
                    type="password"
                    value={joinPassword}
                    onChange={(e) => setJoinPassword(e.target.value)}
                    placeholder="Senha da sala"
                    className={`${INPUT} border-white/10 focus:border-amber-400 focus:ring-amber-400/20`}
                  />
                </div>

                <button
                  type="submit"
                  disabled={!nickname.trim() || connecting}
                  className="w-full mt-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-slate-950 font-bold py-3.5 px-5 rounded-xl shadow-lg shadow-amber-950/40 transition-all duration-200 transform active:scale-[0.99] flex items-center justify-center gap-2 group cursor-pointer disabled:cursor-not-allowed disabled:shadow-none"
                >
                  <span>{connecting ? 'Entrando...' : 'Entrar na Sala'}</span>
                  {!connecting && (
                    <svg className="w-4 h-4 stroke-[2.5] transition-transform duration-200 group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </form>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 text-center py-4">
        <div className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-slate-500 tracking-wide">
          <span>P2P via WebRTC</span>
          <span className="text-slate-700 select-none">•</span>
          <span>Sem servidor de vídeo</span>
          <span className="text-slate-700 select-none">•</span>
          <span className="text-emerald-500/80 font-medium">100% gratuito</span>
        </div>
      </footer>
    </div>
  );
}
