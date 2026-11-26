// ── Chat da sala (helpers puros, sem React) ─────────────

/** Limite de caracteres por mensagem de chat. */
export const CHAT_MAX_LENGTH = 500;

/**
 * Sanitiza texto de chat:
 * - remove caracteres de controle (mantendo `\n`);
 * - apara espaços das pontas;
 * - corta em `CHAT_MAX_LENGTH`;
 * - devolve `''` quando sobra só espaço em branco.
 */
export function sanitizeChatText(input: string): string {
  if (!input) return '';
  return input
    .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '')
    .trim()
    .slice(0, CHAT_MAX_LENGTH);
}

/** Formata o horário da mensagem como `HH:MM` (24h, padrão pt-BR). */
export function formatChatTime(ts: number): string {
  const date = new Date(ts);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// ── Identidade da mensagem ─────────────────────────────

/** Quem está olhando o chat. */
export interface ChatIdentity {
  /** Identificador estável do navegador (sessionStorage) — sobrevive ao F5. */
  clientId?: string;
  /** peerId da conexão atual — muda a cada F5. */
  peerId?: string;
  /** Apelido — último recurso. */
  nickname?: string;
}

/**
 * Diz se a mensagem é minha.
 *
 * Ordem de confiança:
 * 1. `clientId` — o único que sobrevive ao F5 (o `from` guardado no
 *    histórico é o peerId da conexão antiga, que já morreu);
 * 2. `from` (peerId) — vale enquanto a conexão não caiu;
 * 3. apelido — último recurso, para mensagens sem `clientId`.
 *
 * Quando os dois lados têm `clientId`, ele manda: dois peers com o mesmo
 * apelido continuam sendo peers diferentes.
 */
export function isOwnMessage(
  message: { from?: string; nickname?: string; clientId?: string },
  me: ChatIdentity,
): boolean {
  const messageClientId = message.clientId?.trim();
  const myClientId = me.clientId?.trim();
  if (messageClientId && myClientId) {
    return messageClientId === myClientId;
  }

  if (message.from && me.peerId && message.from === me.peerId) {
    return true;
  }

  if (message.nickname && me.nickname && message.nickname === me.nickname) {
    return true;
  }

  return false;
}
