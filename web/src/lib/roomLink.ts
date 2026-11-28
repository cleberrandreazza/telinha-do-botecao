const ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export interface RoomLink {
  code: string;
  /** `/abrir/<codigo>` tenta o aplicativo antes do formulário. */
  openApp: boolean;
  /** Convite de uso único vindo do Discord. Sem ele, a sala restrita recusa a entrada. */
  ticket: string | null;
  discordCode: string | null;
}

const TICKET_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Código de sala, sem I/1/O/0. Traço e espaço saem. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.replace(/[-\s]/g, '').toUpperCase();
  return ALPHABET.test(code) ? code : null;
}

export function normalizeDiscordCode(raw: string | null | undefined): string | null {
  const code = (raw ?? '').trim();
  return /^[A-Za-z0-9_-]{40,64}$/.test(code) ? code : null;
}

export function normalizeTicket(raw: string | null | undefined): string | null {
  const ticket = (raw ?? '').trim();
  return TICKET_PATTERN.test(ticket) ? ticket : null;
}

/**
 * Código na URL do site: `/ABC234`, `/abrir/ABC234` ou `?sala=ABC234`.
 * Devolve null quando o caminho não é uma sala.
 */
export function roomCodeFromLocation(pathname: string, search: string): RoomLink | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const ticket = normalizeTicket(params.get('ticket'));
  const fromQuery = params.get('sala') || params.get('code');
  if (fromQuery) {
    const code = normalizeRoomCode(fromQuery);
    if (code) return { code, openApp: false, ticket, discordCode: normalizeDiscordCode(params.get('discord_code')) };
  }
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 2 && parts[0].toLowerCase() === 'abrir') {
    const code = normalizeRoomCode(parts[1]);
    if (code) return { code, openApp: true, ticket, discordCode: normalizeDiscordCode(params.get('discord_code')) };
  }
  if (parts.length === 1) {
    const code = normalizeRoomCode(parts[0]);
    if (code) return { code, openApp: false, ticket, discordSession: normalizeDiscordSession(params.get('discord_session')) };
  }
  return null;
}

/**
 * `telinha://sala/<CODIGO>?ticket=<TOKEN>`. O código ignora maiúsculas;
 * o ticket permanece como veio, porque o base64url distingue caixa.
 */
export function roomTargetFromDesktopUrl(raw: string): { code: string; ticket: string | null; discordCode: string | null } | null {
  const text = raw.trim().replace(/^"|"$/g, '');
  const lower = text.toLowerCase();
  const body = lower.startsWith('telinha://')
    ? lower.slice('telinha://'.length)
    : lower.startsWith('telinha:')
      ? lower.slice('telinha:'.length)
      : null;
  if (body == null) return null;
  let rest = body.replace(/^\/+/, '');
  if (rest.startsWith('sala/')) rest = rest.slice('sala/'.length);
  else if (rest.startsWith('sala')) rest = rest.slice('sala'.length);
  else return null;
  rest = rest.replace(/^\/+/, '');
  const code = normalizeRoomCode((rest.split(/[/?#& ]/)[0] ?? ''));
  if (!code) return null;
  const query = text.split('?')[1]?.split('#')[0] ?? '';
  let ticket: string | null = null;
  let discordCode: string | null = null;
  for (const pair of query.split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key === 'ticket') ticket = normalizeTicket(value);
    if (key === 'discord_code') discordCode = normalizeDiscordCode(decodeURIComponent(value));
  }
  return { code, ticket, discordCode };
}

export function desktopRoomUrl(code: string, ticket?: string | null, discordCode?: string | null): string {
  const params = new URLSearchParams();
  const safeTicket = normalizeTicket(ticket);
  const safeCode = normalizeDiscordCode(discordCode);
  if (safeTicket) params.set('ticket', safeTicket);
  if (safeCode) params.set('discord_code', safeCode);
  const query = params.toString();
  return `telinha://sala/${code}${query ? `?${query}` : ''}`;
}

export function browserRoomUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/${code}`;
}
