import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearRoomSession, loadRoomSession, saveRoomSession, ROOM_SESSION_KEY } from './session.ts';
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
    code: 'BOTECO',
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
