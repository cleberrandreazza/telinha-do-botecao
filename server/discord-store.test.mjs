import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

process.env.DISCORD_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
const { encryptDiscordToken, decryptDiscordToken } = await import('./discord-store.mjs');

test('criptografa tokens Discord e recupera o valor original', () => {
  const token = 'refresh-token-secret-value';
  const encrypted = encryptDiscordToken(token);
  assert.notEqual(encrypted, token);
  assert.equal(decryptDiscordToken(encrypted), token);
});

test('cada criptografia usa nonce diferente', () => {
  const first = encryptDiscordToken('same-token');
  const second = encryptDiscordToken('same-token');
  assert.notEqual(first, second);
  assert.equal(decryptDiscordToken(first), 'same-token');
  assert.equal(decryptDiscordToken(second), 'same-token');
});

test('rejeita token cifrado adulterado', () => {
  const encrypted = encryptDiscordToken('secret');
  const altered = encrypted.slice(0, -1) + (encrypted.endsWith('A') ? 'B' : 'A');
  assert.throws(() => decryptDiscordToken(altered));
});
