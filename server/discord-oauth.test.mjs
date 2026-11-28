import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discordReturnUrl, entryClient, readCookie } from './discord-oauth.mjs';

test('lê o cookie da sessão sem misturar com os vizinhos', () => {
  assert.equal(readCookie('a=1; telinha_discord=abc_def-123; b=2', 'telinha_discord'), 'abc_def-123');
  assert.equal(readCookie('', 'telinha_discord'), '');
});

test('o retorno do app leva o código de uso único no esquema telinha', () => {
  const loginCode = 'a'.repeat(43);
  assert.equal(entryClient('desktop'), 'desktop');
  assert.equal(entryClient('outra'), 'browser');
  assert.equal(
    discordReturnUrl({ client: 'desktop', webOrigin: 'https://telinha-do-botecao.vercel.app', roomCode: 'AB234C', loginCode }),
    `telinha://sala/AB234C?discord_code=${loginCode}`,
  );
  assert.equal(
    discordReturnUrl({ client: 'browser', webOrigin: 'https://telinha-do-botecao.vercel.app', roomCode: 'AB234C', loginCode }),
    `https://telinha-do-botecao.vercel.app/?sala=AB234C&source=discord&discord_code=${loginCode}`,
  );
});
