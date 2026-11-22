// ── Sessão da sala (sobrevive ao F5) ────────────────────

export interface RoomSession {
  code: string;
  nickname: string;
  wasSharing: boolean;
  savedAt: number;
}

/** Chave usada no sessionStorage. */
export const ROOM_SESSION_KEY = 'telinha-room-session';

/** Sessão antiga demais (> 12h) é descartada. */
const SESSION_TTL = 12 * 60 * 60 * 1000;

/**
 * Storage injetável — no browser usamos `sessionStorage`, mas os testes rodam
 * no Node (onde não existe `sessionStorage`), então a interface é mínima.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Storage padrão: `sessionStorage` do browser, ou `null` se indisponível. */
function defaultStorage(): StorageLike | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Resolve o storage: quando nenhum é injetado, usa o `sessionStorage` do
 * browser. Passar `null` explicitamente desliga o storage (útil em testes).
 */
function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage === undefined) return defaultStorage();
  return storage;
}

/** Salva a sessão da sala. Falhas de storage são silenciosas. */
export function saveRoomSession(session: RoomSession, storage?: StorageLike | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(ROOM_SESSION_KEY, JSON.stringify(session));
  } catch {
    // storage indisponível
  }
}

/**
 * Carrega a sessão da sala. Devolve `null` quando:
 * - não há dado salvo;
 * - o JSON está corrompido;
 * - `code`/`nickname` estão vazios;
 * - o dado tem mais de 12 horas.
 */
export function loadRoomSession(storage?: StorageLike | null): RoomSession | null {
  const store = resolveStorage(storage);
  if (!store) return null;

  let raw: string | null;
  try {
    raw = store.getItem(ROOM_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<RoomSession> | null;
    if (!parsed || typeof parsed !== 'object') return null;

    const code = typeof parsed.code === 'string' ? parsed.code.trim() : '';
    const nickname = typeof parsed.nickname === 'string' ? parsed.nickname.trim() : '';
    if (!code || !nickname) return null;

    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
    if (!savedAt || Date.now() - savedAt > SESSION_TTL) return null;

    return {
      code,
      nickname,
      wasSharing: parsed.wasSharing === true,
      savedAt,
    };
  } catch {
    // JSON corrompido
    return null;
  }
}

/** Remove a sessão salva. */
export function clearRoomSession(storage?: StorageLike | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(ROOM_SESSION_KEY);
  } catch {
    // storage indisponível
  }
}
