import assert from 'node:assert/strict';
import { test } from 'node:test';
import { soundForEvent, playSound, setSoundsEnabled, areSoundsEnabled, resolveEventSounds } from './sounds.ts';

test('entrar na sala toca o som de entrada', () => {
  assert.equal(soundForEvent({ type: 'peer-joined' }), 'peer-joined');
});

test('sair da sala toca o som de saída', () => {
  assert.equal(soundForEvent({ type: 'peer-left' }), 'peer-left');
});

test('começar a transmitir toca o som de nova stream', () => {
  assert.equal(soundForEvent({ type: 'sharing-started' }), 'stream-started');
});

test('mensagem de outro toca o som de mensagem', () => {
  assert.equal(
    soundForEvent({ type: 'chat-message', own: false, history: false }),
    'message',
  );
});

test('mensagem própria não toca som', () => {
  assert.equal(
    soundForEvent({ type: 'chat-message', own: true, history: false }),
    null,
  );
});

test('histórico do chat não toca som', () => {
  assert.equal(
    soundForEvent({ type: 'chat-message', own: false, history: true }),
    null,
  );
});

test('tocar som sem browser não quebra nada', () => {
  // Sem window não há AudioContext: a chamada precisa sair em silêncio.
  playSound('message');
  assert.equal(areSoundsEnabled(), true);
});

test('os sons podem ser desligados e religados', () => {
  setSoundsEnabled(false);
  assert.equal(areSoundsEnabled(), false);
  playSound('message');
  setSoundsEnabled(true);
  assert.equal(areSoundsEnabled(), true);
});

test('preferência ausente (config antiga) mantém os sons ligados', () => {
  assert.equal(resolveEventSounds(undefined), true);
  assert.equal(resolveEventSounds(null), true);
  assert.equal(resolveEventSounds('lixo'), true);
});

test('preferência salva desliga só quando é false de fato', () => {
  assert.equal(resolveEventSounds(false), false);
  assert.equal(resolveEventSounds(true), true);
});
