import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearRoomSession,
  getClientId,
  loadLocalPreviewPosition,
  loadRoomSession,
  saveLocalPreviewPosition,
  saveRoomSession,
  CLIENT_ID_KEY,
  LOCAL_PREVIEW_POSITION_KEY,
  ROOM_SESSION_KEY,
} from './session.ts';
import type { RoomSession, StorageLike } from './session.ts';

/** Storage falso, em memória (Node não tem sessionStorage). */
class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function makeSession(overrides: Partial<RoomSession> = {}): RoomSession {
  return {
    code: 'ABC123',
    nickname: 'Zé',
    wasSharing: false,
    savedAt: Date.now(),
    ...overrides,
  };
}

test('save e load fazem round-trip da sessao da sala', () => {
  const storage = new MemoryStorage();
  const session = makeSession({ code: 'ABC123', nickname: 'Ana', wasSharing: true });

  saveRoomSession(session, storage);
  const loaded = loadRoomSession(storage);

  assert.deepEqual(loaded, session);
});

test('load devolve null quando nao ha dado salvo', () => {
  const storage = new MemoryStorage();
  assert.equal(loadRoomSession(storage), null);
});

test('load devolve null quando o JSON esta corrompido', () => {
  const storage = new MemoryStorage();
  storage.setItem(ROOM_SESSION_KEY, '{isto nao e json');

  assert.equal(loadRoomSession(storage), null);
});

test('load devolve null quando o dado tem mais de 12 horas', () => {
  const storage = new MemoryStorage();
  const old = makeSession({ savedAt: Date.now() - 13 * 60 * 60 * 1000 });
  storage.setItem(ROOM_SESSION_KEY, JSON.stringify(old));

  assert.equal(loadRoomSession(storage), null);
});

test('load devolve null quando code ou nickname estao vazios', () => {
  const storage = new MemoryStorage();
  storage.setItem(ROOM_SESSION_KEY, JSON.stringify(makeSession({ code: '   ' })));
  assert.equal(loadRoomSession(storage), null);

  storage.setItem(ROOM_SESSION_KEY, JSON.stringify(makeSession({ nickname: '' })));
  assert.equal(loadRoomSession(storage), null);
});

test('clear remove a sessao salva', () => {
  const storage = new MemoryStorage();
  saveRoomSession(makeSession(), storage);
  assert.ok(loadRoomSession(storage) !== null);

  clearRoomSession(storage);
  assert.equal(loadRoomSession(storage), null);
  assert.equal(storage.getItem(ROOM_SESSION_KEY), null);
});

// ── clientId (identidade estável entre recargas) ───────

test('getClientId devolve o mesmo id em chamadas seguidas', () => {
  const storage = new MemoryStorage();

  const first = getClientId(storage);
  const second = getClientId(storage);

  assert.ok(first.length > 0);
  assert.equal(first, second);
});

test('getClientId sobrevive ao F5 (o id fica guardado no storage)', () => {
  const storage = new MemoryStorage();

  const before = getClientId(storage);
  // Simula o F5: a página recarrega, mas o sessionStorage continua.
  const after = getClientId(storage);

  assert.equal(before, after);
  assert.equal(storage.getItem(CLIENT_ID_KEY), before);
});

test('getClientId gera ids diferentes para storages diferentes', () => {
  const a = new MemoryStorage();
  const b = new MemoryStorage();

  assert.ok(getClientId(a) !== getClientId(b));
});

test('getClientId devolve string vazia sem storage', () => {
  assert.equal(getClientId(null), '');
});

// ── Posição do preview local ──────────────────────────

test('a posição do preview local faz round-trip na sessão', () => {
  const storage = new MemoryStorage();

  saveLocalPreviewPosition({ x: 120.4, y: 260.6 }, storage);
  const loaded = loadLocalPreviewPosition(storage);

  assert.deepEqual(loaded, { x: 120, y: 261 });
  assert.equal(storage.getItem(LOCAL_PREVIEW_POSITION_KEY) !== null, true);
});

test('posição do preview local devolve null sem dado salvo', () => {
  const storage = new MemoryStorage();
  assert.equal(loadLocalPreviewPosition(storage), null);
});

test('posição do preview local devolve null quando o dado está corrompido', () => {
  const storage = new MemoryStorage();
  storage.setItem(LOCAL_PREVIEW_POSITION_KEY, '{nao e json');
  assert.equal(loadLocalPreviewPosition(storage), null);

  storage.setItem(LOCAL_PREVIEW_POSITION_KEY, JSON.stringify({ x: 'a', y: 2 }));
  assert.equal(loadLocalPreviewPosition(storage), null);
});

test('posição do preview local devolve null sem storage', () => {
  assert.equal(loadLocalPreviewPosition(null), null);
});
