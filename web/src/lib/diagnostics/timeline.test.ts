import { test } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { buildReport, sanitize } from './export.ts';
import { ConnectionMonitor } from './monitor.ts';
import { SessionTimeline } from './timeline.ts';
import { EVENT_LIMIT, HISTORY_LIMIT, type PlaybackSample } from './types.ts';

function connectedPc() {
  return {
    connectionState: 'connected',
    iceConnectionState: 'connected',
    async getStats() {
      return new Map();
    },
  };
}

function playback(timestamp: number): PlaybackSample {
  return {
    timestamp,
    presentedFps: null, presentedFrames: null, totalPresentedFrames: null, droppedFrames: null,
    droppedFps: null, corruptedFrames: null, corruptedFps: null, irregularIntervals: 0,
    freezeSuspected: false, paused: false, api: 'none',
    visibilityState: 'visible', hasFocus: true, videoWidth: null, videoHeight: null,
    currentTime: null, readyState: 4, qualityTotalDelta: null, qualityDisplayedEstimate: null,
    maxMediaTimeGapSec: null, processingDuration: null, compositionLeadSec: null,
    lastFrame: null, stall: 'measurement-unavailable',
  };
}

test('sessão iniciada, primeiro espectador, 60 segundos, segundo espectador e dois ativos', () => {
  let now = 1_700_000_000_000;
  const timeline = new SessionTimeline(() => now);
  equal(timeline.sessionStartedAt, now);

  now += 1_000;
  timeline.transmissionStarted();
  timeline.viewerRequested();
  timeline.setViewerCount(1);
  timeline.peerConnectionCreated('conn-1');
  timeline.offerSent('conn-1');
  timeline.answerReceived('conn-1');
  timeline.connectionEstablished('conn-1');
  timeline.iceConnected('conn-1');
  timeline.firstSample('conn-1');
  timeline.firstVideo('conn-1');

  now += 60_000;
  timeline.viewerRequested();
  timeline.setViewerCount(2);
  timeline.peerConnectionCreated('conn-2');
  timeline.offerSent('conn-2');
  timeline.answerReceived('conn-2');
  timeline.connectionEstablished('conn-2');

  const events = timeline.snapshot();
  equal(events[0].type, 'transmission-started');
  equal(events[0].viewerCount, 0);
  ok(events[0].timestamp >= timeline.sessionStartedAt);

  const created = events.filter((event) => event.type === 'peer-connection-created');
  equal(created.length, 2);
  equal(created[0].connectionId, 'conn-1');
  equal(created[0].viewerCount, 1);
  equal(created[1].connectionId, 'conn-2');
  equal(created[1].viewerCount, 2);
  equal(created[1].timestamp - created[0].timestamp, 60_000);

  const secondRequest = events.filter((event) => event.type === 'viewer-requested')[1];
  equal(secondRequest.viewerCount, 1);
  equal(secondRequest.timestamp, created[1].timestamp);
  ok(events.filter((event) => event.timestamp < created[1].timestamp).every((event) => event.viewerCount < 2));
  ok(events.some((event) => event.type === 'viewer-count-changed' && event.viewerCount === 2));

  const sequences = events.map((event) => event.sequence);
  deepEqual(sequences, sequences.map((_, index) => index + 1));
});

test('reconexão substitui a conexão e a saída reduz os espectadores', () => {
  let now = 5_000;
  const timeline = new SessionTimeline(() => now);
  timeline.setViewerCount(2);
  timeline.peerConnectionCreated('conn-1');
  timeline.peerConnectionCreated('conn-2');

  now += 60_000;
  timeline.connectionClosed('conn-1');
  timeline.peerConnectionCreated('conn-1b');
  timeline.reconnected('conn-1b');
  const during = timeline.snapshot();
  equal(during.filter((event) => event.type === 'viewer-disconnected').length, 0);
  equal(during[during.length - 2].type, 'peer-connection-created');
  equal(during[during.length - 1].type, 'reconnected');
  equal(during[during.length - 1].connectionId, 'conn-1b');
  equal(during[during.length - 1].viewerCount, 2);

  timeline.setViewerCount(1);
  timeline.connectionClosed('conn-2');
  timeline.viewerDisconnected('conn-2');
  const events = timeline.snapshot();
  const count = events.filter((event) => event.type === 'viewer-count-changed');
  equal(count[count.length - 1].viewerCount, 1);
  equal(events[events.length - 1].type, 'viewer-disconnected');
  equal(events[events.length - 1].connectionId, 'conn-2');
  equal(events[events.length - 1].viewerCount, 1);
});

test('dois monitores nascem em horários diferentes e o remetente exporta a mesma linha do tempo', async () => {
  let now = 20_000;
  const timeline = new SessionTimeline(() => now);
  const sessionTimeline = () => ({
    sessionStartedAt: timeline.sessionStartedAt,
    events: timeline.snapshot(),
  });
  const context = { viewerCount: 1, configuredFps: 30, streamConfig: null, adaptiveState: null };

  timeline.transmissionStarted();
  timeline.viewerRequested();
  timeline.setViewerCount(1);
  const firstCreated = now;
  const first = new ConnectionMonitor({
    pc: connectedPc(),
    role: 'sender',
    sessionId: 'sess',
    connectionId: 'conn-1',
    now: () => now,
    connectionCreatedAt: firstCreated,
    onFirstSample: (connectionId) => timeline.firstSample(connectionId),
    onConnected: (connectionId) => timeline.connectionEstablished(connectionId),
    sessionTimeline,
    getContext: () => context,
  });
  first.start();
  timeline.peerConnectionCreated('conn-1');
  await first.tick();

  now += 60_000;
  timeline.viewerRequested();
  timeline.setViewerCount(2);
  const secondCreated = now;
  const second = new ConnectionMonitor({
    pc: connectedPc(),
    role: 'sender',
    sessionId: 'sess',
    connectionId: 'conn-2',
    now: () => now,
    connectionCreatedAt: secondCreated,
    onFirstSample: (connectionId) => timeline.firstSample(connectionId),
    onConnected: (connectionId) => timeline.connectionEstablished(connectionId),
    sessionTimeline,
    getContext: () => ({ ...context, viewerCount: 2 }),
  });
  second.start();
  timeline.peerConnectionCreated('conn-2');
  await second.tick();

  const left = first.exportReport();
  const right = second.exportReport();
  equal(left.connectionCreatedAt, firstCreated);
  equal(right.connectionCreatedAt, secondCreated);
  equal((right.connectionCreatedAt ?? 0) - (left.connectionCreatedAt ?? 0), 60_000);
  equal(left.monitorStartedAt, firstCreated);
  equal(right.monitorStartedAt, secondCreated);
  equal(left.collectedFrom, left.monitorStartedAt);
  equal(left.sessionStartedAt, timeline.sessionStartedAt);
  equal(left.firstSampleAt, firstCreated);
  ok(left.firstSampleAt !== right.firstSampleAt);
  equal(left.firstConnectedAt, firstCreated);
  deepEqual(left.timeline, right.timeline);
  equal(left.timeline.filter((event) => event.type === 'peer-connection-created').length, 2);
  equal(JSON.stringify(left.timeline).includes('peerId'), false);
  equal(JSON.stringify(left.timeline).includes('nickname'), false);

  const viewer = new ConnectionMonitor({
    pc: connectedPc(),
    role: 'receiver',
    sessionId: 'sess',
    connectionId: 'conn-1',
    now: () => now,
    connectionCreatedAt: firstCreated,
    sessionTimeline,
    getContext: () => ({ viewerCount: null, configuredFps: null, streamConfig: null, adaptiveState: null }),
  });
  const receiver = viewer.exportReport();
  equal(receiver.timeline.some((event) => event.connectionId === 'conn-2'), false);
  equal(receiver.timeline.some((event) => event.connectionId === 'conn-1'), true);
  equal(receiver.connectionCreatedAt, firstCreated);
  equal(receiver.monitorStartedAt, null);
  equal(receiver.firstSampleAt, null);
  equal(receiver.firstConnectedAt, null);
  viewer.stop();
  first.stop();
  second.stop();
});

test('histórico passa de 120 amostras e para em 600, sem perder o primeiro instante', async () => {
  let now = 30_000;
  const monitor = new ConnectionMonitor({
    pc: connectedPc(),
    role: 'sender',
    sessionId: 'sess',
    connectionId: 'conn-1',
    connectionCreatedAt: now,
    now: () => now,
    getContext: () => ({ viewerCount: 1, configuredFps: 30, streamConfig: null, adaptiveState: null }),
  });
  monitor.start();
  await monitor.tick();
  const opened = monitor.exportReport();
  equal(opened.firstSampleAt, now);
  equal(opened.collectedFrom, opened.monitorStartedAt);
  equal(opened.connectionCreatedAt, now);

  for (let i = 0; i < 130; i += 1) {
    now += 1_000;
    await monitor.tick();
  }
  ok(monitor.getHistory().length > 120);

  for (let i = monitor.getHistory().length; i < HISTORY_LIMIT + 1; i += 1) {
    now += 1_000;
    await monitor.tick();
  }
  const report = monitor.exportReport();
  equal(report.history.length, HISTORY_LIMIT);
  equal(report.diagnoses.length, HISTORY_LIMIT);
  equal(report.firstSampleAt, opened.firstSampleAt);
  ok(report.history[0].timestamp !== report.firstSampleAt);
  equal(report.collectedTo, report.history[report.history.length - 1].timestamp);
  equal(report.collectedFrom, opened.monitorStartedAt);

  for (let i = 0; i < HISTORY_LIMIT + 1; i += 1) monitor.pushPlayback(playback(40_000 + i));
  equal(monitor.exportReport().playback.length, HISTORY_LIMIT);

  for (let i = 0; i < EVENT_LIMIT + 1; i += 1) {
    monitor.recordEvent({ category: 'SISTEMA', severity: 'info', message: 'marco', data: {} });
  }
  equal(monitor.exportReport().events.length, EVENT_LIMIT);
  monitor.stop();
});

test('horário ausente permanece null e a linha do tempo não leva dado pessoal', () => {
  const report = buildReport({
    sessionId: 'sess',
    collectedFrom: 1000,
    streamConfig: null,
    history: [],
    playback: [],
    events: [],
    diagnoses: [],
  });
  equal(report.collectedTo, null);
  equal(report.sessionStartedAt, null);
  equal(report.connectionCreatedAt, null);
  equal(report.monitorStartedAt, null);
  equal(report.firstConnectedAt, null);
  equal(report.firstSampleAt, null);
  equal(report.timeline.length, 0);
  equal(report.collectedFrom, 1000);

  const clean = sanitize({
    timeline: [{
      timestamp: 1,
      sequence: 1,
      type: 'viewer-requested',
      connectionId: 'conn-1',
      viewerCount: 1,
      nickname: 'Ana',
      peerId: 'p9',
      address: '10.0.0.8',
    }],
  }) as { timeline: Record<string, unknown>[] };
  equal(clean.timeline[0].connectionId, 'conn-1');
  equal(clean.timeline[0].viewerCount, 1);
  ok(!('nickname' in clean.timeline[0]));
  ok(!('peerId' in clean.timeline[0]));
  ok(!('address' in clean.timeline[0]));
});
