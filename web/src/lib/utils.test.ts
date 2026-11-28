import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clampPan,
  DESKTOP_PRODUCTION_SIGNALING_URL,
  getSignalingHost,
  isDesktopProduction,
  isLoopbackHost,
  hostnameOnly,
  panLimit,
  resolveSignalingUrl,
} from './utils.ts';

test('WebSocket usa hostname atual para conexoes em LAN', () => {
  assert.equal(getSignalingHost('192.168.15.4'), '192.168.15.4:4000');
});

test('VITE_SIGNAL_HOST substitui o host padrao', () => {
  assert.equal(getSignalingHost('192.168.15.4', 'signal.example.test:443'), 'signal.example.test:443');
});

test('host de loopback configurado e ignorado quando a pagina vem pela LAN', () => {
  assert.equal(getSignalingHost('192.168.15.4', 'localhost:4000'), '192.168.15.4:4000');
  assert.equal(getSignalingHost('192.168.15.4', '127.0.0.1:4000'), '192.168.15.4:4000');
});

test('host de loopback configurado vale quando a pagina tambem e local', () => {
  assert.equal(getSignalingHost('localhost', 'localhost:4000'), 'localhost:4000');
});

test('identifica hosts de loopback', () => {
  assert.equal(isLoopbackHost('localhost:4000'), true);
  assert.equal(isLoopbackHost('http://127.0.0.1:4000'), true);
  assert.equal(isLoopbackHost('[::1]:4000'), true);
  assert.equal(isLoopbackHost('192.168.15.4:4000'), false);
  assert.equal(isLoopbackHost('signal.example.test'), false);
});

test('extrai o nome do host sem esquema, porta e caminho', () => {
  assert.equal(hostnameOnly('ws://192.168.15.4:4000'), '192.168.15.4');
  assert.equal(hostnameOnly('https://signal.example.test/ws'), 'signal.example.test');
  assert.equal(hostnameOnly('[::1]:4000'), '::1');
});

test('desktop empacotado usa o servidor de producao e nao o tauri.localhost', () => {
  const packaged = {
    hasTauriInternals: true,
    protocol: 'https:',
    hostname: 'tauri.localhost',
  };
  assert.equal(isDesktopProduction(packaged), true);
  assert.equal(resolveSignalingUrl(packaged), DESKTOP_PRODUCTION_SIGNALING_URL);
  assert.equal(resolveSignalingUrl(packaged).includes('tauri.localhost'), false);
  assert.equal(
    resolveSignalingUrl({ ...packaged, protocol: 'tauri:', hostname: 'localhost' }),
    DESKTOP_PRODUCTION_SIGNALING_URL,
  );
  assert.equal(
    resolveSignalingUrl({ ...packaged, signalingUrl: 'wss://signal.example.test/ws' }),
    'wss://signal.example.test/ws',
  );
});

test('tauri dev continua no servidor local', () => {
  assert.equal(
    resolveSignalingUrl({
      hasTauriInternals: true,
      protocol: 'http:',
      hostname: 'localhost',
    }),
    'ws://localhost:4000',
  );
});

test('site continua usando VITE_SIGNAL_HOST', () => {
  assert.equal(
    resolveSignalingUrl({
      hasTauriInternals: false,
      protocol: 'https:',
      hostname: 'telinha.example.test',
      configuredHost: 'telinha-do-botecao.onrender.com',
      signalingUrl: 'wss://nao-usar.example.test',
    }),
    'wss://telinha-do-botecao.onrender.com',
  );
});

test('sem zoom o pan nao anda', () => {
  assert.deepEqual(panLimit(800, 450, 1), { x: 0, y: 0 });
  assert.deepEqual(panLimit(800, 450, 0.5), { x: 0, y: 0 });
});

test('o limite do pan cresce com o zoom', () => {
  assert.deepEqual(panLimit(800, 400, 2), { x: 400, y: 200 });
  assert.deepEqual(panLimit(800, 400, 1.5), { x: 200, y: 100 });
});

test('o pan e limitado as bordas do quadro', () => {
  const limit = panLimit(800, 400, 2);
  assert.deepEqual(clampPan({ x: 9999, y: -9999 }, limit), { x: 400, y: -200 });
  assert.deepEqual(clampPan({ x: 120, y: -60 }, limit), { x: 120, y: -60 });
});

test('pan invalido vira zero', () => {
  const limit = panLimit(800, 400, 2);
  assert.deepEqual(clampPan({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, limit), { x: 0, y: 0 });
});