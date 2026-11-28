import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evenDimension, frameIntervalMs, resolutionScaleDownBy, scalesWithCanvas, sourceNeedsUpscale, windowOutputSize } from './windowUpscale.ts';

test('dimensão inválida não vira tamanho de saída', () => {
  assert.equal(evenDimension(0), 0);
  assert.equal(evenDimension(Number.NaN), 0);
  assert.equal(windowOutputSize(0, 730, 1080), null);
  assert.equal(windowOutputSize(894, 0, 1080), null);
  assert.equal(windowOutputSize(894, 730, 0), null);
});

test('janela 894x730 em 1080p amplia pela altura e mantém a proporção', () => {
  assert.deepEqual(windowOutputSize(894, 730, 1080), { width: 1322, height: 1080 });
});

test('fonte mais alta que o alvo reduz só pela altura', () => {
  assert.deepEqual(windowOutputSize(2560, 1440, 1080), { width: 1920, height: 1080 });
});

test('janela larga e baixa não é cortada na largura', () => {
  assert.deepEqual(windowOutputSize(3000, 1000, 1080), { width: 3240, height: 1080 });
});

test('ultrawide 3440x1440 em 1080p sai 2580x1080', () => {
  assert.deepEqual(windowOutputSize(3440, 1440, 1080), { width: 2580, height: 1080 });
});

test('janela vertical cabe pela altura e sai com lados pares', () => {
  assert.deepEqual(windowOutputSize(800, 1400, 1080), { width: 618, height: 1080 });
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

test('altura no alvo ou maior não pede canvas, inclusive ultrawide', () => {
  assert.equal(sourceNeedsUpscale(1920, 1080, 1080), false);
  assert.equal(sourceNeedsUpscale(2560, 1440, 1080), false);
  assert.equal(sourceNeedsUpscale(2560, 1080, 1080), false);
  assert.equal(sourceNeedsUpscale(3440, 1440, 1080), false);
  assert.equal(sourceNeedsUpscale(1440, 1080, 1080), false);
});

test('altura abaixo do alvo pede canvas, mesmo com largura grande', () => {
  assert.equal(sourceNeedsUpscale(894, 730, 1080), true);
  assert.equal(sourceNeedsUpscale(1280, 720, 1080), true);
  assert.equal(sourceNeedsUpscale(1920, 900, 1080), true);
  assert.equal(sourceNeedsUpscale(0, 720, 1080), false);
});

test('scaleResolutionDownBy só reduz quando a fonte é mais alta', () => {
  assert.equal(resolutionScaleDownBy(1440, 1080), 1440 / 1080);
  assert.equal(resolutionScaleDownBy(1080, 1080), 1);
  assert.equal(resolutionScaleDownBy(900, 1080), 1);
  assert.equal(resolutionScaleDownBy(Number.NaN, 1080), 1);
  assert.equal(resolutionScaleDownBy(1440, 0), 1);
});
