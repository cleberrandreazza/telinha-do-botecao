import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureVoiceRoom, roomForVoice, normalizeWebOrigin } from './discord-rooms.mjs';

const VOICE = '123456789012345678';
const GUILD = '987654321098765432';

test('cria uma sala vinculada ao servidor e canal de voz, sem privacidade Discord', () => {
  const rooms = new Map();
  const { room, created } = ensureVoiceRoom(rooms, VOICE, GUILD);
  assert.equal(created, true);
  assert.equal(room.voiceChannelId, VOICE);
  assert.equal(room.guildId, GUILD);
  assert.equal(room.password, null);
  assert.equal(room.discordPrivate, false);
  assert.equal(room.discordRestricted, true);
});

test('reutiliza a sala do mesmo canal e servidor', () => {
  const rooms = new Map();
  const first = ensureVoiceRoom(rooms, VOICE, GUILD);
  const second = ensureVoiceRoom(rooms, VOICE, GUILD);
  assert.equal(second.created, false);
  assert.equal(second.room.code, first.room.code);
});

test('não mistura canais ou servidores diferentes', () => {
  const rooms = new Map();
  const first = ensureVoiceRoom(rooms, VOICE, GUILD);
  const otherChannel = ensureVoiceRoom(rooms, '111111111111111111', GUILD);
  const otherGuild = ensureVoiceRoom(rooms, VOICE, '222222222222222222');
  assert.notEqual(first.room.code, otherChannel.room.code);
  assert.notEqual(first.room.code, otherGuild.room.code);
  assert.equal(roomForVoice(rooms, VOICE, GUILD).code, first.room.code);
});

test('sala removida não reaproveita o código antigo', () => {
  const rooms = new Map();
  const first = ensureVoiceRoom(rooms, VOICE, GUILD);
  rooms.delete(first.room.code);
  const next = ensureVoiceRoom(rooms, VOICE, GUILD);
  assert.equal(next.created, true);
  assert.notEqual(next.room.code, first.room.code);
});

test('normaliza apenas origens HTTPS', () => {
  assert.equal(normalizeWebOrigin('https://example.com/'), 'https://example.com');
  assert.equal(normalizeWebOrigin('http://example.com'), 'https://telinha-do-botecao.vercel.app');
});
