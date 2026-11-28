import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HEADER_BYTES,
  KEYFRAME_FLAG,
  MAX_PACKET_BYTES,
  canPlayEncodedLocally,
  directBitrateCeiling,
  directSenderIds,
  fragmentPayload,
  parsePacket,
  supportsEncodedStreams,
  topologyView,
  viewersForRelay,
} from './relayPath.ts';

test('o teto direto divide o bitrate e não passa de um quarto do piso', () => {
  assert.equal(directBitrateCeiling(8_000_000, 1), 8_000_000);
  assert.equal(directBitrateCeiling(8_000_000, 3), Math.floor(8_000_000 / 3));
  assert.equal(directBitrateCeiling(8_000_000, 8), 2_000_000);
  assert.equal(directBitrateCeiling(0, 4), 0);
});

test('fragmento cabe no MTU e remonta fora de ordem', () => {
  const payload = new Uint8Array(20_000);
  for (let i = 0; i < payload.length; i += 1) payload[i] = i & 0xff;
  const packets = fragmentPayload(1, KEYFRAME_FLAG, 0x0102, 0x03040506, 0x0708090a, payload);
  assert.ok(packets.length > 1);
  const restored = new Uint8Array(payload.byteLength);
  let offset = 0;
  const reversed = [...packets].reverse();
  const ordered = new Array<Uint8Array>(packets.length);
  for (const packet of reversed) {
    assert.ok(packet.byteLength <= MAX_PACKET_BYTES);
    const parsed = parsePacket(packet);
    if (!parsed) throw new Error('pacote inválido');
    assert.equal(parsed.seqNumber, 0x0102);
    assert.equal(parsed.streamId, 0x0708090a);
    assert.equal(parsed.keyframe, true);
    assert.equal(parsed.fragTotal, packets.length);
    ordered[parsed.fragIdx] = parsed.payload;
  }
  for (const chunk of ordered) {
    restored.set(chunk, offset);
    offset += chunk.byteLength;
  }
  assert.equal(offset, payload.byteLength);
  assert.equal(restored[0], payload[0]);
  assert.equal(restored[payload.length - 1], payload[payload.length - 1]);
  assert.equal(packets[0].byteLength >= HEADER_BYTES, true);
});

test('pacote curto ou maior que o MTU não vira frame', () => {
  assert.equal(parsePacket(new Uint8Array(8)), null);
  assert.equal(parsePacket(new Uint8Array(MAX_PACKET_BYTES + 1)), null);
});

test('espectadores desktop pares e ímpares cabem em dois filhos por relay', () => {
  const plan = {
    primaryRelayId: 'p1',
    secondaryRelayId: 'p2',
    splitEvenOdd: true,
    canLocalNodeRelay: true,
    sharerId: 'host',
  };
  const desktops = ['host', 'p1', 'p2', 'a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(viewersForRelay('p1', plan, desktops, 'host'), ['a', 'c']);
  assert.deepEqual(viewersForRelay('p2', plan, desktops, 'host'), ['b', 'd']);
  assert.deepEqual(directSenderIds(['p1', 'phone', 'a'], plan), ['phone', 'a']);
});

test('sem relay eleito a topologia continua a rota direta', () => {
  assert.equal(topologyView(null, true).text, 'Rota Direta P2P');
  assert.equal(topologyView({
    primaryRelayId: 'p9',
    secondaryRelayId: null,
    splitEvenOdd: false,
    canLocalNodeRelay: false,
  }, false).mode, 'direct');
  const active = topologyView({
    primaryRelayId: 'p9',
    secondaryRelayId: 'p4',
    splitEvenOdd: true,
    canLocalNodeRelay: true,
  }, true);
  assert.equal(active.text, 'Via Nó Relay IA (Zero-Transcoding)');
  assert.equal(active.relayNodeId, 'p9 / p4');
  assert.equal(canPlayEncodedLocally(), false);
  assert.equal(supportsEncodedStreams({}), false);
});
