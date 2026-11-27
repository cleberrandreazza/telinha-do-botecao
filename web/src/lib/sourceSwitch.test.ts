import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeSwitchError,
  errorNameOf,
  replaceTrackOnSenders,
  sourceLabel,
  SOURCE_OPTIONS,
} from './sourceSwitch.ts';
import type { TrackSenderLike } from './sourceSwitch.ts';

/** Sender falso: registra a track recebida e pode falhar. */
function makeSender(options: { fail?: boolean; track?: MediaStreamTrack | null } = {}): TrackSenderLike & {
  received: MediaStreamTrack | null;
} {
  const sender = {
    track: options.track ?? null,
    received: null as MediaStreamTrack | null,
    async replaceTrack(track: MediaStreamTrack | null) {
      if (options.fail) throw new Error('replaceTrack falhou');
      sender.received = track;
      sender.track = track;
    },
  };
  return sender;
}

/** Track falsa: o teste só precisa de um objeto que identifico a track. */
function makeTrack(name: string): MediaStreamTrack {
  return { kind: 'video', id: name, label: name } as unknown as MediaStreamTrack;
}

// ── Troca de track nos senders ────────────────────────

test('todos os senders recebem a track nova', async () => {
  const a = makeSender();
  const b = makeSender();
  const next = makeTrack('nova');

  const report = await replaceTrackOnSenders([a, b], next);

  assert.deepEqual(report, { attempted: 2, replaced: 2, failed: 0 });
  assert.equal(a.received, next);
  assert.equal(b.received, next);
});

test('um sender que falha nao derruba os outros', async () => {
  const bom = makeSender();
  const ruim = makeSender({ fail: true });
  const next = makeTrack('nova');

  const report = await replaceTrackOnSenders([ruim, bom], next);

  assert.deepEqual(report, { attempted: 2, replaced: 1, failed: 1 });
  assert.equal(bom.received, next);
});

test('sem senders nao ha troca nenhuma', async () => {
  const report = await replaceTrackOnSenders([], makeTrack('nova'));
  assert.deepEqual(report, { attempted: 0, replaced: 0, failed: 0 });
});

test('replaceTrack aceita null para tirar a track', async () => {
  const sender = makeSender();

  const report = await replaceTrackOnSenders([sender], null);

  assert.deepEqual(report, { attempted: 1, replaced: 1, failed: 0 });
  assert.equal(sender.received, null);
});

test('cada sender pode receber a sua propria track', async () => {
  const a = makeSender();
  const b = makeSender();
  let contador = 0;

  const report = await replaceTrackOnSenders([a, b], () => makeTrack(`clone-${contador++}`));

  assert.deepEqual(report, { attempted: 2, replaced: 2, failed: 0 });
  assert.equal(a.received?.id, 'clone-0');
  assert.equal(b.received?.id, 'clone-1');
});

// ── Motivo da falha ───────────────────────────────────

test('cancelamento no seletor tem texto proprio', () => {
  const erro = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
  assert.ok(/cancelada no seletor do navegador/i.test(describeSwitchError(erro)));
});

test('interrompida pelo navegador tem texto proprio', () => {
  const erro = Object.assign(new Error('aborted'), { name: 'AbortError' });
  assert.ok(/interrompeu a troca de fonte/i.test(describeSwitchError(erro)));
});

test('navegador sem suporte tem texto proprio', () => {
  const erro = Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
  assert.ok(/não oferece a troca de fonte/i.test(describeSwitchError(erro)));
});

test('erro desconhecido mostra a mensagem real', () => {
  assert.ok(/camera ocupada/.test(describeSwitchError(new Error('camera ocupada'))));
});

test('erro sem mensagem devolve o texto padrao', () => {
  assert.ok(/Não foi possível trocar a fonte/.test(describeSwitchError({})));
});

test('errorNameOf le o nome e devolve vazio sem nome', () => {
  assert.equal(errorNameOf(Object.assign(new Error('x'), { name: 'NotAllowedError' })), 'NotAllowedError');
  assert.equal(errorNameOf(new Error('x')), 'Error');
  assert.equal(errorNameOf(null), '');
});

// ── Rótulos da fonte ──────────────────────────────────

test('cada fonte tem rotulo', () => {
  assert.equal(sourceLabel('browser'), 'Aba');
  assert.equal(sourceLabel('window'), 'Janela');
  assert.equal(sourceLabel('monitor'), 'Tela');
});

test('fonte desconhecida vira n/d', () => {
  assert.equal(sourceLabel('unknown'), 'n/d');
  assert.equal(sourceLabel(null), 'n/d');
  assert.equal(sourceLabel(undefined), 'n/d');
});

test('as opcoes cobrem aba, janela e tela', () => {
  assert.deepEqual(
    SOURCE_OPTIONS.map((option) => option.value),
    ['browser', 'window', 'monitor'],
  );
});
