import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blockedVoiceMessage,
  discordSlashPost,
  ensureVoiceRoom,
  entryLinks,
  parseJoinButtonId,
  roomIsPrivate,
  sameVoiceChannel,
} from './discord-rooms.mjs';

const ORIGIN = 'https://telinha-do-botecao.vercel.app';
const VOICE = '123456789012345678';

test('reusa a sala da call enquanto houver gente', () => {
  const rooms = new Map();
  const first = ensureVoiceRoom(rooms, VOICE, false);
  assert.equal(first.room.discordRestricted, true);
  first.room.peers.set('p1', {});
  const late = ensureVoiceRoom(rooms, VOICE, false);
  assert.equal(late.created, false);
  assert.equal(late.room.code, first.room.code);
});

test('sala removida não reaproveita o código antigo', () => {
  const rooms = new Map();
  const first = ensureVoiceRoom(rooms, VOICE, false);
  rooms.delete(first.room.code);
  const next = ensureVoiceRoom(rooms, VOICE, false);
  assert.equal(next.created, true);
  assert.notEqual(next.room.code, first.room.code);
});

test('sala ainda na memória, mesmo vazia, continua sendo a da call', () => {
  const rooms = new Map();
  const first = ensureVoiceRoom(rooms, VOICE, false);
  const again = ensureVoiceRoom(rooms, VOICE, false);
  assert.equal(again.created, false);
  assert.equal(again.room.code, first.room.code);
});

test('senha, flag ou opção privada pedem resposta efêmera', () => {
  assert.equal(roomIsPrivate({ password: null, discordPrivate: false }, false), false);
  assert.equal(roomIsPrivate({ password: 'segredo', discordPrivate: false }, false), true);
  assert.equal(roomIsPrivate({ password: null, discordPrivate: true }, false), true);
  assert.equal(roomIsPrivate({ password: null, discordPrivate: false }, true), true);
});

test('o post público não leva código nem URL da sala', () => {
  const rooms = new Map();
  const { room } = ensureVoiceRoom(rooms, VOICE, false);
  const post = discordSlashPost(VOICE, false, room);
  const packed = JSON.stringify(post);
  assert.equal(post.ephemeral, false);
  assert.equal(post.customId, `join_telinha:${VOICE}`);
  assert.equal(post.label, 'Entrar na Sala');
  assert.equal(packed.includes(room.code), false);
  assert.equal(packed.includes('?sala='), false);
  assert.equal(packed.includes('http'), false);
});

test('quem está em outro canal não passa, e o aviso cita o canal certo', () => {
  assert.equal(sameVoiceChannel('999', VOICE), false);
  assert.equal(sameVoiceChannel(undefined, VOICE), false);
  assert.equal(sameVoiceChannel(VOICE, VOICE), true);
  assert.equal(parseJoinButtonId(`join_telinha:${VOICE}`), VOICE);
  assert.equal(parseJoinButtonId('join_telinha:abc'), null);
  const message = blockedVoiceMessage(VOICE);
  assert.equal(
    message,
    `Você precisa estar conectado no canal de voz **<#${VOICE}>** para entrar nesta sala.`,
  );
});

test('o convite efêmero leva o ticket na query e no link do app', () => {
  const links = entryLinks({ origin: `${ORIGIN}/`, redirectOrigin: 'https://telinha-signaling.onrender.com', code: 'AB234C', ticket: 'abcdefghij123456' });
  assert.equal(links.web, 'https://telinha-do-botecao.vercel.app/?sala=AB234C&ticket=abcdefghij123456');
  assert.equal(links.app, 'telinha://sala/AB234C?ticket=abcdefghij123456');
  assert.equal(links.appWeb, 'https://telinha-signaling.onrender.com/abrir/AB234C?ticket=abcdefghij123456');
});
