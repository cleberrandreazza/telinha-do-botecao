import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asLinkRole, linkKey, oppositeRole, parseLinkKey } from './links.ts';

test('linkKey junta papel e peer', () => {
  assert.equal(linkKey('sender', 'p1'), 'sender:p1');
  assert.equal(linkKey('receiver', 'p1'), 'receiver:p1');
});

test('linkKey separa os dois sentidos do mesmo peer', () => {
  assert.ok(linkKey('sender', 'p1') !== linkKey('receiver', 'p1'));
});

test('parseLinkKey desfaz a chave', () => {
  assert.deepEqual(parseLinkKey('sender:p1'), { role: 'sender', peerId: 'p1' });
  assert.deepEqual(parseLinkKey('receiver:p7'), { role: 'receiver', peerId: 'p7' });
});

test('parseLinkKey devolve null para chave invalida', () => {
  assert.equal(parseLinkKey('p1'), null);
  assert.equal(parseLinkKey(''), null);
  assert.equal(parseLinkKey(':p1'), null);
  assert.equal(parseLinkKey('sender:'), null);
  assert.equal(parseLinkKey('teatro:p1'), null);
  assert.equal(parseLinkKey('SENDER:p1'), null);
});

test('parseLinkKey mantem o peer inteiro quando ele tem dois pontos', () => {
  assert.deepEqual(parseLinkKey('sender:p:1'), { role: 'sender', peerId: 'p:1' });
});

test('oppositeRole troca o papel', () => {
  assert.equal(oppositeRole('sender'), 'receiver');
  assert.equal(oppositeRole('receiver'), 'sender');
});

test('asLinkRole so aceita sender e receiver', () => {
  assert.equal(asLinkRole('sender'), 'sender');
  assert.equal(asLinkRole('receiver'), 'receiver');
  assert.equal(asLinkRole('teatro'), null);
  assert.equal(asLinkRole(undefined), null);
  assert.equal(asLinkRole(null), null);
});
