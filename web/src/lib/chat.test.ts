import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAT_MAX_LENGTH, formatChatTime, isOwnMessage, sanitizeChatText } from './chat.ts';

test('texto vazio ou só com espaços fica vazio', () => {
  assert.equal(sanitizeChatText(''), '');
  assert.equal(sanitizeChatText('   '), '');
  assert.equal(sanitizeChatText('  \n\t  '), '');
});

test('remove caracteres de controle do texto', () => {
  const sanitized = sanitizeChatText('ola\u0000 \u0007\u001b mundo');
  assert.equal(sanitized, 'ola  mundo');
  assert.equal(sanitized.includes('\u0000'), false);
  assert.equal(sanitized.includes('\u0007'), false);
  assert.equal(sanitized.includes('\u001b'), false);
});

test('preserva a quebra de linha do texto', () => {
  assert.equal(sanitizeChatText('linha 1\nlinha 2'), 'linha 1\nlinha 2');
});

test('corta texto com mais de 500 caracteres', () => {
  const sanitized = sanitizeChatText('a'.repeat(600));
  assert.equal(sanitized.length, CHAT_MAX_LENGTH);
  assert.equal(sanitized, 'a'.repeat(CHAT_MAX_LENGTH));
});

test('texto com exatamente 500 caracteres permanece intacto', () => {
  const exact = 'b'.repeat(CHAT_MAX_LENGTH);
  assert.equal(sanitizeChatText(exact), exact);
});

test('formatChatTime devolve o horario no formato HH:MM', () => {
  const ts = new Date(2026, 0, 15, 9, 5).getTime();
  assert.equal(formatChatTime(ts), '09:05');
});

test('formatChatTime sempre devolve string no formato HH:MM', () => {
  for (const ts of [0, Date.now(), new Date(2026, 5, 1, 23, 59).getTime()]) {
    assert.ok(/^\d{2}:\d{2}$/.test(formatChatTime(ts)));
  }
});

// ── Identidade da mensagem (F5) ─────────────────────────

test('mesmo clientId com peerId diferente é mensagem minha', () => {
  // Depois do F5 o peerId do servidor mudou, mas o clientId continua o mesmo.
  const message = { from: 'p7', nickname: 'Zé', clientId: 'abc-123' };
  const me = { clientId: 'abc-123', peerId: 'p42', nickname: 'Zé' };

  assert.equal(isOwnMessage(message, me), true);
});

test('clientId diferente NÃO é mensagem minha, mesmo com o mesmo apelido', () => {
  const message = { from: 'p7', nickname: 'Zé', clientId: 'outro' };
  const me = { clientId: 'abc-123', peerId: 'p7', nickname: 'Zé' };

  assert.equal(isOwnMessage(message, me), false);
});

test('sem clientId, o peerId decide', () => {
  const message = { from: 'p7', nickname: 'Zé' };
  const me = { clientId: 'abc-123', peerId: 'p7', nickname: 'Zé' };

  assert.equal(isOwnMessage(message, me), true);
});

test('sem clientId e sem peerId, o apelido é o fallback', () => {
  const message = { from: 'p7', nickname: 'Zé' };
  const me = { clientId: '', peerId: '', nickname: 'Zé' };

  assert.equal(isOwnMessage(message, me), true);
});

test('mensagem de outra pessoa não é minha', () => {
  const message = { from: 'p9', nickname: 'Ana', clientId: 'xyz' };
  const me = { clientId: 'abc-123', peerId: 'p42', nickname: 'Zé' };

  assert.equal(isOwnMessage(message, me), false);
});

test('mensagem sem nenhum dado de identidade não é minha', () => {
  assert.equal(isOwnMessage({}, {}), false);
});

test('clientId em branco é ignorado (cai no peerId)', () => {
  const message = { from: 'p7', nickname: 'Zé', clientId: '   ' };
  const me = { clientId: 'abc-123', peerId: 'p7', nickname: 'Zé' };

  assert.equal(isOwnMessage(message, me), true);
});
