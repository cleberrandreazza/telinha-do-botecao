import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserRoomUrl, desktopRoomUrl, DISCORD_SESSION_KEY, normalizeRoomCode, readStoredDiscordSession, roomCodeFromLocation, roomTargetFromDesktopUrl } from './roomLink.ts';

test('código da URL ignora traço e recusa letra ambígua', () => {
  assert.equal(normalizeRoomCode('ab2-34c'), 'AB234C');
  assert.equal(normalizeRoomCode('IO0000'), null);
  assert.equal(normalizeRoomCode('ABC'), null);
});

test('caminho, atalho do app e query apontam para a sala', () => {
  assert.deepEqual(roomCodeFromLocation('/AB234C', ''), { code: 'AB234C', openApp: false, ticket: null, discordCode: null });
  assert.deepEqual(roomCodeFromLocation('/abrir/AB234C', ''), { code: 'AB234C', openApp: true, ticket: null, discordCode: null });
  assert.deepEqual(roomCodeFromLocation('/', '?sala=AB234C'), { code: 'AB234C', openApp: false, ticket: null, discordCode: null });
  assert.deepEqual(roomCodeFromLocation('/', '?sala=AB234C&ticket=abcdefghij123456'), {
    code: 'AB234C',
    openApp: false,
    ticket: 'abcdefghij123456',
    discordCode: null,
  });
  assert.equal(roomCodeFromLocation('/', '?sala=AB234C&ticket=curto')?.ticket, null);
  assert.equal(roomCodeFromLocation('/', ''), null);
  assert.equal(roomCodeFromLocation('/abrir/IO0000', ''), null);
});

test('telinha:// traz o código e o ticket sem alterar a caixa do token', () => {
  assert.deepEqual(roomTargetFromDesktopUrl('telinha://sala/AB234C?ticket=abcdefghij123456'), {
    code: 'AB234C',
    ticket: 'abcdefghij123456',
    discordCode: null,
  });
  assert.deepEqual(roomTargetFromDesktopUrl('telinha://sala/ab2-34c/?ticket=AbCdEfGhIj123456'), {
    code: 'AB234C',
    ticket: 'AbCdEfGhIj123456',
    discordCode: null,
  });
  assert.equal(roomTargetFromDesktopUrl('telinha://sala/AB234C?ticket=curto')?.ticket, null);
  assert.equal(roomTargetFromDesktopUrl('https://exemplo/sala/AB234C'), null);
});

test('a sessão do Discord sobrevive a uma aba nova', () => {
  const token = 'a'.repeat(43);
  const local = { getItem: (key: string) => (key === DISCORD_SESSION_KEY ? token : null) };
  const session = { getItem: () => null };
  assert.equal(readStoredDiscordSession(local, session), token);
  assert.equal(readStoredDiscordSession({ getItem: () => null }, { getItem: () => token }), token);
  assert.equal(readStoredDiscordSession({ getItem: () => 'curto' }, { getItem: () => null }), '');
});

test('links de convite', () => {
  assert.equal(desktopRoomUrl('AB234C'), 'telinha://sala/AB234C');
  assert.equal(desktopRoomUrl('AB234C', 'abcdefghij123456'), 'telinha://sala/AB234C?ticket=abcdefghij123456');
  assert.equal(
    browserRoomUrl('https://telinha-do-botecao.vercel.app/', 'AB234C'),
    'https://telinha-do-botecao.vercel.app/AB234C',
  );
});
