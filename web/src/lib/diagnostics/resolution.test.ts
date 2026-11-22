import { test } from 'node:test';
import { equal, deepEqual } from 'node:assert/strict';
import { buildReport } from './export.ts';
import {
  readCaptureProbe,
  readEncoderEncoding,
  resolutionFacts,
  describeCapture,
  type CaptureProbe,
  type EncoderProbe,
} from './resolution.ts';
import type { MetricSample } from './types.ts';

const requested = { label: '1080', width: 1920, height: 1080, frameRate: 30 };

test('navegador sem getCapabilities deixa capabilities null e não inventa tamanho', () => {
  const probe = readCaptureProbe(requested, {
    readyState: 'live',
    contentHint: '',
    getSettings: () => ({ width: 1920, height: 1080, frameRate: 30, displaySurface: 'monitor', aspectRatio: 1.777, resizeMode: 'none' }),
    getConstraints: () => ({ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } }),
  });
  equal(probe.capabilities, null);
  equal(probe.contentHint, null);
  equal(probe.readyState, 'live');
  equal(probe.settings.width, 1920);
  equal(probe.settings.height, 1080);
  equal(probe.settings.displaySurface, 'monitor');
  equal(probe.constraints?.width?.ideal, 1920);
  equal(probe.constraints?.width?.exact, null);
  equal(probe.constraints?.frameRate?.max, 30);
  equal(probe.constraints?.resizeMode, null);
});

test('getSettings sem campos deixa cada medida null', () => {
  const probe = readCaptureProbe(requested, {
    readyState: 'live',
    getSettings: () => ({}),
    getConstraints: () => ({}),
    getCapabilities: () => ({}),
  });
  deepEqual(probe.settings, {
    width: null,
    height: null,
    frameRate: null,
    displaySurface: null,
    aspectRatio: null,
    resizeMode: null,
  });
  equal(probe.capabilities?.width, null);
  equal(probe.capabilities?.height, null);
  equal(probe.capabilities?.resizeMode, null);
  equal(probe.settings.width === requested.width, false);
});

test('parâmetros de encoder ausentes ficam null, inclusive scaleResolutionDownBy', () => {
  deepEqual(readEncoderEncoding(null), {
    maxBitrate: null,
    maxFramerate: null,
    scaleResolutionDownBy: null,
    degradationPreference: null,
  });
  deepEqual(readEncoderEncoding({}), {
    maxBitrate: null,
    maxFramerate: null,
    scaleResolutionDownBy: null,
    degradationPreference: null,
  });
  deepEqual(readEncoderEncoding({ encodings: [{}], degradationPreference: 'maintain-framerate' }), {
    maxBitrate: null,
    maxFramerate: null,
    scaleResolutionDownBy: null,
    degradationPreference: 'maintain-framerate',
  });
});

function capture(width: number | null, height: number | null): CaptureProbe {
  return readCaptureProbe(requested, {
    getSettings: () => ({ width, height, frameRate: 30, displaySurface: 'monitor' }),
    getCapabilities: () => ({ width: { min: 1, max: 1920 }, height: { max: 1080 } }),
  });
}

function sample(role: 'sender' | 'receiver', connectionId: string, size: { sourceW?: number; sourceH?: number; encW?: number; encH?: number; recW?: number; recH?: number }): MetricSample {
  return {
    timestamp: 1,
    connectionId,
    role,
    viewerCount: role === 'sender' ? 2 : null,
    configuredFps: 30,
    connectionState: 'connected',
    iceConnectionState: 'connected',
    dtMs: 1000,
    countersReset: false,
    videoCodec: 'H264',
    audioCodec: null,
    hasAudio: false,
    audioBitrate: null,
    audioRtp: null,
    audio: null,
    outbound: role === 'sender' ? {
      reportedFps: null, encodedFps: null, framesEncoded: null, sourceFps: null,
      sourceWidth: size.sourceW ?? null, sourceHeight: size.sourceH ?? null,
      sourceId: null, frameProductionVariation: null, sourceToEncodedGap: null,
      encodeTimePerFrameMs: null, totalEncodeTime: null, qualityLimitationReason: null,
      qualityLimitationDurations: null, targetBitrate: null, bytesSent: null, bitrate: null,
      frameWidth: size.encW ?? null, frameHeight: size.encH ?? null,
      keyFramesEncoded: null, keyFramesPerSec: null, nackCount: null, nackPerSec: null,
      pliCount: null, pliPerSec: null, firCount: null, firPerSec: null,
    } : null,
    inbound: role === 'receiver' ? {
      reportedFps: null, receivedFps: null, framesReceived: null, decodedFps: null,
      framesDecoded: null, droppedFps: null, framesDropped: null, decodeTimePerFrameMs: null,
      totalDecodeTime: null, keyFramesDecoded: null, keyFramesPerSec: null, packetsReceived: null,
      packetsLost: null, lossPct: null, jitterMs: null, jitterBufferAvgDelayMs: null,
      jitterBufferDelay: null, jitterBufferEmittedCount: null, freezes: null, freezeCount: null,
      freezeDurationSec: null, totalFreezesDuration: null, nackCount: null, nackPerSec: null,
      pliCount: null, pliPerSec: null, firCount: null, firPerSec: null, bytesReceived: null, bitrate: null,
      frameWidth: size.recW ?? null, frameHeight: size.recH ?? null,
    } : null,
    remoteInbound: null,
    network: {
      rttMs: null, route: 'unknown', localCandidateType: null, remoteCandidateType: null,
      protocol: null, availableOutgoingBitrate: null, availableIncomingBitrate: null,
      selectedPairId: null, selection: 'none',
    },
    playback: null,
  };
}

test('exportação separa pedido, track, origem, codificado e recebido', () => {
  const probe = capture(1280, 720);
  const facts = resolutionFacts(probe, sample('sender', 'conn-a', { sourceW: 1280, sourceH: 720, encW: 588, encH: 278 }));
  equal(facts.requested.width, 1920);
  equal(facts.requested.height, 1080);
  equal(facts.capturedTrack.width, 1280);
  equal(facts.capturedTrack.height, 720);
  equal(facts.webrtcSource.width, 1280);
  equal(facts.encoded.width, 588);
  equal(facts.encoded.height, 278);
  equal(facts.received.width, null);
  equal(facts.received.height, null);

  const report = buildReport({
    sessionId: 's',
    collectedFrom: 1,
    streamConfig: { resolution: '1080', frameRate: 30, audio: true, audioMode: 'source' },
    history: [sample('sender', 'conn-a', { sourceW: 1280, sourceH: 720, encW: 588, encH: 278 })],
    playback: [],
    events: [],
    diagnoses: [],
    capture: probe,
    encoder: {
      connectionId: 'conn-a',
      before: readEncoderEncoding({ encodings: [{}] }),
      after: readEncoderEncoding({
        degradationPreference: 'maintain-framerate',
        encodings: [{ maxBitrate: 6_000_000, maxFramerate: 30, scaleResolutionDownBy: 1 }],
      }),
    },
  });
  equal(report.connectionId, 'conn-a');
  equal(report.resolution.requested.height, 1080);
  equal(report.resolution.capturedTrack.height, 720);
  equal(report.resolution.encoded.width, 588);
  equal(report.resolution.received.width, null);
  equal(report.encoder?.connectionId, 'conn-a');
  equal(report.encoder?.before.scaleResolutionDownBy, null);
  equal(report.encoder?.after?.scaleResolutionDownBy, 1);
  equal(report.capture?.capabilities?.width?.max, 1920);
  equal(report.capture?.capabilities?.height?.min, null);
});

test('duas conexões guardam parâmetros de encoder independentes', () => {
  const probes = new Map<string, EncoderProbe>([
    ['conn-a', {
      connectionId: 'conn-a',
      before: readEncoderEncoding(null),
      after: readEncoderEncoding({ encodings: [{ maxBitrate: 6_000_000, scaleResolutionDownBy: 1 }] }),
    }],
    ['conn-b', {
      connectionId: 'conn-b',
      before: readEncoderEncoding(null),
      after: readEncoderEncoding({ encodings: [{ maxBitrate: 1_500_000, scaleResolutionDownBy: 3 }] }),
    }],
  ]);
  const left = buildReport({
    sessionId: 's',
    collectedFrom: 1,
    streamConfig: { resolution: '1080', frameRate: 30, audio: true },
    history: [sample('sender', 'conn-a', { encW: 1920, encH: 1080 })],
    playback: [],
    events: [],
    diagnoses: [],
    capture: capture(1920, 1080),
    encoder: probes.get('conn-a') ?? null,
  });
  const right = buildReport({
    sessionId: 's',
    collectedFrom: 1,
    streamConfig: { resolution: '1080', frameRate: 30, audio: true },
    history: [sample('sender', 'conn-b', { encW: 640, encH: 360 })],
    playback: [],
    events: [],
    diagnoses: [],
    capture: capture(1920, 1080),
    encoder: probes.get('conn-b') ?? null,
  });
  equal(left.encoder?.connectionId, 'conn-a');
  equal(right.encoder?.connectionId, 'conn-b');
  equal(left.encoder?.after?.maxBitrate, 6_000_000);
  equal(right.encoder?.after?.maxBitrate, 1_500_000);
  equal(left.encoder?.after?.scaleResolutionDownBy, 1);
  equal(right.encoder?.after?.scaleResolutionDownBy, 3);
  equal(left.resolution.encoded.width, 1920);
  equal(right.resolution.encoded.width, 640);
  equal(left.resolution.capturedTrack.width, 1920);
  equal(right.resolution.received.width, null);

  const viewer = buildReport({
    sessionId: 's',
    collectedFrom: 1,
    streamConfig: null,
    history: [sample('receiver', 'conn-v', { recW: 588, recH: 278 })],
    playback: [],
    events: [],
    diagnoses: [],
    capture: null,
    encoder: null,
  });
  equal(viewer.resolution.requested.width, null);
  equal(viewer.resolution.capturedTrack.width, null);
  equal(viewer.resolution.webrtcSource.width, null);
  equal(viewer.resolution.encoded.width, null);
  equal(viewer.resolution.received.width, 588);
  equal(viewer.resolution.received.height, 278);
});

test('describeCapture mostra resolução e fps medidos', () => {
  equal(describeCapture({ width: 1920, height: 1080, frameRate: 30, displaySurface: 'monitor', aspectRatio: null, resizeMode: null }), '1920×1080 · 30 fps');
});

test('describeCapture sem frameRate mostra só a resolução', () => {
  equal(describeCapture({ width: 1280, height: 720, frameRate: null, displaySurface: null, aspectRatio: null, resizeMode: null }), '1280×720');
});

test('describeCapture sem dimensões medidas fica n/d e não estima', () => {
  equal(describeCapture({ width: null, height: null, frameRate: 30, displaySurface: null, aspectRatio: null, resizeMode: null }), 'n/d');
  equal(describeCapture(null), 'n/d');
});
