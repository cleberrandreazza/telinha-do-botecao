import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TICKET_TTL_MS, createTicketStore } from './discord-tickets.mjs';

const room = { code: 'AB234C', voiceChannelId: '111' };

test('ticket entra uma vez e só na sala em que foi emitido', () => {
  const store = createTicketStore();
  const now = 1_000_000;
  const token = store.issue(room, now);
  assert.equal(store.consume({ code: 'OUTRA2', voiceChannelId: '111' }, token, now + 1), false);
  assert.equal(store.consume(room, token, now + 1), true);
  assert.equal(store.consume(room, token, now + 2), false);
});

test('ticket expira em 45 segundos', () => {
  const store = createTicketStore();
  const now = 1_000_000;
  const token = store.issue(room, now);
  assert.equal(store.consume(room, token, now + TICKET_TTL_MS + 1), false);
  assert.equal(TICKET_TTL_MS, 45_000);
});

test('código adivinhado sem ticket não passa', () => {
  const store = createTicketStore();
  assert.equal(store.consume(room, '', 1), false);
  assert.equal(store.consume(room, 'curto', 1), false);
  assert.equal(store.consume(room, 'a'.repeat(16), 1), false);
});
