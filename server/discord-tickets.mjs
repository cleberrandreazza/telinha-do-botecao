import { randomBytes } from 'node:crypto';

/** Convite de uso único. Depois disso o mesmo token não entra de novo. */
export const TICKET_TTL_MS = 45_000;

const TICKET_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isTicketShape(token) {
  return typeof token === 'string' && TICKET_PATTERN.test(token);
}

/**
 * Tickets da sala restrita ao canal de voz.
 * Cada token vale uma entrada, na sala em que foi emitido, por 45 segundos.
 */
export function createTicketStore() {
  /** @type {Map<string, { roomCode: string, voiceChannelId: string, expiresAt: number }>} */
  const tickets = new Map();

  return {
    /**
     * @param {{ code: string, voiceChannelId: string }} room
     * @param {number} [now]
     */
    issue(room, now = Date.now()) {
      const token = randomBytes(24).toString('base64url');
      tickets.set(token, {
        roomCode: room.code,
        voiceChannelId: room.voiceChannelId,
        expiresAt: now + TICKET_TTL_MS,
      });
      return token;
    },

    /**
     * Consome o token se ele ainda vale para esta sala.
     * Token errado, de outra sala ou já usado não entra.
     * @param {{ code: string, voiceChannelId?: string|null }} room
     * @param {unknown} token
     * @param {number} [now]
     */
    consume(room, token, now = Date.now()) {
      if (!isTicketShape(token)) return false;
      const entry = tickets.get(token);
      if (!entry) return false;
      if (now > entry.expiresAt) {
        tickets.delete(token);
        return false;
      }
      if (entry.roomCode !== room.code || entry.voiceChannelId !== room.voiceChannelId) {
        return false;
      }
      tickets.delete(token);
      return true;
    },
  };
}
