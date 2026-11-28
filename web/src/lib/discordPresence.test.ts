import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPresence, discordHideSwitchVisible, presenceIsPrivate } from './discordPresence.ts';

const base = {
  inRoom: true,
  roomCode: 'AB234C',
  roomPrivate: false,
  hideActivity: false,
  isStreaming: true,
  viewerCount: 4,
};

test('senha ou interruptor ocultam o código', () => {
  assert.equal(presenceIsPrivate({ inRoom: true, roomPrivate: true, hideActivity: false }), true);
  assert.equal(presenceIsPrivate({ inRoom: true, roomPrivate: false, hideActivity: true }), true);
  assert.equal(presenceIsPrivate({ inRoom: false, roomPrivate: true, hideActivity: true }), false);
});

test('sala privada não leva o código no estado enviado', () => {
  const hidden = buildPresence({ ...base, hideActivity: true });
  assert.equal(hidden.isPrivate, true);
  assert.equal(hidden.roomCode, '');
  assert.equal(hidden.inRoom, true);

  const locked = buildPresence({ ...base, roomPrivate: true, hideActivity: false });
  assert.equal(locked.roomCode, '');
  assert.equal(JSON.stringify(locked).includes('AB234C'), false);
});

test('sala pública leva status, contagem e o código', () => {
  const state = buildPresence(base);
  assert.equal(state.isPrivate, false);
  assert.equal(state.roomCode, 'AB234C');
  assert.equal(state.isStreaming, true);
  assert.equal(state.viewerCount, 4);
  assert.equal(state.maxPeers, 50);
});

test('o interruptor só aparece no app com o Discord conectado', () => {
  assert.equal(discordHideSwitchVisible(true, true), true);
  assert.equal(discordHideSwitchVisible(true, false), false);
  assert.equal(discordHideSwitchVisible(false, true), false);
  assert.equal(discordHideSwitchVisible(false, false), false);
});

test('sair da sala limpa código e contagem', () => {
  const state = buildPresence({ ...base, inRoom: false, roomPrivate: true });
  assert.equal(state.inRoom, false);
  assert.equal(state.roomCode, '');
  assert.equal(state.viewerCount, 0);
  assert.equal(state.isPrivate, false);
});
