import { test } from 'node:test';
import { equal, ok } from 'node:assert/strict';
import { AdaptiveBitrateController, evaluateAbr, initialAbrState, outboundFpsForAbr } from './abr.ts';
import { classifyDiagnosis, diagnosisSummary } from './classify.ts';
import { detectEvents } from './events.ts';
import { buildReport, parseBrowser, sanitize } from './export.ts';
import { formatMeasuredFps, pipelineFps } from './format.ts';
import { selectNetwork } from './ice.ts';
import { avgMsPerFrame, bitrateFromBytes, diffCounter, lossPercent, perSecond } from './math.ts';
import { ConnectionMonitor } from './monitor.ts';
import { buildSample, emptyCounters } from './parse.ts';
import { PlaybackMonitor, type PlaybackVideo, type VideoFrameMetadataLike } from './playback.ts';
import type { InboundMetrics, MetricSample, OutboundMetrics, PlaybackSample, StatsReportLike } from './types.ts';

function outbound(partial: Partial<OutboundMetrics> = {}): OutboundMetrics {
  return {
    reportedFps: null, encodedFps: null, framesEncoded: null, sourceFps: null, sourceWidth: null,
    sourceHeight: null, sourceId: null, frameProductionVariation: null, sourceToEncodedGap: null,
    encodeTimePerFrameMs: null, totalEncodeTime: null, qualityLimitationReason: null,
    qualityLimitationDurations: null, targetBitrate: null, bytesSent: null, bitrate: null,
    frameWidth: null, frameHeight: null, keyFramesEncoded: null, keyFramesPerSec: null,
    nackCount: null, nackPerSec: null, pliCount: null, pliPerSec: null, firCount: null, firPerSec: null,
    ...partial,
  };
}

function inbound(partial: Partial<InboundMetrics> = {}): InboundMetrics {
  return {
    reportedFps: null, receivedFps: null, framesReceived: null, decodedFps: null, framesDecoded: null,
    droppedFps: null, framesDropped: null, decodeTimePerFrameMs: null, totalDecodeTime: null,
    keyFramesDecoded: null, keyFramesPerSec: null, packetsReceived: null, packetsLost: null, lossPct: null,
    jitterMs: null, jitterBufferAvgDelayMs: null, jitterBufferDelay: null, jitterBufferEmittedCount: null,
    freezes: null, freezeCount: null, freezeDurationSec: null, totalFreezesDuration: null,
    nackCount: null, nackPerSec: null, pliCount: null, pliPerSec: null, firCount: null, firPerSec: null,
    bytesReceived: null, bitrate: null, frameWidth: null, frameHeight: null,
    ...partial,
  };
}

function playback(partial: Partial<PlaybackSample> = {}): PlaybackSample {
  return {
    timestamp: partial.timestamp ?? 0,
    presentedFps: null, presentedFrames: null, totalPresentedFrames: null, droppedFrames: null,
    droppedFps: null, corruptedFrames: null, corruptedFps: null, irregularIntervals: 0,
    freezeSuspected: false, paused: false, api: 'rvfc',
    visibilityState: 'visible', hasFocus: true, videoWidth: null, videoHeight: null,
    currentTime: null, readyState: 4, qualityTotalDelta: null, qualityDisplayedEstimate: null,
    maxMediaTimeGapSec: null, processingDuration: null, compositionLeadSec: null,
    lastFrame: null, stall: 'none',
    ...partial,
  };
}

function sample(partial: Partial<MetricSample> & Pick<MetricSample, 'timestamp' | 'role'>): MetricSample {
  return {
    connectionId: 'c1',
    viewerCount: partial.role === 'sender' ? 1 : null,
    configuredFps: null,
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
    outbound: null,
    inbound: null,
    remoteInbound: null,
    playback: null,
    ...partial,
    network: { ...{
      rttMs: 40, route: 'direct' as const, localCandidateType: 'host', remoteCandidateType: 'srflx',
      protocol: 'udp', availableOutgoingBitrate: null, availableIncomingBitrate: null,
      selectedPairId: 'pair', selection: 'transport' as const,
    }, ...partial.network },
  };
}

function repeat(count: number, make: (index: number) => MetricSample): MetricSample[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('FPS medido zero não é trocado pelo FPS configurado', () => {
  equal(formatMeasuredFps(0), '0');
  equal(formatMeasuredFps(null), 'n/d');
  const measured = pipelineFps(sample({
    timestamp: 1,
    role: 'sender',
    configuredFps: 30,
    outbound: outbound({ encodedFps: 0, reportedFps: 0, sourceFps: 0 }),
  }));
  equal(measured.requested, 30);
  equal(measured.encoded, 0);
  equal(measured.source, 0);
  const missing = pipelineFps(sample({ timestamp: 1, role: 'receiver', configuredFps: 30 }));
  equal(missing.received, null);
  equal(missing.decoded, null);
  equal(missing.presented, null);
});

test('contadores cumulativos, reinício e divisões inválidas', () => {
  equal(diffCounter(130, 100).delta, 30);
  equal(diffCounter(130, 100).reset, false);
  equal(diffCounter(5, 100).delta, null);
  equal(diffCounter(5, 100).reset, true);
  equal(perSecond(0, 1000), 0);
  equal(perSecond(30, 1000), 30);
  equal(perSecond(10, 0), null);
  equal(perSecond(10, 50), null);
  equal(bitrateFromBytes(125_000, 1000), 1_000_000);
  equal(lossPercent(5, 95), 5);
  equal(lossPercent(0, 0), null);
  equal(avgMsPerFrame(0.03, 10), 3);
  equal(avgMsPerFrame(0.03, 0), null);
});

test('parse separa inbound de outbound e preserva zero e campo ausente', () => {
  const first = buildSample({
    reports: [
      { id: 'out', type: 'outbound-rtp', kind: 'video', timestamp: 1000, framesEncoded: 100, framesPerSecond: 24, bytesSent: 1000, codecId: 'vh' },
      { id: 'in', type: 'inbound-rtp', kind: 'video', timestamp: 1000, framesReceived: 80, framesDecoded: 80, framesPerSecond: 5, bytesReceived: 500, packetsReceived: 0, packetsLost: 0, jitter: 0 },
      { id: 'vh', type: 'codec', mimeType: 'video/H264' },
    ],
    previous: emptyCounters(),
    role: 'sender',
    wallTime: 1,
    connectionId: 'c1',
    viewerCount: 1,
    configuredFps: 30,
    connectionState: 'connected',
    iceConnectionState: 'connected',
    playback: null,
  });
  equal(first.sample.outbound?.reportedFps, 24);
  equal(first.sample.inbound?.reportedFps, 5);
  equal(first.sample.outbound?.encodedFps, null);
  equal(first.sample.videoCodec, 'H264');

  const second = buildSample({
    reports: [
      { id: 'out', type: 'outbound-rtp', kind: 'video', timestamp: 2000, framesEncoded: 130, framesPerSecond: 24, bytesSent: 126000 },
      { id: 'in', type: 'inbound-rtp', kind: 'video', timestamp: 2000, framesReceived: 90, framesDecoded: 88, framesPerSecond: 5, bytesReceived: 500, packetsReceived: 95, packetsLost: 5, jitter: 0.012, totalDecodeTime: 0.3 },
    ],
    previous: first.counters,
    role: 'sender',
    wallTime: 2,
    connectionId: 'c1',
    viewerCount: 1,
    configuredFps: 30,
    connectionState: 'connected',
    iceConnectionState: 'connected',
    playback: null,
  });
  equal(second.sample.outbound?.encodedFps, 30);
  equal(second.sample.inbound?.receivedFps, 10);
  equal(second.sample.inbound?.decodedFps, 8);
  equal(second.sample.inbound?.jitterMs, 12);
  equal(second.sample.inbound?.lossPct, 5);
  equal(second.sample.outbound?.bitrate, 1_000_000);
  ok(second.sample.outbound?.encodedFps !== second.sample.inbound?.receivedFps);

  const reset = buildSample({
    reports: [
      { id: 'out', type: 'outbound-rtp', kind: 'video', timestamp: 3000, framesEncoded: 4, framesPerSecond: 0 },
    ],
    previous: second.counters,
    role: 'sender',
    wallTime: 3,
    connectionId: 'c1',
    viewerCount: 1,
    configuredFps: 30,
    connectionState: 'connected',
    iceConnectionState: 'connected',
    playback: null,
  });
  equal(reset.sample.countersReset, true);
  equal(reset.sample.outbound?.encodedFps, null);
  equal(reset.sample.outbound?.reportedFps, 0);

  const after = buildSample({
    reports: [
      { id: 'out', type: 'outbound-rtp', kind: 'video', timestamp: 4000, framesEncoded: 34 },
    ],
    previous: reset.counters,
    role: 'sender',
    wallTime: 4,
    connectionId: 'c1',
    viewerCount: 1,
    configuredFps: 30,
    connectionState: 'connected',
    iceConnectionState: 'connected',
    playback: null,
  });
  equal(after.sample.countersReset, false);
  equal(after.sample.outbound?.encodedFps, 30);
  equal(after.sample.outbound?.reportedFps, null);
  equal(pipelineFps(after.sample).encoded, 30);
  equal(pipelineFps(after.sample).requested, 30);
});

test('FPS zero sustentado no receptor continua zero e indica recepção', () => {
  const history = [
    ...repeat(6, (i) => sample({
      timestamp: i * 1000, role: 'receiver', configuredFps: 30,
      inbound: inbound({ receivedFps: 30, decodedFps: 30, lossPct: 0, jitterMs: 4, decodeTimePerFrameMs: 6 }),
    })),
    ...repeat(3, (i) => sample({
      timestamp: (6 + i) * 1000, role: 'receiver', configuredFps: 30,
      inbound: inbound({ receivedFps: 0, decodedFps: 0, lossPct: 0, jitterMs: 4, decodeTimePerFrameMs: 6 }),
    })),
  ];
  const diagnosis = classifyDiagnosis(history);
  equal(diagnosis.category, 'RECEPÇÃO');
  equal(diagnosis.state, 'CRÍTICO');
  const received = diagnosis.evidence.find((item) => item.name === 'FPS recebido');
  equal(received?.value.startsWith('0'), true);
  ok(!diagnosis.evidence.some((item) => item.value.startsWith('30') && item.name === 'FPS recebido'));
});

test('transmissão estável fica normal, inclusive em rota TURN', () => {
  const history = repeat(8, (i) => sample({
    timestamp: i * 1000,
    role: 'receiver',
    network: { rttMs: 40, route: 'relay', localCandidateType: 'relay', remoteCandidateType: 'host', protocol: 'udp', availableOutgoingBitrate: null, availableIncomingBitrate: null, selectedPairId: 'p', selection: 'transport' },
    inbound: inbound({ receivedFps: 30, decodedFps: 30, lossPct: 0, jitterMs: 5, decodeTimePerFrameMs: 6 }),
    playback: playback({ timestamp: i * 1000, presentedFps: 30, droppedFps: 0 }),
  }));
  const diagnosis = classifyDiagnosis(history);
  equal(diagnosis.state, 'NORMAL');
  equal(diagnosisSummary(diagnosis), 'Transmissão normal');
});

test('perda crescente com piora de recepção indica rede', () => {
  const history = [
    ...repeat(6, (i) => sample({
      timestamp: i * 1000, role: 'receiver',
      inbound: inbound({ receivedFps: 30, decodedFps: 30, lossPct: 0.2, jitterMs: 8 }),
    })),
    ...repeat(3, (i) => sample({
      timestamp: (6 + i) * 1000, role: 'receiver',
      inbound: inbound({ receivedFps: 12, decodedFps: 12, lossPct: 9, jitterMs: 40 }),
    })),
  ];
  const diagnosis = classifyDiagnosis(history);
  equal(diagnosis.category, 'REDE/TRANSPORTE');
  equal(diagnosis.state, 'CRÍTICO');
  equal(diagnosisSummary(diagnosis), 'Possível problema de rede');
});

test('jitter elevado indica rede mesmo com frames estáveis', () => {
  const history = repeat(3, (i) => sample({
    timestamp: i * 1000,
    role: 'receiver',
    inbound: inbound({ receivedFps: 30, decodedFps: 30, lossPct: 0, jitterMs: 120 }),
  }));
  const diagnosis = classifyDiagnosis(history);
  equal(diagnosis.category, 'REDE/TRANSPORTE');
  equal(diagnosis.state, 'ATENÇÃO');
});

test('aumento do tempo de decodificação com recepção estável indica decoder', () => {
  const history = [
    ...repeat(6, (i) => sample({
      timestamp: i * 1000, role: 'receiver',
      inbound: inbound({ receivedFps: 30, decodedFps: 30, lossPct: 0, jitterMs: 4, decodeTimePerFrameMs: 8 }),
    })),
    ...repeat(3, (i) => sample({
      timestamp: (6 + i) * 1000, role: 'receiver',
      inbound: inbound({ receivedFps: 30, decodedFps: 30, lossPct: 0, jitterMs: 4, decodeTimePerFrameMs: 30 }),
    })),
  ];
  const diagnosis = classifyDiagnosis(history);
  equal(diagnosis.category, 'DECODIFICAÇÃO');
  equal(diagnosis.state, 'ATENÇÃO');
});

test('frames recebidos estáveis e decodificados em queda indicam decoder', () => {
  const history = [
    ...repeat(6, (i) => sample({
      timestamp: i * 1000, role: 'receiver',
      inbound: inbound({ receivedFps: 30, decodedFps: 30, lossPct: 0, jitterMs: 4, decodeTimePerFrameMs: 8 }),
    })),
    ...repeat(3, (i) => sample({
      timestamp: (6 + i) * 1000, role: 'receiver',
      inbound: inbound({ receivedFps: 30, decodedFps: 10, lossPct: 0, jitterMs: 4, decodeTimePerFrameMs: 40 }),
    })),
  ];
  const diagnosis = classifyDiagnosis(history);
  equal(diagnosis.category, 'DECODIFICAÇÃO');
  equal(diagnosis.state, 'CRÍTICO');
});

test('descartes na reprodução com decodificação estável indicam reprodução', () => {
  const history = [
    ...repeat(6, (i) => sample({
      timestamp: i * 1000, role: 'receiver',
      inbound: inbound({ receivedFps: 30, decodedFps: 30, lossPct: 0, jitterMs: 4 }),
      playback: playback({ timestamp: i * 1000, presentedFps: 30, droppedFps: 0 }),
    })),
    ...repeat(3, (i) => sample({
      timestamp: (6 + i) * 1000, role: 'receiver',
      inbound: inbound({ receivedFps: 30, decodedFps: 30, lossPct: 0, jitterMs: 4 }),
      playback: playback({ timestamp: (6 + i) * 1000, presentedFps: 28, droppedFps: 8 }),
    })),
  ];
  const diagnosis = classifyDiagnosis(history);
  equal(diagnosis.category, 'REPRODUÇÃO');
  equal(diagnosisSummary(diagnosis), 'Possível problema de reprodução');
});

test('pausa não vira falha de reprodução e histórico curto é indeterminado', () => {
  const paused = repeat(8, (i) => sample({
    timestamp: i * 1000, role: 'receiver',
    inbound: inbound({ receivedFps: 30, decodedFps: 30, lossPct: 0, jitterMs: 4 }),
    playback: playback({ timestamp: i * 1000, presentedFps: 0, paused: true }),
  }));
  equal(classifyDiagnosis(paused).category, 'NENHUMA');
  const short = repeat(2, (i) => sample({
    timestamp: i, role: 'receiver',
    inbound: inbound({ receivedFps: 0, decodedFps: 0 }),
  }));
  const diagnosis = classifyDiagnosis(short);
  equal(diagnosis.state, 'INDETERMINADO');
  equal(diagnosisSummary(diagnosis), 'Dados insuficientes para diagnóstico');
});

test('captura e codificação, banda, escala e separação de direção', () => {
  const capture = [
    ...repeat(6, (i) => sample({
      timestamp: i, role: 'sender', viewerCount: 1, configuredFps: 30,
      outbound: outbound({ encodedFps: 30, reportedFps: 30, sourceFps: 30, qualityLimitationReason: 'none' }),
    })),
    ...repeat(3, (i) => sample({
      timestamp: 10 + i, role: 'sender', viewerCount: 1, configuredFps: 30,
      outbound: outbound({ encodedFps: 10, reportedFps: 10, sourceFps: 10, qualityLimitationReason: 'none' }),
    })),
  ];
  equal(classifyDiagnosis(capture).category, 'CAPTURA/CODIFICAÇÃO');

  const bandwidth = [
    ...repeat(6, (i) => sample({
      timestamp: i, role: 'sender', viewerCount: 1,
      outbound: outbound({ encodedFps: 30, sourceFps: 30, qualityLimitationReason: 'none' }),
    })),
    ...repeat(3, (i) => sample({
      timestamp: 10 + i, role: 'sender', viewerCount: 1,
      outbound: outbound({ encodedFps: 12, sourceFps: 30, qualityLimitationReason: 'bandwidth' }),
    })),
  ];
  equal(classifyDiagnosis(bandwidth).category, 'REDE/TRANSPORTE');

  const scale = [
    ...repeat(6, (i) => sample({
      timestamp: i, role: 'sender', viewerCount: 1,
      outbound: outbound({ encodedFps: 30, sourceFps: 30, qualityLimitationReason: 'none' }),
    })),
    ...repeat(3, (i) => sample({
      timestamp: 10 + i, role: 'sender', viewerCount: 3,
      outbound: outbound({ encodedFps: 12, sourceFps: 30, qualityLimitationReason: 'bandwidth' }),
    })),
  ];
  const scaleDiagnosis = classifyDiagnosis(scale);
  equal(scaleDiagnosis.category, 'ESCALA');
  equal(scaleDiagnosis.confidence, 'médio');

  const senderIgnoresInbound = repeat(8, (i) => sample({
    timestamp: i, role: 'sender', viewerCount: 1,
    outbound: outbound({ encodedFps: 30, sourceFps: 30, qualityLimitationReason: 'none' }),
    inbound: inbound({ receivedFps: 0, decodedFps: 0, lossPct: 40, jitterMs: 200 }),
  }));
  equal(classifyDiagnosis(senderIgnoresInbound).state, 'NORMAL');

  const receiverIgnoresOutbound = repeat(8, (i) => sample({
    timestamp: i, role: 'receiver',
    outbound: outbound({ encodedFps: 0, sourceFps: 0 }),
    inbound: inbound({ receivedFps: 30, decodedFps: 30, lossPct: 0, jitterMs: 4 }),
  }));
  equal(classifyDiagnosis(receiverIgnoresOutbound).state, 'NORMAL');
});

test('seleção do par ICE não usa um succeeded arbitrário', () => {
  const reports: StatsReportLike[] = [
    { id: 'transport', type: 'transport', selectedCandidatePairId: 'good' },
    { id: 'bad', type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.4, localCandidateId: 'l1', remoteCandidateId: 'r1' },
    { id: 'good', type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.05, localCandidateId: 'l2', remoteCandidateId: 'r2', availableOutgoingBitrate: 2_000_000 },
    { id: 'l1', type: 'local-candidate', candidateType: 'relay', protocol: 'udp', address: '1.2.3.4' },
    { id: 'r1', type: 'remote-candidate', candidateType: 'relay', protocol: 'udp', address: '5.6.7.8' },
    { id: 'l2', type: 'local-candidate', candidateType: 'host', protocol: 'udp', address: '10.0.0.8' },
    { id: 'r2', type: 'remote-candidate', candidateType: 'srflx', protocol: 'udp', address: '8.8.8.8' },
  ];
  const selected = selectNetwork(reports);
  equal(selected.selection, 'transport');
  equal(selected.selectedPairId, 'good');
  equal(selected.rttMs, 50);
  equal(selected.route, 'direct');
  equal(selected.localCandidateType, 'host');
  equal(selected.protocol, 'udp');
  ok(!JSON.stringify(selected).includes('1.2.3.4'));
  ok(!JSON.stringify(selected).includes('10.0.0.8'));

  const ambiguous = selectNetwork([
    { id: 'a', type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.2 },
    { id: 'b', type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.9 },
  ]);
  equal(ambiguous.selection, 'none');
  equal(ambiguous.rttMs, null);

  const legacy = selectNetwork([
    { id: 'a', type: 'candidate-pair', state: 'succeeded', selected: true, currentRoundTripTime: 0.02, localCandidateId: 'l', remoteCandidateId: 'r' },
    { id: 'b', type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.8 },
    { id: 'l', type: 'local-candidate', candidateType: 'srflx' },
    { id: 'r', type: 'remote-candidate', candidateType: 'host' },
  ]);
  equal(legacy.selection, 'selected');
  equal(legacy.rttMs, 20);
  equal(legacy.route, 'direct');

  const nominated = selectNetwork([
    { id: 'a', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.11, localCandidateId: 'l', remoteCandidateId: 'r' },
    { id: 'b', type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.01 },
    { id: 'l', type: 'local-candidate', candidateType: 'relay', protocol: 'tcp' },
    { id: 'r', type: 'remote-candidate', candidateType: 'host' },
  ]);
  equal(nominated.selection, 'nominated');
  equal(nominated.route, 'relay');
  equal(nominated.rttMs, 110);
});

test('ABR usa FPS outbound, trata zero e ignora métrica ausente', () => {
  let state = initialAbrState(30, 1_000_000);
  const unavailable = evaluateAbr(state, null);
  equal(unavailable.action, 'hold');
  equal(unavailable.reason, 'unavailable');
  equal(unavailable.state.lowFpsCount, 0);

  state = evaluateAbr(state, 0).state;
  state = evaluateAbr(state, 0).state;
  const third = evaluateAbr(state, 0);
  equal(third.action, 'decrease');
  equal(third.nextBitrate, 700_000);
  equal(third.fps, 0);

  const mixed = sample({
    timestamp: 1,
    role: 'sender',
    outbound: outbound({ encodedFps: 0, reportedFps: 30 }),
    inbound: inbound({ receivedFps: 30, reportedFps: 30 }),
  });
  equal(outboundFpsForAbr(mixed), 0);

  const applied: number[] = [];
  const controller = new AdaptiveBitrateController(
    { applyMaxBitrate: (bitrate) => applied.push(bitrate) },
    30,
    1_000_000,
  );
  const low = sample({ timestamp: 0, role: 'sender', outbound: outbound({ encodedFps: 0 }) });
  for (let i = 0; i < 5; i += 1) controller.onSample({ ...low, timestamp: i });
  equal(applied.length, 0);
  controller.onSample({ ...low, timestamp: 5 });
  equal(applied.length, 1);
  equal(applied[0], 700_000);
  controller.onSample(sample({
    timestamp: 6,
    role: 'receiver',
    inbound: inbound({ receivedFps: 1, reportedFps: 1 }),
  }));
  equal(applied.length, 1);
});

test('monitor coleta sem painel, evita sobreposição, limita e limpa o histórico', async () => {
  let release: () => void = () => {};
  let calls = 0;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const slow = {
    connectionState: 'connected',
    iceConnectionState: 'connected',
    async getStats() {
      calls += 1;
      await pending;
      return new Map([['out', { id: 'out', type: 'outbound-rtp', kind: 'video', timestamp: 1000, framesPerSecond: 0, framesEncoded: 0 }]]);
    },
  };
  const overlapping = new ConnectionMonitor({
    pc: slow,
    role: 'sender',
    sessionId: 'sess',
    intervalMs: 1000,
    getContext: () => ({ viewerCount: 1, configuredFps: 30, streamConfig: { resolution: '1080', frameRate: 30, audio: true }, adaptiveState: null }),
  });
  const first = overlapping.tick();
  const second = overlapping.tick();
  equal(calls, 1);
  release();
  await first;
  await second;
  equal(calls, 1);
  equal(overlapping.getHistory().length, 1);
  equal(overlapping.getHistory()[0].outbound?.reportedFps, 0);

  let fastCalls = 0;
  const fast = {
    connectionState: 'connected',
    iceConnectionState: 'connected',
    async getStats() {
      fastCalls += 1;
      return new Map([['out', { id: 'out', type: 'outbound-rtp', kind: 'video', timestamp: fastCalls * 1000, framesEncoded: fastCalls, framesPerSecond: 30 }]]);
    },
  };
  const monitor = new ConnectionMonitor({
    pc: fast,
    role: 'sender',
    sessionId: 'sess',
    connectionId: 'alpha',
    intervalMs: 50,
    getContext: () => ({ viewerCount: 2, configuredFps: 30, streamConfig: null, adaptiveState: '3.0Mbps (100%)' }),
  });
  monitor.start();
  await delay(130);
  ok(monitor.getHistory().length >= 1);
  const subscribed: number[] = [];
  monitor.subscribe(() => subscribed.push(1));
  ok(subscribed.length >= 1);
  for (let i = 0; i < 140; i += 1) await monitor.tick();
  equal(monitor.getHistory().length, 120);
  const beforeStop = fastCalls;
  monitor.stop();
  await monitor.tick();
  equal(fastCalls, beforeStop);
  equal(monitor.getHistory().length, 0);
  equal(overlapping.getHistory().length, 1);

  const other = new ConnectionMonitor({
    pc: {
      connectionState: 'connected',
      iceConnectionState: 'connected',
      async getStats() {
        return new Map([['in', { id: 'in', type: 'inbound-rtp', kind: 'video', timestamp: 5000, framesPerSecond: 12, framesReceived: 12 }]]);
      },
    },
    role: 'receiver',
    sessionId: 'sess',
    connectionId: 'beta',
    getContext: () => ({ viewerCount: null, configuredFps: null, streamConfig: null, adaptiveState: null }),
  });
  await other.tick();
  equal(other.getHistory()[0].role, 'receiver');
  equal(other.getHistory()[0].inbound?.reportedFps, 12);
  equal(other.getHistory()[0].outbound, null);
  equal(monitor.getHistory().length, 0);
  other.stop();
});

test('playback tem fallback, limpa callback na troca e não marca pausa como congelamento', () => {
  const rvfc = fakeVideo();
  const first = new PlaybackMonitor(rvfc, () => {}, 60_000);
  first.start();
  rvfc.emit(0, 0);
  rvfc.emit(16, 0.016);
  const presented = first.collect();
  equal(presented.api, 'rvfc');
  equal(presented.presentedFps, 2);
  equal(presented.freezeSuspected, false);
  first.stop();
  equal(rvfc.cancelled, true);
  rvfc.emit(32, 0.032);
  equal(first.collect().presentedFps, 0);

  const nextVideo = fakeVideo();
  const second = new PlaybackMonitor(nextVideo, () => {}, 60_000);
  second.start();
  nextVideo.emit(0, 0);
  equal(second.collect().presentedFps, 1);
  second.stop();

  const quality = {
    paused: false,
    readyState: 4,
    frames: 10,
    dropped: 1,
    corrupted: 0,
    getVideoPlaybackQuality() {
      return { totalVideoFrames: this.frames, droppedVideoFrames: this.dropped, corruptedVideoFrames: this.corrupted };
    },
  };
  const fallback = new PlaybackMonitor(quality, () => {}, 60_000);
  fallback.start();
  equal(fallback.collect().presentedFps, null);
  quality.frames = 40;
  quality.dropped = 4;
  quality.corrupted = 1;
  const recovered = fallback.collect();
  equal(recovered.api, 'playback-quality');
  equal(recovered.presentedFps, null);
  equal(recovered.qualityTotalDelta, 30);
  equal(recovered.droppedFps, 3);
  equal(recovered.qualityDisplayedEstimate, 27);
  equal(recovered.corruptedFps, 1);
  equal(recovered.stall, 'dropped-frames');
  fallback.stop();

  const bare = { paused: false, readyState: 4 };
  const none = new PlaybackMonitor(bare, () => {}, 60_000);
  none.start();
  const missing = none.collect();
  equal(missing.api, 'none');
  equal(missing.presentedFps, null);
  none.stop();

  const pausedVideo = fakeVideo();
  pausedVideo.paused = true;
  const paused = new PlaybackMonitor(pausedVideo, () => {}, 60_000);
  paused.start();
  const pausedSample = paused.collect();
  equal(pausedSample.presentedFps, 0);
  equal(pausedSample.freezeSuspected, false);
  equal(pausedSample.paused, true);
  equal(pausedSample.stall, 'paused');
  paused.stop();
});

test('reprodução distingue aba visível, oculta, pausa, descartes e APIs ausentes', () => {
  const visible = () => ({ visibilityState: 'visible', hasFocus: true });
  const normal = fakeVideo();
  normal.videoWidth = 1920;
  normal.videoHeight = 1080;
  normal.currentTime = 4.5;
  const playing = new PlaybackMonitor(normal, () => {}, 60_000, visible);
  playing.start();
  normal.emit(10, 0, { presentedFrames: 1, expectedDisplayTime: 10.016, presentationTime: 10, processingDuration: 0.004 });
  normal.emit(26, 0.016, { presentedFrames: 2 });
  const healthy = playing.collect();
  equal(healthy.visibilityState, 'visible');
  equal(healthy.hasFocus, true);
  equal(healthy.videoWidth, 1920);
  equal(healthy.videoHeight, 1080);
  equal(healthy.currentTime, 4.5);
  equal(healthy.readyState, 4);
  equal(healthy.presentedFps, 2);
  equal(healthy.freezeSuspected, false);
  equal(healthy.stall, 'none');
  equal(healthy.lastFrame?.presentedFrames, 2);
  equal(healthy.lastFrame?.processingDuration, null);
  equal(healthy.lastFrame?.callbackTime, 26);
  playing.stop();

  const hiddenVideo = fakeVideo();
  const hidden = new PlaybackMonitor(hiddenVideo, () => {}, 60_000, () => ({ visibilityState: 'hidden', hasFocus: false }));
  hidden.start();
  hiddenVideo.emit(0, 0);
  hidden.collect();
  const occluded = hidden.collect();
  equal(occluded.presentedFps, 0);
  equal(occluded.freezeSuspected, false);
  equal(occluded.stall, 'hidden');
  equal(occluded.hasFocus, false);
  hidden.stop();

  const stalledVideo = fakeVideo();
  const stallMonitor = new PlaybackMonitor(stalledVideo, () => {}, 60_000, visible);
  stallMonitor.start();
  stalledVideo.emit(0, 0);
  stallMonitor.collect();
  const noCallbacks = stallMonitor.collect();
  equal(noCallbacks.presentedFps, 0);
  equal(noCallbacks.stall, 'no-callbacks');
  equal(noCallbacks.freezeSuspected, true);
  stallMonitor.stop();

  const slow = fakeVideo();
  const delay = new PlaybackMonitor(slow, () => {}, 60_000, visible);
  delay.start();
  slow.emit(100, 1, { processingDuration: 0.08, expectedDisplayTime: 100.12, presentationTime: 100 });
  const late = delay.collect();
  equal(late.stall, 'composition-delay');
  equal(late.freezeSuspected, false);
  equal(late.processingDuration, 0.08);
  equal(Math.round((late.compositionLeadSec ?? 0) * 1000), 120);
  delay.stop();

  const jumpy = fakeVideo();
  const gaps = new PlaybackMonitor(jumpy, () => {}, 60_000, visible);
  gaps.start();
  for (let i = 0; i < 7; i += 1) jumpy.emit(i * 16, i * 0.016);
  jumpy.emit(400, 0.5);
  const irregular = gaps.collect();
  equal(irregular.irregularIntervals, 1);
  equal(irregular.freezeSuspected, false);
  equal(irregular.stall, 'irregular-media-time');
  equal(irregular.maxMediaTimeGapSec !== null && irregular.maxMediaTimeGapSec > 0.2, true);
  gaps.stop();

  const bare = { paused: false, readyState: 4 };
  const missingApi = new PlaybackMonitor(bare, () => {}, 60_000, visible);
  missingApi.start();
  const unavailable = missingApi.collect();
  equal(unavailable.api, 'none');
  equal(unavailable.presentedFps, null);
  equal(unavailable.qualityTotalDelta, null);
  equal(unavailable.qualityDisplayedEstimate, null);
  equal(unavailable.stall, 'measurement-unavailable');
  equal(unavailable.freezeSuspected, false);
  missingApi.stop();
});

test('decoder estável com compositor mais baixo é reprodução, e aba oculta não é congelamento', () => {
  const degraded = [
    ...repeat(6, (i) => sample({
      timestamp: i * 1000, role: 'receiver',
      inbound: inbound({ receivedFps: 28, decodedFps: 28, lossPct: 0, jitterMs: 4 }),
      playback: playback({ timestamp: i * 1000, presentedFps: 28, droppedFps: 0, visibilityState: 'visible' }),
    })),
    ...repeat(3, (i) => sample({
      timestamp: (6 + i) * 1000, role: 'receiver',
      inbound: inbound({ receivedFps: 28, decodedFps: 28, lossPct: 0, jitterMs: 4 }),
      playback: playback({ timestamp: (6 + i) * 1000, presentedFps: 17, droppedFps: 9, visibilityState: 'visible', stall: 'dropped-frames' }),
    })),
  ];
  const playbackIssue = classifyDiagnosis(degraded);
  equal(playbackIssue.category, 'REPRODUÇÃO');
  equal(playbackIssue.state === 'CRÍTICO' || playbackIssue.state === 'ATENÇÃO', true);

  const hiddenHistory = repeat(8, (i) => sample({
    timestamp: i * 1000, role: 'receiver',
    inbound: inbound({ receivedFps: 28, decodedFps: 28, lossPct: 0, jitterMs: 4 }),
    playback: playback({ timestamp: i * 1000, presentedFps: 0, droppedFps: 0, visibilityState: 'hidden', stall: 'hidden', freezeSuspected: false }),
  }));
  const hiddenDiagnosis = classifyDiagnosis(hiddenHistory);
  equal(hiddenDiagnosis.state, 'INDETERMINADO');
  ok(hiddenDiagnosis.reason.includes('oculta'));

  const prev = sample({
    timestamp: 1000, role: 'receiver',
    inbound: inbound({ receivedFps: 28, decodedFps: 28, lossPct: 0, jitterMs: 4 }),
    playback: playback({ presentedFps: 28, irregularIntervals: 0, visibilityState: 'visible' }),
  });
  const oneGap = sample({
    timestamp: 2000, role: 'receiver',
    inbound: inbound({ receivedFps: 28, decodedFps: 28, lossPct: 0, jitterMs: 4 }),
    playback: playback({ presentedFps: 27, irregularIntervals: 1, stall: 'irregular-media-time', visibilityState: 'visible' }),
  });
  const gapEvents = detectEvents(prev, oneGap);
  equal(gapEvents.some((event) => event.message === 'Congelamento detectado.'), false);
});

test('eventos de queda e exportação sem IP', () => {
  const prev = sample({
    timestamp: 1000, role: 'receiver',
    inbound: inbound({ decodedFps: 30, receivedFps: 30, lossPct: 0.1, jitterMs: 5 }),
  });
  const curr = sample({
    timestamp: 2000, role: 'receiver',
    inbound: inbound({ decodedFps: 8, receivedFps: 8, lossPct: 6, jitterMs: 40 }),
    network: { rttMs: 180, route: 'relay', localCandidateType: 'relay', remoteCandidateType: 'host', protocol: 'udp', availableOutgoingBitrate: null, availableIncomingBitrate: null, selectedPairId: 'other', selection: 'transport' },
  });
  const events = detectEvents(prev, curr);
  ok(events.some((event) => event.message === 'Queda significativa de FPS.'));
  ok(events.some((event) => event.message === 'Aumento relevante de perda de pacotes.'));
  ok(events.some((event) => event.message === 'Alteração de rota ICE.'));

  const report = buildReport({
    sessionId: 'sess',
    collectedFrom: 1000,
    streamConfig: { resolution: '1080', frameRate: 30, audio: true },
    history: [curr],
    playback: [],
    events: events.map((event) => ({ ...event, connectionId: 'c1' })),
    diagnoses: [classifyDiagnosis(repeat(2, () => curr))],
    browser: parseBrowser('Mozilla/5.0 Chrome/131.0.0.0'),
  });
  equal(report.role, 'receiver');
  equal(report.browser.name, 'Chrome');
  equal(report.browser.version, '131.0.0.0');
  equal(report.ice?.route, 'relay');
  const dumped = JSON.stringify(report);
  ok(!dumped.includes('address'));
  ok(!dumped.includes('1.2.3.4'));
  const dirty = sanitize({ candidateType: 'host', address: '9.9.9.9', ip: '8.8.8.8', nested: { credential: 'x', protocol: 'udp' } });
  equal((dirty as { candidateType: string }).candidateType, 'host');
  ok(!('address' in (dirty as object)));
  ok(!('credential' in ((dirty as { nested: object }).nested)));
});

function fakeVideo(): PlaybackVideo & {
  emit: (now: number, mediaTime: number, extra?: Partial<VideoFrameMetadataLike>) => void;
  cancelled: boolean;
} {
  let callback: ((now: number, metadata: VideoFrameMetadataLike) => void) | null = null;
  const video = {
    paused: false,
    readyState: 4,
    cancelled: false,
    requestVideoFrameCallback(cb: (now: number, metadata: VideoFrameMetadataLike) => void) {
      callback = cb;
      return 7;
    },
    cancelVideoFrameCallback() {
      video.cancelled = true;
      callback = null;
    },
    emit(now: number, mediaTime: number, extra: Partial<VideoFrameMetadataLike> = {}) {
      callback?.(now, { mediaTime, ...extra });
    },
  };
  return video;
}
