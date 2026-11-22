import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAT_MAX_LENGTH, formatChatTime, sanitizeChatText } from './chat.ts';

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
