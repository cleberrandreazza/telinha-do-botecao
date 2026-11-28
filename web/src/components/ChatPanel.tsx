import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, PeerInfo } from '../lib/types';
import { CHAT_MAX_LENGTH, formatChatTime, isOwnMessage } from '../lib/chat';
import { getInitials, colorFromString } from '../lib/profile';

/**
 * Intervalo mínimo entre dois envios. O servidor descarta silenciosamente
 * mensagens enviadas com menos de 500 ms de intervalo (e a janela desliza),
 * então o cliente trava o envio pelo mesmo tempo — sem isso a mensagem
 * simplesmente desapareceria.
 */
const SEND_COOLDOWN_MS = 500;

/** Distância do fim (px) a partir da qual o auto-scroll deixa de rolar sozinho. */
const NEAR_BOTTOM_PX = 80;

interface ChatPanelProps {
  messages: ChatMessage[];
  myPeerId: string;
  /** Identificador estável do cliente: sobrevive ao F5. */
  myClientId?: string;
  /** Meu apelido — fallback quando a mensagem não tem clientId. */
  myNickname?: string;
  onSend: (text: string) => void;
  open: boolean;
  onClose: () => void;
  /** Reenvia uma mensagem que ficou sem o eco do servidor. */
  onRetry?: (message: ChatMessage) => void;
  /** Código da sala, copiável no topo do chat. */
  roomCode: string;
  onLeaveRoom: () => void;
  /** Participantes, para a contagem acima da caixa de texto. */
  peers: PeerInfo[];
  /** A pessoa já está transmitindo. */
  isSharing?: boolean;
  /** Dá para começar a transmitir agora. */
  canShare?: boolean;
  /** Aviso quando o compartilhamento está bloqueado. */
  shareTitle?: string;
  onStartSharing?: () => void;
  onStopSharing?: () => void;
}

/** Acima de 80% do limite o contador de caracteres aparece. */
const COUNTER_THRESHOLD = Math.floor(CHAT_MAX_LENGTH * 0.8);

/**
 * Chat da sala: painel fixo com a identidade da sidebar (dark, emerald,
 * vidro fosco). No desktop fica ao lado da área principal; abaixo de `lg`
 * vira overlay de tela cheia.
 */
export default function ChatPanel({
  messages,
  myPeerId,
  myClientId,
  myNickname,
  onSend,
  open,
  onClose,
  onRetry,
  roomCode,
  onLeaveRoom,
  peers,
  isSharing = false,
  canShare = true,
  shareTitle,
  onStartSharing,
  onStopSharing,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  /** true quando a lista já estava colada no fim antes da mensagem nova. */
  const atBottomRef = useRef(true);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const cooldownTimerRef = useRef<number | null>(null);

  // Rola até o fim só se o usuário já estava perto do fim; caso contrário
  // deixa a lista parada e mostra o botão "Novas mensagens ↓".
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (atBottomRef.current) {
      list.scrollTop = list.scrollHeight;
      setShowNewMessages(false);
    } else {
      setShowNewMessages(true);
    }
  }, [messages]);

  // Mensagem pendente é descartada ao fechar o painel
  useEffect(() => {
    if (!open) setDraft('');
  }, [open]);

  // Limpa o timer do bloqueio de envio ao desmontar
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current !== null) window.clearTimeout(cooldownTimerRef.current);
    };
  }, []);

  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    const nearBottom = distance <= NEAR_BOTTOM_PX;
    atBottomRef.current = nearBottom;
    if (nearBottom) setShowNewMessages(false);
  }, []);

  const scrollToBottom = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    atBottomRef.current = true;
    setShowNewMessages(false);
  }, []);

  const startCooldown = useCallback(() => {
    setCooldown(true);
    if (cooldownTimerRef.current !== null) window.clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = window.setTimeout(() => {
      cooldownTimerRef.current = null;
      setCooldown(false);
    }, SEND_COOLDOWN_MS);
  }, []);

  if (!open) return null;

  const trimmed = draft.trim();
  const remaining = CHAT_MAX_LENGTH - draft.length;
  const showCounter = draft.length > COUNTER_THRESHOLD;

  const submit = () => {
    if (cooldown) return;
    if (!trimmed) return;
    onSend(draft);
    setDraft('');
    startCooldown();
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envia · Shift+Enter quebra linha
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <aside
      className="absolute inset-0 z-[55] lg:relative lg:inset-auto lg:z-auto lg:w-[320px] lg:shrink-0 lg:my-3 lg:mr-3 bg-[#111318]/95 backdrop-blur-2xl border border-[#272a37] rounded-2xl shadow-2xl flex flex-col min-h-0 overflow-hidden"
    >
      {/* ── Topo ── */}
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-[#1f222e] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[18px] text-primary shrink-0">forum</span>
          <span className="font-label-md text-[11px] uppercase tracking-wider text-on-surface-variant truncate">
            CHAT DA SALA
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer shrink-0"
          title="Fechar o chat"
          aria-label="Fechar o chat"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-[#1f222e] shrink-0">
        <button
          type="button"
          onClick={handleCopyCode}
          className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-container/60 hover:bg-surface-container-high/60 border border-outline-variant/20 transition-colors group/code min-w-0"
          title="Copiar código da sala"
        >
          <span className="material-symbols-outlined text-[14px] text-outline group-hover/code:text-primary transition-colors shrink-0">
            {copied ? 'check' : 'content_copy'}
          </span>
          <span className="font-body text-[11px] text-on-surface-variant font-semibold tracking-wider truncate">
            {roomCode}
          </span>
        </button>
        <button
          type="button"
          onClick={onLeaveRoom}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-container/60 hover:bg-error-container/20 border border-outline-variant/20 hover:border-error/30 text-on-surface-variant hover:text-error transition-all cursor-pointer shrink-0"
          title="Sair da sala"
        >
          <span className="material-symbols-outlined text-[14px]">logout</span>
          <span className="font-body text-[11px] font-medium">Sair</span>
        </button>
      </div>

      {(onStartSharing || onStopSharing) && (
        <div className="px-3.5 py-2 border-b border-[#1f222e] shrink-0">
          <button
            type="button"
            onClick={isSharing ? onStopSharing : onStartSharing}
            disabled={!isSharing && !canShare}
            title={!isSharing ? shareTitle : undefined}
            className={`w-full px-3 py-2 rounded-xl font-semibold shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${
              isSharing
                ? 'bg-error-container/30 hover:bg-error-container/50 text-error border border-error/30'
                : 'bg-primary-container hover:bg-secondary-container text-on-primary-container shadow-primary-container/20'
            }`}
          >
            <span className="material-symbols-outlined text-[19px]">{isSharing ? 'stop_screen_share' : 'screen_share'}</span>
            <span className="font-label-lg text-[13px]">{isSharing ? 'Cancelar transmissão' : 'Compartilhar Tela'}</span>
          </button>
        </div>
      )}

      {/* ── Mensagens ── */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Mensagens da sala"
        tabIndex={0}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-2.5 focus:outline-none focus-visible:border-primary/40"
      >
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-1.5 py-8 select-none">
            <span className="material-symbols-outlined text-[34px] text-outline/40">chat_bubble</span>
            <span className="text-[13px] font-medium text-on-surface-variant">Nenhuma mensagem ainda</span>
            <span className="text-[11px] text-outline">Manda a primeira!</span>
          </div>
        ) : (
          messages.map((message) => {
            // A identidade vem do clientId (sobrevive ao F5); o peerId e o
            // apelido são os fallbacks para mensagens sem clientId.
            const isMine = isOwnMessage(message, {
              clientId: myClientId,
              peerId: myPeerId,
              nickname: myNickname,
            });
            const color = colorFromString(message.nickname);
            return (
              <div
                key={message.id}
                className={`flex gap-2.5 items-start ${isMine ? 'flex-row-reverse' : ''} ${
                  message.failed ? 'opacity-60' : ''
                }`}
              >
                <div
                  className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center font-label-md text-[11px] font-semibold"
                  style={{
                    backgroundColor: `${color}22`,
                    border: `1px solid ${color}55`,
                    color,
                  }}
                  title={message.nickname}
                >
                  {getInitials(message.nickname)}
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={`rounded-xl px-2.5 py-2 border ${
                      isMine
                        ? 'bg-primary/[0.07] border-primary/25'
                        : 'bg-surface-container/50 border-[#1f222e]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className={`text-[12px] font-semibold truncate ${
                          isMine ? 'text-primary' : 'text-on-surface'
                        }`}
                      >
                        {message.nickname}
                      </span>
                      <span className="text-[10px] font-label-mono text-outline shrink-0">
                        {formatChatTime(message.ts)}
                      </span>
                      {message.pending && (
                        <span
                          className="material-symbols-outlined text-[12px] text-outline shrink-0"
                          title="Enviando…"
                          aria-label="Enviando"
                        >
                          schedule
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] leading-snug text-on-surface/90 whitespace-pre-wrap break-words">
                      {message.text}
                    </p>
                  </div>

                  {/* Mensagem sem eco do servidor: dá para tentar de novo */}
                  {message.failed && onRetry && (
                    <button
                      onClick={() => onRetry(message)}
                      className="mt-1 text-[11px] text-error hover:underline cursor-pointer"
                    >
                      Tentar de novo
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Botão de "novas mensagens" (aparece quando a lista não está no fim) */}
      {showNewMessages && messages.length > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-[136px] right-4 rounded-full bg-primary text-on-primary text-[11px] px-3 py-1.5 shadow-glow z-10 cursor-pointer"
        >
          Novas mensagens ↓
        </button>
      )}

      {/* ── Rodapé: campo + envio ── */}
      <div className="border-t border-[#1f222e] p-3 shrink-0">
        <div className="relative group/online mb-2">
          <div className="flex items-center gap-1.5 cursor-default px-0.5">
            <span className="material-symbols-outlined text-[14px] text-outline">group</span>
            <span className="text-[11px] font-label-md text-outline font-medium">
              {peers.length} {peers.length === 1 ? 'pessoa' : 'pessoas'} na sala
            </span>
          </div>
          <div className="absolute left-0 right-0 bottom-full mb-1 bg-[#18191c]/95 backdrop-blur-xl border border-[#272a37] rounded-xl p-2.5 shadow-2xl z-50 opacity-0 invisible group-hover/online:opacity-100 group-hover/online:visible transition-all duration-150">
            <span className="text-[10px] font-bold text-on-surface-variant tracking-wider uppercase font-label-md px-1 pb-1.5 block">
              PARTICIPANTES
            </span>
            <div className="flex flex-col gap-0.5 max-h-[180px] overflow-y-auto">
              {peers.map((peer) => {
                const isSelf = peer.id === myPeerId;
                return (
                  <div key={`pop-${peer.id}`} className="flex items-center gap-2 px-1.5 py-1 rounded-lg">
                    <div
                      className="w-5 h-5 rounded-md bg-surface-container-high border border-outline-variant/30 text-on-surface flex items-center justify-center text-[9px] font-semibold font-label-md shrink-0"
                      style={isSelf ? { backgroundColor: 'rgba(78, 222, 163, 0.15)', borderColor: 'rgba(78, 222, 163, 0.4)', color: '#4edea3' } : {}}
                    >
                      {getInitials(peer.nickname)}
                    </div>
                    <span className={`text-[11px] truncate ${isSelf ? 'text-primary font-medium' : 'text-on-surface-variant'}`}>
                      {peer.nickname}
                    </span>
                    {isSelf && (
                      <span className="text-[8px] font-label-mono text-outline bg-surface-container-high px-1 py-0.5 rounded-full">Você</span>
                    )}
                    {peer.isSharing && (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 ml-auto" title="Transmitindo" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="relative">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={CHAT_MAX_LENGTH}
            rows={2}
            placeholder="Manda uma mensagem…"
            aria-label="Mensagem"
            className="block w-full resize-none bg-surface-container/70 border border-[#1f222e] rounded-xl px-3 py-2 pr-10 text-[13px] text-on-surface placeholder:text-outline focus:border-primary/50 focus:outline-none transition-colors"
          />
          <button
            onClick={submit}
            disabled={!trimmed || cooldown}
            title="Enviar"
            aria-label="Enviar mensagem"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">send</span>
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 mt-1.5">
          <span className="text-[10px] text-outline truncate">Enter envia · Shift+Enter quebra linha</span>
          {showCounter && (
            <span
              className={`text-[10px] font-label-mono shrink-0 ${
                remaining <= 50 ? 'text-error' : 'text-outline'
              }`}
            >
              {remaining}
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
