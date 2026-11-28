import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evenDimension, frameIntervalMs, scalesWithCanvas, sourceNeedsUpscale, windowOutputSize } from './windowUpscale.ts';

test('dimensão inválida não vira tamanho de saída', () => {
  assert.equal(evenDimension(0), 0);
  assert.equal(evenDimension(Number.NaN), 0);
  assert.equal(windowOutputSize(0, 730, 1920, 1080), null);
  assert.equal(windowOutputSize(894, 0, 1920, 1080), null);
  assert.equal(windowOutputSize(894, 730, 0, 1080), null);
});

test('janela 894x730 em 1080p amplia pela altura e mantém a proporção', () => {
  assert.deepEqual(windowOutputSize(894, 730, 1920, 1080), { width: 1322, height: 1080 });
});

test('janela maior que o alvo reduz para o teto, sem ampliar', () => {
  assert.deepEqual(windowOutputSize(2560, 1440, 1920, 1080), { width: 1920, height: 1080 });
});

test('janela mais larga que o alvo trava na largura', () => {
  assert.deepEqual(windowOutputSize(3000, 1000, 1920, 1080), { width: 1920, height: 640 });
});

test('janela vertical cabe pela altura e sai com lados pares', () => {
  assert.deepEqual(windowOutputSize(800, 1400, 1920, 1080), { width: 618, height: 1080 });
});

test('o relógio de 30 fps marca 33 ms', () => {
  assert.equal(frameIntervalMs(30), 33);
  assert.equal(frameIntervalMs(15), 67);
  assert.equal(frameIntervalMs(5), 200);
  assert.equal(frameIntervalMs(0), 0);
});

test('número ímpar arredonda para o par mais próximo', () => {
  assert.equal(evenDimension(657), 658);
  assert.equal(evenDimension(1322.465), 1322);
});

test('aba e janela usam o canvas; tela inteira não', () => {
  assert.equal(scalesWithCanvas('window'), true);
  assert.equal(scalesWithCanvas('browser'), true);
  assert.equal(scalesWithCanvas('monitor'), false);
  assert.equal(scalesWithCanvas('unknown'), false);
  assert.equal(scalesWithCanvas(null), false);
});

test('captura no alvo ou maior não pede upscale', () => {
  assert.equal(sourceNeedsUpscale(1920, 1080, 1920, 1080), false);
  assert.equal(sourceNeedsUpscale(2560, 1440, 1920, 1080), false);
  assert.equal(sourceNeedsUpscale(1440, 1080, 1920, 1080), false);
  assert.equal(sourceNeedsUpscale(1920, 900, 1920, 1080), false);
});

test('os dois lados abaixo do alvo pedem upscale', () => {
  assert.equal(sourceNeedsUpscale(894, 730, 1920, 1080), true);
  assert.equal(sourceNeedsUpscale(1280, 720, 1920, 1080), true);
  assert.equal(sourceNeedsUpscale(0, 720, 1920, 1080), false);
});
