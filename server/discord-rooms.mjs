import { randomBytes } from 'node:crypto';

/** Mesmo alfabeto de `server/index.mjs`: sem I, 1, O e 0. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const DEFAULT_WEB_ORIGIN = 'https://telinha-do-botecao.vercel.app';

export function normalizeWebOrigin(value) {
  const raw = String(value || DEFAULT_WEB_ORIGIN).trim().replace(/\/+$/, '');
  if (!raw.startsWith('https://') || /\s/.test(raw)) return DEFAULT_WEB_ORIGIN;
  return raw;
}

export function browserRoomUrl(origin, code) {
  return `${normalizeWebOrigin(origin)}/${code}`;
}

export function desktopBridgeUrl(origin, code) {
  return `${normalizeWebOrigin(origin)}/abrir/${code}`;
}

export function generateRoomCode(rooms) {
  let code;
  do {
    code = Array.from(randomBytes(6), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
  } while (rooms.has(code));
  return code;
}

/** Sala desta call que ainda está na memória, com ou sem gente. */
export function roomForVoice(rooms, voiceChannelId) {
  if (!voiceChannelId) return null;
  let best = null;
  for (const room of rooms.values()) {
    if (room.voiceChannelId !== voiceChannelId) continue;
    if (!best) {
      best = room;
      continue;
    }
    const bestLive = best.peers.size > 0;
    const live = room.peers.size > 0;
    if (live && !bestLive) best = room;
    else if (live === bestLive && room.createdAt >= best.createdAt) best = room;
  }
  return best;
}

/** Sala desta call que ainda tem alguém dentro. */
export function activeVoiceRoom(rooms, voiceChannelId) {
  const room = roomForVoice(rooms, voiceChannelId);
  if (room && room.peers && room.peers.size > 0) return room;
  return null;
}

export function createVoiceRoom(rooms, voiceChannelId, isPrivate) {
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
    discordPrivate: Boolean(isPrivate),
    discordRestricted: true,
    discordHoldTimer: null,
  };
  rooms.set(code, room);
  return room;
}

/**
 * Reusa a sala deste canal enquanto ela ainda existir.
 * Sala já removida (call encerrada) ganha um código novo.
 */
export function ensureVoiceRoom(rooms, voiceChannelId, isPrivate) {
  const existing = roomForVoice(rooms, voiceChannelId);
  if (existing) return { room: existing, created: false };
  return { room: createVoiceRoom(rooms, voiceChannelId, isPrivate), created: true };
}

/** Senha, flag da call ou o pedido `privada: true` desta resposta. */
export function roomIsPrivate(room, requestedPrivate = false) {
  return Boolean(requestedPrivate || room?.password || room?.discordPrivate);
}

const JOIN_BUTTON_PREFIX = 'join_telinha:';

/**
 * Post do `/telinha`. Não leva código nem `?sala=`.
 * O botão só identifica o canal de voz.
 */
export function discordSlashPost(voiceChannelId, requestedPrivate, room) {
  return {
    ephemeral: roomIsPrivate(room, requestedPrivate),
    title: 'Telinha do Botecão',
    description: 'Clique em Entrar na Sala. O link só chega para quem está neste canal de voz.',
    customId: `${JOIN_BUTTON_PREFIX}${voiceChannelId}`,
    label: 'Entrar na Sala',
  };
}

/** Id do canal gravado no botão. Qualquer outro formato é ignorado. */
export function parseJoinButtonId(customId) {
  if (typeof customId !== 'string' || !customId.startsWith(JOIN_BUTTON_PREFIX)) return null;
  const voiceChannelId = customId.slice(JOIN_BUTTON_PREFIX.length);
  if (!/^\d{5,25}$/.test(voiceChannelId)) return null;
  return voiceChannelId;
}

/** A pessoa está neste canal, e não em outro. */
export function sameVoiceChannel(memberChannelId, voiceChannelId) {
  return Boolean(voiceChannelId) && memberChannelId === voiceChannelId;
}

export function blockedVoiceMessage(voiceChannelId) {
  return `Você precisa estar conectado no canal de voz **<#${voiceChannelId}>** para entrar nesta sala.`;
}

/** Links efêmeros, já com o ticket. O chat público não recebe isto. */
export function normalizeAppBridgeOrigin(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw.startsWith('https://') || /\s/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return null;
  }
}

/** Links efêmeros: o app usa uma página HTTPS intermediária porque o Discord
 * não aceita esquemas personalizados (telinha://) em botões de link. */
export function entryLinks({ origin, redirectOrigin, code, ticket }) {
  const base = normalizeWebOrigin(origin);
  const bridge = normalizeAppBridgeOrigin(redirectOrigin);
  const room = encodeURIComponent(code);
  const pass = encodeURIComponent(ticket);
  const app = `telinha://sala/${code}?ticket=${pass}`;
  return {
    web: `${base}/?sala=${room}&ticket=${pass}`,
    app,
    appWeb: bridge ? `${bridge}/abrir/${room}?ticket=${pass}` : null,
  };
}
