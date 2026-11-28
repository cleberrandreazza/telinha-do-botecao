import { randomBytes } from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const DEFAULT_WEB_ORIGIN = 'https://telinha-do-botecao.vercel.app';

/** Origem HTTPS do servidor de sinalização, sem caminho. */
export function normalizeHttpsOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('https://') || raw.split('').some((char) => char.charCodeAt(0) <= 32)) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Os botões do Discord apontam para o servidor. Lá o cookie da sessão
 * decide se a pessoa autoriza de novo ou segue direto.
 */
export function discordEntryUrls({ origin, redirectOrigin, code }) {
  const web = normalizeWebOrigin(origin);
  const bridge = normalizeHttpsOrigin(redirectOrigin);
  const room = encodeURIComponent(code);
  if (!bridge) {
    return {
      browser: `${web}/?sala=${room}&source=discord`,
      desktop: `${web}/abrir/${room}?source=discord`,
    };
  }
  return {
    browser: `${bridge}/discord/entry/${room}?target=browser`,
    desktop: `${bridge}/discord/entry/${room}?target=desktop`,
  };
}

export function normalizeWebOrigin(value) {
  let raw = String(value || DEFAULT_WEB_ORIGIN).trim();
  while (raw.endsWith('/')) raw = raw.slice(0, -1);
  if (!raw.startsWith('https://') || raw.split('').some((char) => char.charCodeAt(0) <= 32)) return DEFAULT_WEB_ORIGIN;
  return raw;
}

export function generateRoomCode(rooms) {
  let code;
  do {
    code = Array.from(randomBytes(6), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
  } while (rooms.has(code));
  return code;
}

export function roomForVoice(rooms, voiceChannelId, guildId = null) {
  if (!voiceChannelId) return null;
  for (const room of rooms.values()) {
    if (room.voiceChannelId === voiceChannelId && (!guildId || room.guildId === guildId)) return room;
  }
  return null;
}

export function ensureVoiceRoom(rooms, voiceChannelId, guildId) {
  const existing = roomForVoice(rooms, voiceChannelId, guildId);
  if (existing) return { room: existing, created: false };
  const code = generateRoomCode(rooms);
  const room = {
    code,
    password: null,
    peers: new Map(),
    createdAt: Date.now(),
    history: [],
    emptySince: null,
    cleanupTimer: null,
    voiceChannelId,
    guildId,
    discordPrivate: false,
    discordRestricted: true,
    discordHoldTimer: null,
  };
  rooms.set(code, room);
  return { room, created: true };
}

export function restoreVoiceRoom(rooms, code, voiceChannelId, guildId) {
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)) return null;
  const existing = rooms.get(code);
  if (existing) return existing;
  const room = {
    code,
    password: null,
    peers: new Map(),
    createdAt: Date.now(),
    history: [],
    emptySince: null,
    cleanupTimer: null,
    voiceChannelId,
    guildId,
    discordPrivate: false,
    discordRestricted: true,
    discordHoldTimer: null,
  };
  rooms.set(code, room);
  return room;
}
