import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRgbaFrame, streamConfigForShare, targetHeightForQuality } from './nativeCapture.ts';

test('qualidade nativa não pede redução de altura', () => {
  assert.equal(targetHeightForQuality('native'), 0);
  assert.equal(targetHeightForQuality('1080'), 1080);
  assert.equal(targetHeightForQuality('720'), 720);
});

test('o quadro ao vivo traz largura, altura e os bytes BGRA sem folga', () => {
  const pixels = Uint8Array.of(9, 8, 7, 255, 1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255);
  const bytes = new Uint8Array(8 + pixels.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 2, true);
  view.setUint32(4, 2, true);
  bytes.set(pixels, 8);
  const frame = readRgbaFrame(bytes);
  assert.equal(frame?.width, 2);
  assert.equal(frame?.height, 2);
  assert.deepEqual(Array.from(frame?.pixels ?? []), Array.from(pixels));
  assert.equal(readRgbaFrame(bytes.subarray(0, 10)), null);
});

test('a captura nativa entra no preset de vídeo e no áudio do sistema', () => {
  assert.deepEqual(streamConfigForShare({
    sourceId: '1',
    kind: 'window',
    quality: '1080',
    fps: 60,
    captureAudio: true,
  }), {
    resolution: '1080',
    frameRate: 60,
    audio: true,
    audioMode: 'system',
  });
});
