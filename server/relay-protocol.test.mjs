import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  announcedPeer,
  publicPeer,
  relayLinkRole,
  relayPurpose,
  summarizePlan,
  summarizeTelemetry,
} from './relay-protocol.mjs';

test('peer antigo continua sem virar relay desktop', () => {
  const peer = { id: 'p1', nickname: 'Ana', isSharing: true };
  assert.deepEqual(publicPeer(peer), {
    id: 'p1',
    nickname: 'Ana',
    isSharing: true,
    isDesktop: false,
  });
  assert.deepEqual(announcedPeer(peer), { id: 'p1', nickname: 'Ana', isDesktop: false });
});

test('telemetria resumida aceita o resumo e recusa lixo', () => {
  assert.equal(summarizeTelemetry(null), null);
  assert.equal(summarizeTelemetry({ rttMs: 12 }), null);
  assert.deepEqual(summarizeTelemetry({
    rttMs: 12,
    jitterMs: 4,
    loss: 0.01,
    uploadKbps: 8000,
    cpuPercent: 20,
    activeChildren: 9,
    isDesktop: true,
    extra: 'ignorado',
  }), {
    rttMs: 12,
    jitterMs: 4,
    loss: 0.01,
    uploadKbps: 8000,
    cpuPercent: 20,
    activeChildren: 2,
    isDesktop: true,
  });
});

test('plano de rota só liga a divisão par/ímpar com dois nós', () => {
  assert.deepEqual(summarizePlan({
    primaryRelayId: 'p2',
    secondaryRelayId: 'p3',
    splitEvenOdd: true,
    canLocalNodeRelay: false,
  }), {
    primaryRelayId: 'p2',
    secondaryRelayId: 'p3',
    splitEvenOdd: true,
    canLocalNodeRelay: false,
  });
  assert.equal(summarizePlan({ splitEvenOdd: true }).splitEvenOdd, false);
  assert.equal(relayLinkRole('relay'), 'relay');
  assert.equal(relayLinkRole('outro'), null);
  assert.equal(relayPurpose('relay-fanout'), 'relay-fanout');
  assert.equal(relayPurpose('stream'), null);
});
