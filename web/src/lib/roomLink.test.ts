import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserRoomUrl, desktopRoomUrl, normalizeRoomCode, roomCodeFromLocation } from './roomLink.ts';

test('código da URL ignora traço e recusa letra ambígua', () => {
  assert.equal(normalizeRoomCode('ab2-34c'), 'AB234C');
  assert.equal(normalizeRoomCode('IO0000'), null);
  assert.equal(normalizeRoomCode('ABC'), null);
});

test('caminho, atalho do app e query apontam para a sala', () => {
  assert.deepEqual(roomCodeFromLocation('/AB234C', ''), { code: 'AB234C', openApp: false, ticket: null });
  assert.deepEqual(roomCodeFromLocation('/abrir/AB234C', ''), { code: 'AB234C', openApp: true, ticket: null });
  assert.deepEqual(roomCodeFromLocation('/', '?sala=AB234C'), { code: 'AB234C', openApp: false, ticket: null });
  assert.deepEqual(roomCodeFromLocation('/', '?sala=AB234C&ticket=abcdefghij123456'), {
    code: 'AB234C',
    openApp: false,
    ticket: 'abcdefghij123456',
  });
  assert.equal(roomCodeFromLocation('/', '?sala=AB234C&ticket=curto')?.ticket, null);
  assert.equal(roomCodeFromLocation('/', ''), null);
  assert.equal(roomCodeFromLocation('/abrir/IO0000', ''), null);
});

test('links de convite', () => {
  assert.equal(desktopRoomUrl('AB234C'), 'telinha://sala/AB234C');
  assert.equal(desktopRoomUrl('AB234C', 'abcdefghij123456'), 'telinha://sala/AB234C?ticket=abcdefghij123456');
  assert.equal(
    browserRoomUrl('https://telinha-do-botecao.vercel.app/', 'AB234C'),
    'https://telinha-do-botecao.vercel.app/AB234C',
  );
});
