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

// ── Posição do preview local (lembrada na sessão) ──────

/** Chave usada no sessionStorage para a posição do preview local. */
export const LOCAL_PREVIEW_POSITION_KEY = 'telinha-local-preview-position';

/** Posição do preview local, em pixels, dentro do palco. */
export interface LocalPreviewPosition {
  x: number;
  y: number;
}

/** Salva a posição do preview local. Falhas de storage são silenciosas. */
export function saveLocalPreviewPosition(
  position: LocalPreviewPosition,
  storage?: StorageLike | null,
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(
      LOCAL_PREVIEW_POSITION_KEY,
      JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) }),
    );
  } catch {
    // storage indisponível
  }
}

/**
 * Carrega a posição do preview local. Devolve `null` quando não há dado
 * salvo ou o dado está corrompido.
 */
export function loadLocalPreviewPosition(
  storage?: StorageLike | null,
): LocalPreviewPosition | null {
  const store = resolveStorage(storage);
  if (!store) return null;

  let raw: string | null;
  try {
    raw = store.getItem(LOCAL_PREVIEW_POSITION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<LocalPreviewPosition> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const x = typeof parsed.x === 'number' ? parsed.x : Number.NaN;
    const y = typeof parsed.y === 'number' ? parsed.y : Number.NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

// ── Client ID (identidade estável entre recargas) ──────

/** Chave usada no sessionStorage para o clientId. */
export const CLIENT_ID_KEY = 'telinha-client-id';

/** Tamanho máximo do clientId (o servidor também corta). */
export const CLIENT_ID_MAX_LENGTH = 64;

/** Gera um identificador aleatório curto. */
function randomClientId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoRef.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Identificador estável do navegador, guardado no `sessionStorage`.
 *
 * O `peerId` do servidor muda a cada conexão — e a cada F5. O `clientId` não:
 * ele é o que permite reconhecer as próprias mensagens no histórico depois
 * do F5 (o `peerId` guardado no histórico já é o da conexão antiga).
 *
 * Devolve `''` quando não há storage disponível (aí a identidade cai para o
 * `peerId` e, por último, para o apelido).
 */
export function getClientId(storage?: StorageLike | null): string {
  const store = resolveStorage(storage);
  if (!store) return '';
  try {
    const raw = store.getItem(CLIENT_ID_KEY);
    if (raw && raw.trim()) return raw.trim().slice(0, CLIENT_ID_MAX_LENGTH);
    const id = randomClientId();
    store.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    // storage indisponível
    return '';
  }
}
