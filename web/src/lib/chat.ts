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
