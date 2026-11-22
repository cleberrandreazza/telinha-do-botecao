import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSignalingHost, isLoopbackHost, hostnameOnly } from './utils.ts';

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
