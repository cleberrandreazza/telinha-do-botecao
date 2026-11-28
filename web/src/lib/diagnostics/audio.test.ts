import { test } from 'node:test';
import { equal, ok } from 'node:assert/strict';
import {
  attachAudio,
  audioModeFromConfig,
  buildDisplayMediaOptions,
  captureUnavailableMessage,
  classifyAudio,
  commitPreparedShare,
  decideAudioScope,
  inspectAudioSdp,
  migrateAudioMode,
  negotiationFromSdp,
  parseOpusFmtp,
  policyLabel,
  readAudioCapture,
  requestDisplayMedia,
  resolvePlayback,
  shouldRebindSrcObject,
} from './audio.ts';
import { buildSample, emptyCounters } from './parse.ts';
import { rmsFromEnergy } from './math.ts';
import { buildReport } from './export.ts';
import { configureAudioSenderParameters, configureOpusReceiverSdp, configureOpusSenderSdp, OPUS_MAX_AVERAGE_BITRATE } from '../opus.ts';
import type { AudioFacts, AudioPlaybackReport, StatsReportLike } from './types.ts';

function facts(partial: Partial<AudioFacts> & Pick<AudioFacts, 'role'>): AudioFacts {
  return {
    requested: null,
    audioMode: null,
    displaySurface: null,
    policy: null,
    returnedTracks: null,
    authorizedTracks: null,
    discardReason: null,
    capturedTracks: null,
    trackReadyState: null,
    trackEnabled: null,
    trackMuted: null,
    senderAttached: null,
    negotiated: null,
    direction: null,
    remoteAudioTracks: null,
    packetsPerSec: null,
    bitrate: null,
    samplesPerSec: null,
    codec: null,
    playbackMuted: null,
    playbackVolume: null,
    playbackPaused: null,
    playbackBlocked: null,
    playError: null,
    elementAudioTracks: null,
    captureFormat: null,
    localNegotiation: null,
    remoteNegotiation: null,
    codecInfo: null,
    signal: null,
    inbound: null,
    ...partial,
  };
}

function playback(partial: Partial<AudioPlaybackReport> = {}): AudioPlaybackReport {
  return {
    muted: false,
    volume: 0.7,
    paused: false,
    blocked: false,
    playError: null,
    elementAudioTracks: 1,
    readyState: 4,
    ...partial,
  };
}

const offer = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'a=sendrecv',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=rtpmap:96 H264/90000',
].join('\r\n');

function fakeShare(surface: string | undefined, audioCount: number) {
  const audio = Array.from({ length: audioCount }, () => ({ stopped: false, stop() { this.stopped = true; } }));
  let current = [...audio];
  const video = { stopped: false, stop() { this.stopped = true; }, getSettings: () => ({ displaySurface: surface }) };
  return {
    getAudioTracks: () => current,
    getVideoTracks: () => [video],
    removeTrack(track: { stop: () => void }) {
      current = current.filter((item) => item !== track);
    },
    audio,
    video,
  };
}

test('modo source exclui áudio global e pede só o áudio da aba ou da janela', () => {
  const source = buildDisplayMediaOptions({ frameRate: { ideal: 30 } }, 'source');
  equal(source.audio, true);
  equal(source.systemAudio, 'exclude');
  equal(source.windowAudio, 'window');
  equal(source.suppressLocalAudioPlayback, undefined);
  ok(!('suppressLocalAudioPlayback' in source));
  ok(!('echoCancellation' in source));
  ok(!('noiseSuppression' in source));
  ok(!('autoGainControl' in source));

  const system = buildDisplayMediaOptions({}, 'system');
  equal(system.audio, true);
  equal(system.systemAudio, 'include');
  equal(system.windowAudio, 'system');
  equal(system.suppressLocalAudioPlayback, undefined);
  ok(!('suppressLocalAudioPlayback' in system));

  equal(buildDisplayMediaOptions({}, 'source', { windowAudio: 'exclude' }).windowAudio, 'exclude');
  equal(buildDisplayMediaOptions({}, 'system', { windowAudio: 'exclude' }).windowAudio, 'exclude');

  const off = buildDisplayMediaOptions({}, 'off');
  equal(off.audio, false);
  equal(off.systemAudio, undefined);
  equal(off.windowAudio, undefined);
  equal(off.suppressLocalAudioPlayback, undefined);
});

test('política de superfície descarta áudio fora do escopo e preserva o vídeo', () => {
  const order: string[] = [];
  const windowShare = fakeShare('window', 1);
  const windowResult = commitPreparedShare({
    stream: windowShare,
    mode: 'source',
    assignLocal: (stream) => order.push(`localStream:${stream.getAudioTracks().length}`),
    startSharing: () => order.push('start-sharing'),
  });
  equal(order.join(','), 'localStream:1,start-sharing');
  equal(windowResult.returned, 1);
  equal(windowResult.kept, 1);
  equal(windowResult.decision.policy, 'window-audio');
  equal(windowShare.audio[0].stopped, false);
  equal(windowShare.video.stopped, false);

  // O navegador recusou `windowAudio: 'window'`: a janela não tem áudio isolado garantido.
  const unisolated = fakeShare('window', 1);
  const unisolatedResult = commitPreparedShare({
    stream: unisolated,
    mode: 'source',
    windowAudioFallback: true,
    assignLocal: () => {},
    startSharing: () => {},
  });
  equal(unisolatedResult.kept, 0);
  equal(unisolatedResult.decision.policy, 'window-unsupported');
  equal(unisolated.audio[0].stopped, true);
  equal(unisolated.video.stopped, false);
  equal(unisolated.getVideoTracks().length, 1);

  const windowEmpty = fakeShare('window', 0);
  const windowEmptyResult = commitPreparedShare({
    stream: windowEmpty,
    mode: 'source',
    assignLocal: () => {},
    startSharing: () => {},
  });
  equal(windowEmptyResult.kept, 0);
  ok(windowEmptyResult.message?.includes('desta janela'));

  const tab = fakeShare('browser', 1);
  const tabResult = commitPreparedShare({
    stream: tab,
    mode: 'source',
    assignLocal: () => {},
    startSharing: () => {},
  });
  equal(tabResult.kept, 1);
  equal(tabResult.decision.policy, 'tab-audio');
  equal(tab.audio[0].stopped, false);

  const monitorSource = fakeShare('monitor', 1);
  const monitorSourceResult = commitPreparedShare({
    stream: monitorSource,
    mode: 'source',
    assignLocal: () => {},
    startSharing: () => {},
  });
  equal(monitorSourceResult.kept, 0);
  equal(monitorSourceResult.decision.policy, 'source-blocks-monitor');
  equal(monitorSource.audio[0].stopped, true);
  equal(monitorSource.video.stopped, false);

  const monitorSystem = fakeShare('monitor', 1);
  equal(commitPreparedShare({
    stream: monitorSystem,
    mode: 'system',
    assignLocal: () => {},
    startSharing: () => {},
  }).decision.policy, 'system-monitor');
  equal(monitorSystem.getAudioTracks().length, 1);

  const windowSystem = fakeShare('window', 1);
  const windowSystemResult = commitPreparedShare({
    stream: windowSystem,
    mode: 'system',
    assignLocal: () => {},
    startSharing: () => {},
  });
  equal(windowSystemResult.kept, 1);
  equal(windowSystemResult.decision.policy, 'system-window');
  ok(windowSystemResult.message?.includes('Windows'));
  equal(windowSystem.audio[0].stopped, false);

  const windowSystemFallback = fakeShare('window', 1);
  equal(commitPreparedShare({
    stream: windowSystemFallback,
    mode: 'system',
    windowAudioFallback: true,
    assignLocal: () => {},
    startSharing: () => {},
  }).decision.policy, 'window-unsupported');
  equal(windowSystemFallback.audio[0].stopped, true);
  equal(windowSystemFallback.video.stopped, false);

  const tabSystem = fakeShare('browser', 1);
  const tabSystemResult = commitPreparedShare({
    stream: tabSystem,
    mode: 'system',
    assignLocal: () => {},
    startSharing: () => {},
  });
  equal(tabSystemResult.kept, 0);
  equal(tabSystemResult.decision.policy, 'system-requires-monitor');
  equal(tabSystem.audio[0].stopped, true);
  equal(tabSystem.video.stopped, false);

  for (const mode of ['source', 'system'] as const) {
    const unknown = fakeShare(undefined, 1);
    const result = commitPreparedShare({
      stream: unknown,
      mode,
      assignLocal: () => {},
      startSharing: () => {},
    });
    equal(result.decision.policy, 'unknown-surface');
    equal(result.kept, 0);
    equal(unknown.audio[0].stopped, true);
  }

  const videoOnly = fakeShare('browser', 0);
  const empty = commitPreparedShare({
    stream: videoOnly,
    mode: 'source',
    assignLocal: (stream) => {
      equal(stream.getVideoTracks().length, 1);
    },
    startSharing: () => {},
  });
  equal(empty.kept, 0);
  equal(empty.returned, 0);
  equal(videoOnly.video.stopped, false);
  ok(empty.message?.includes('AUDIO_CAPTURE_UNAVAILABLE'));
});

test('fallback de compatibilidade não alarga o escopo do áudio', async () => {
  const seen: Record<string, unknown>[] = [];
  const captured = await requestDisplayMedia(async (options) => {
    seen.push(options);
    if (options.audio === true) {
      const error = new Error('unsupported');
      error.name = 'NotSupportedError';
      throw error;
    }
    return fakeShare('browser', 0);
  }, { ideal: true }, 'source');
  equal(seen.length, 3);
  equal(seen[0].systemAudio, 'exclude');
  equal(seen[0].windowAudio, 'window');
  equal(seen[1].systemAudio, 'exclude');
  equal(seen[1].windowAudio, 'exclude');
  equal(seen[2].audio, false);
  equal(seen[2].systemAudio, undefined);
  equal(seen[2].windowAudio, undefined);
  equal(captured.audioScopeFallback, true);
  equal(captured.windowAudioFallback, false);
  ok(seen.every((options) => options.windowAudio !== 'system'));
  ok(seen.every((options) => options.audio !== true || 'windowAudio' in options));

  const order: string[] = [];
  commitPreparedShare({
    stream: captured.stream,
    mode: 'source',
    scopeUnsupported: captured.audioScopeFallback,
    assignLocal: (stream) => order.push(`localStream:${stream.getAudioTracks().length}`),
    startSharing: () => order.push('start-sharing'),
  });
  equal(order.join(','), 'localStream:0,start-sharing');

  let calls = 0;
  let cancelled = false;
  try {
    await requestDisplayMedia(async () => {
      calls += 1;
      const error = new Error('cancel');
      error.name = 'NotAllowedError';
      throw error;
    }, {}, 'system');
  } catch (err) {
    cancelled = err instanceof Error && err.name === 'NotAllowedError';
  }
  equal(cancelled, true);
  equal(calls, 1);
});

test('navegador sem windowAudio "window" recua para "exclude" e mantém o vídeo', async () => {
  for (const name of ['TypeError', 'NotSupportedError', 'OverconstrainedError']) {
    const seen: Record<string, unknown>[] = [];
    const captured = await requestDisplayMedia(async (options) => {
      seen.push(options);
      if (options.windowAudio === 'window') {
        const error = new Error('unsupported');
        error.name = name;
        throw error;
      }
      return fakeShare('window', 0);
    }, {}, 'source');
    equal(seen.length, 2);
    equal(seen[1].windowAudio, 'exclude');
    equal(seen[1].systemAudio, 'exclude');
    equal(seen[1].audio, true);
    equal(captured.windowAudioFallback, true);
    equal(captured.audioScopeFallback, false);
    equal(captured.stream.getVideoTracks().length, 1);
  }

  const systemSeen: Record<string, unknown>[] = [];
  const system = await requestDisplayMedia(async (options) => {
    systemSeen.push(options);
    if (options.windowAudio === 'system') {
      const error = new Error('unsupported');
      error.name = 'TypeError';
      throw error;
    }
    return fakeShare('window', 0);
  }, {}, 'system');
  equal(systemSeen[1].windowAudio, 'exclude');
  equal(systemSeen[1].systemAudio, 'include');
  equal(system.windowAudioFallback, true);
});

test('troca de fonte: recuo para "exclude" acontece, só o degrau de vídeo volta como erro', async () => {
  const seen: Record<string, unknown>[] = [];
  const captured = await requestDisplayMedia(async (options) => {
    seen.push(options);
    if (options.windowAudio === 'window') {
      const error = new Error('unsupported');
      error.name = 'TypeError';
      throw error;
    }
    return fakeShare('window', 0);
  }, {}, 'source', { fallbackToVideoOnly: false });
  equal(seen.length, 2);
  equal(captured.windowAudioFallback, true);

  let calls = 0;
  let name = '';
  try {
    await requestDisplayMedia(async () => {
      calls += 1;
      const error = new Error('unsupported');
      error.name = 'NotSupportedError';
      throw error;
    }, {}, 'source', { fallbackToVideoOnly: false });
  } catch (err) {
    name = err instanceof Error ? err.name : '';
  }
  equal(name, 'NotSupportedError');
  equal(calls, 2);
});

test('política de janela: source e system mantêm a track; fallback e tela inteira em source descartam', () => {
  equal(decideAudioScope('source', 'window').keepAudio, true);
  equal(decideAudioScope('source', 'window').policy, 'window-audio');
  equal(decideAudioScope('system', 'window').keepAudio, true);
  equal(decideAudioScope('system', 'window').policy, 'system-window');
  equal(decideAudioScope('source', 'window', { windowAudioFallback: true }).keepAudio, false);
  equal(decideAudioScope('system', 'window', { windowAudioFallback: true }).keepAudio, false);
  equal(decideAudioScope('source', 'monitor').keepAudio, false);
  equal(decideAudioScope('source', 'browser', { windowAudioFallback: true }).keepAudio, true);
  equal(policyLabel('window-audio'), 'Áudio da janela disponível.');
  equal(policyLabel('system-window'), 'Áudio do Windows transmitido junto com a janela.');
  equal(policyLabel('window-unsupported'), 'O navegador não isola o áudio desta janela.');
});

test('preferência antiga de áudio não migra para o modo global', () => {
  equal(migrateAudioMode({ shareAudio: false }), 'off');
  equal(migrateAudioMode({ shareAudio: true }), 'source');
  equal(migrateAudioMode(null), 'source');
  equal(migrateAudioMode({ audioMode: 'system', shareAudio: true }), 'system');
  equal(migrateAudioMode({ audioMode: 'off', shareAudio: true }), 'off');
  equal(audioModeFromConfig({ audio: true }), 'source');
  equal(audioModeFromConfig({ audio: false }), 'off');
  equal(audioModeFromConfig({ audio: true, audioMode: 'system' }), 'system');
});

test('preferência salva do antigo modo device volta para o padrão', () => {
  equal(migrateAudioMode({ audioMode: 'device', shareAudio: true }), 'source');
  equal(migrateAudioMode({ audioMode: 'device', shareAudio: false }), 'off');
});

test('compartilhamento sem áudio e captura só de vídeo', () => {
  equal(classifyAudio(facts({ role: 'sender', requested: false })).code, 'DISABLED');
  const missing = classifyAudio(facts({
    role: 'sender',
    requested: true,
    capturedTracks: 0,
    displaySurface: 'browser',
  }));
  equal(missing.code, 'NOT_CAPTURED');
  ok(missing.reason.includes('AUDIO_CAPTURE_UNAVAILABLE'));
  equal(classifyAudio(facts({
    role: 'sender',
    requested: true,
    capturedTracks: 0,
    displaySurface: 'window',
    policy: 'window-unsupported',
    returnedTracks: 1,
    authorizedTracks: 0,
    discardReason: 'O navegador não isola o áudio desta janela. O vídeo segue sem áudio.',
  })).reason, 'O navegador não isola o áudio desta janela. O vídeo segue sem áudio.');
  ok(captureUnavailableMessage('window').includes('janela'));
  ok(captureUnavailableMessage('monitor').includes('tela inteira'));
});

test('track encerrada, mutada ou desabilitada não é tratada como envio', () => {
  const base = {
    role: 'sender' as const,
    requested: true,
    capturedTracks: 1,
    senderAttached: true,
    negotiated: true,
    direction: 'sendrecv',
    packetsPerSec: 0,
    bitrate: 0,
  };
  equal(classifyAudio(facts({ ...base, trackReadyState: 'ended', trackEnabled: true })).reason, 'A track de áudio encerrou.');
  equal(classifyAudio(facts({ ...base, trackReadyState: 'live', trackEnabled: false })).reason, 'A track de áudio está desabilitada.');
  equal(classifyAudio(facts({
    ...base,
    trackReadyState: 'live',
    trackEnabled: true,
    trackMuted: true,
  })).reason, 'A track está muted na origem, então não há amostras saindo.');
});

test('sender sem track e SDP sem áudio', () => {
  equal(classifyAudio(facts({
    role: 'sender',
    requested: true,
    capturedTracks: 1,
    trackReadyState: 'live',
    trackEnabled: true,
    senderAttached: false,
  })).code, 'CAPTURED_NOT_SENT');
  const sdp = inspectAudioSdp('v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n');
  equal(sdp.present, false);
  equal(classifyAudio(facts({
    role: 'sender',
    requested: true,
    capturedTracks: 1,
    trackReadyState: 'live',
    trackEnabled: true,
    senderAttached: true,
    negotiated: false,
  })).code, 'NOT_NEGOTIATED');
  const rejected = inspectAudioSdp('v=0\r\nm=audio 0 UDP/TLS/RTP/SAVPF 111\r\n');
  equal(rejected.present, true);
  equal(rejected.rejected, true);
  equal(negotiationFromSdp(offer, 'v=0\r\nm=audio 0 UDP/TLS/RTP/SAVPF 111\r\n').negotiated, false);
  const okSdp = negotiationFromSdp(offer, offer);
  equal(okSdp.negotiated, true);
  equal(okSdp.codecs[0], 'opus');
  equal(okSdp.direction, 'sendrecv');
});

test('áudio enviado não aparece no receptor sem pacotes, e pacotes mudos não contam como reprodução', () => {
  const sent = classifyAudio(facts({
    role: 'sender',
    requested: true,
    capturedTracks: 1,
    trackReadyState: 'live',
    trackEnabled: true,
    trackMuted: false,
    senderAttached: true,
    negotiated: true,
    direction: 'sendrecv',
    packetsPerSec: 50,
    bitrate: 32_000,
    codec: 'opus',
  }));
  equal(sent.code, 'SENDING');
  const missing = classifyAudio(facts({
    role: 'receiver',
    negotiated: true,
    direction: 'sendrecv',
    remoteAudioTracks: 1,
    packetsPerSec: 0,
    bitrate: 0,
    codec: 'opus',
    playbackMuted: false,
    playbackVolume: 0.7,
    playbackPaused: false,
  }));
  equal(missing.code, 'NOT_RECEIVED');
  const silent = classifyAudio(facts({
    role: 'receiver',
    negotiated: true,
    direction: 'sendrecv',
    remoteAudioTracks: 1,
    packetsPerSec: 48,
    bitrate: 30_000,
    playbackMuted: true,
    playbackVolume: 0.7,
    playbackPaused: false,
    playbackBlocked: false,
  }));
  equal(silent.code, 'RECEIVED_MUTED');
  const blocked = classifyAudio(facts({
    role: 'receiver',
    negotiated: true,
    direction: 'sendrecv',
    remoteAudioTracks: 1,
    packetsPerSec: 48,
    bitrate: 30_000,
    playbackMuted: true,
    playbackVolume: 0.7,
    playbackPaused: false,
    playbackBlocked: true,
    playError: 'NotAllowedError: play() failed',
  }));
  equal(blocked.code, 'RECEIVED_MUTED');
  ok(blocked.reason.includes('NotAllowedError'));
  const playing = classifyAudio(facts({
    role: 'receiver',
    negotiated: true,
    direction: 'sendrecv',
    remoteAudioTracks: 1,
    packetsPerSec: 48,
    bitrate: 30_000,
    playbackMuted: false,
    playbackVolume: 0.7,
    playbackPaused: false,
    playbackBlocked: false,
  }));
  equal(playing.code, 'PLAYING');
});

test('autoplay bloqueado cai para mudo e a ativação manual desbloqueia', () => {
  const blocked = resolvePlayback({
    wantSound: true,
    audibleError: 'NotAllowedError: play() failed',
    mutedError: null,
  });
  equal(blocked.blocked, true);
  equal(blocked.muted, true);
  ok(blocked.error?.includes('NotAllowedError'));
  const enabled = resolvePlayback({ wantSound: true, audibleError: null, mutedError: null });
  equal(enabled.blocked, false);
  equal(enabled.muted, false);
  equal(resolvePlayback({ wantSound: false, audibleError: null, mutedError: null }).muted, true);
});

test('relatório RTP sem bytes não marca áudio como presente e as direções não se misturam', () => {
  const reports: StatsReportLike[] = [
    { id: 'aout', type: 'outbound-rtp', kind: 'audio', timestamp: 2_000, bytesSent: 0, packetsSent: 0, totalSamplesSent: 0, codecId: 'opus' },
    { id: 'ain', type: 'inbound-rtp', kind: 'audio', timestamp: 2_000, bytesReceived: 9000, packetsReceived: 40 },
    { id: 'opus', type: 'codec', mimeType: 'audio/opus' },
    { id: 'vout', type: 'outbound-rtp', kind: 'video', timestamp: 2_000, bytesSent: 1000, framesEncoded: 30, framesPerSecond: 30 },
  ];
  const first = buildSample({
    reports,
    previous: null,
    role: 'sender',
    wallTime: 2,
    connectionId: 'c',
    viewerCount: 1,
    configuredFps: 30,
    connectionState: 'connected',
    iceConnectionState: 'connected',
    playback: null,
  });
  equal(first.sample.hasAudio, false);
  equal(first.sample.audioRtp?.bytes, 0);
  equal(first.sample.audioCodec, 'opus');
  const secondReports: StatsReportLike[] = [
    { id: 'aout', type: 'outbound-rtp', kind: 'audio', timestamp: 3_000, bytesSent: 4000, packetsSent: 50, totalSamplesSent: 48000, codecId: 'opus' },
    { id: 'opus', type: 'codec', mimeType: 'audio/opus' },
    { id: 'vout', type: 'outbound-rtp', kind: 'video', timestamp: 3_000, bytesSent: 2000, framesEncoded: 60, framesPerSecond: 30 },
  ];
  const second = buildSample({
    reports: secondReports,
    previous: first.counters,
    role: 'sender',
    wallTime: 3,
    connectionId: 'c',
    viewerCount: 1,
    configuredFps: 30,
    connectionState: 'connected',
    iceConnectionState: 'connected',
    playback: null,
  });
  equal(second.sample.hasAudio, true);
  equal(second.sample.audioRtp?.packetsPerSec, 50);
  equal(second.sample.audioRtp?.samplesPerSec, 48000);
  equal(second.sample.audioCodec, 'opus');
  const receiver = buildSample({
    reports: [
      { id: 'ain', type: 'inbound-rtp', kind: 'audio', timestamp: 3_000, bytesReceived: 100, packetsReceived: 2, codecId: 'opus' },
      { id: 'opus', type: 'codec', mimeType: 'audio/opus' },
    ],
    previous: emptyCounters(),
    role: 'receiver',
    wallTime: 3,
    connectionId: 'r',
    viewerCount: null,
    configuredFps: null,
    connectionState: 'connected',
    iceConnectionState: 'connected',
    playback: null,
  });
  equal(receiver.sample.audioRtp?.bytes, 100);
  equal(receiver.sample.audioRtp?.packets, 2);
});

test('reconexão e dois espectadores não compartilham o diagnóstico', () => {
  const before = classifyAudio(facts({
    role: 'sender',
    requested: true,
    capturedTracks: 1,
    trackReadyState: 'live',
    trackEnabled: true,
    senderAttached: true,
    negotiated: false,
  }));
  const after = classifyAudio(facts({
    role: 'sender',
    requested: true,
    capturedTracks: 1,
    trackReadyState: 'live',
    trackEnabled: true,
    trackMuted: false,
    senderAttached: true,
    negotiated: true,
    direction: 'sendrecv',
    packetsPerSec: 40,
    bitrate: 20_000,
  }));
  equal(before.code, 'NOT_NEGOTIATED');
  equal(after.code, 'SENDING');
  const viewerA = attachAudio({
    role: 'receiver',
    rtp: { codec: 'opus', packets: 10, packetsPerSec: 10, bytes: 1000, bitrate: 8000, samples: null, samplesPerSec: null, codecInfo: null, signal: null, inbound: null },
    capture: null,
    link: { senderAttached: false, negotiated: true, direction: 'sendrecv' },
    remoteAudioTracks: 1,
    playback: playback(),
  });
  const viewerB = attachAudio({
    role: 'receiver',
    rtp: { codec: 'opus', packets: 0, packetsPerSec: 0, bytes: 0, bitrate: 0, samples: null, samplesPerSec: null, codecInfo: null, signal: null, inbound: null },
    capture: null,
    link: { senderAttached: false, negotiated: true, direction: 'sendrecv' },
    remoteAudioTracks: 0,
    playback: playback({ elementAudioTracks: 0 }),
  });
  equal(classifyAudio(viewerA).code, 'PLAYING');
  equal(classifyAudio(viewerB).code, 'NOT_RECEIVED');
});

test('track de áudio que chega depois exige reatribuir o srcObject', () => {
  equal(shouldRebindSrcObject(['video'], ['video']), false);
  equal(shouldRebindSrcObject(['video'], ['video', 'audio']), true);
  equal(shouldRebindSrcObject(['video', 'audio'], ['video']), true);
});

test('SDP Opus declara preferências de recepção a 192 kbps sem confundir o parâmetro sender-only', () => {
  equal(OPUS_MAX_AVERAGE_BITRATE, 192_000);

  const untouched = 'v=0\r\na=rtpmap:96 H264/90000\r\n';
  equal(configureOpusSenderSdp(untouched, 2), untouched);
  equal(configureOpusReceiverSdp(untouched), untouched);

  const withFmtp = [
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=rtpmap:96 H264/90000',
  ].join('\r\n');
  const senderSdp = configureOpusSenderSdp(withFmtp, 2);
  ok(senderSdp.includes('stereo=1'));
  ok(senderSdp.includes('sprop-stereo=1'));
  ok(senderSdp.includes('maxaveragebitrate=192000'));
  ok(senderSdp.includes('usedtx=0'));
  ok(senderSdp.includes('useinbandfec=1'));
  ok(senderSdp.includes('a=rtpmap:96 H264/90000'));
  equal(configureOpusSenderSdp(senderSdp, 2), senderSdp);

  const receiverSdp = configureOpusReceiverSdp(withFmtp);
  ok(receiverSdp.includes('stereo=1'));
  ok(receiverSdp.includes('maxaveragebitrate=192000'));
  ok(receiverSdp.includes('usedtx=0'));
  equal(receiverSdp.includes('sprop-stereo='), false);
  ok(receiverSdp.includes('useinbandfec=1'));
  equal(configureOpusReceiverSdp(receiverSdp), receiverSdp);

  const monoReceiverSdp = configureOpusReceiverSdp(withFmtp, false);
  ok(monoReceiverSdp.includes('stereo=0'));
  equal(monoReceiverSdp.includes('stereo=1'), false);
  ok(monoReceiverSdp.includes('maxaveragebitrate=192000'));
  equal(monoReceiverSdp.includes('sprop-stereo='), false);

  const replaced = configureOpusReceiverSdp(
    'a=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;maxaveragebitrate=32000;usedtx=1\r\n',
  );
  equal(/(?:^|[;\s])maxaveragebitrate=32000(?:[;\r\n]|$)/.test(replaced), false);
  equal(replaced.includes('maxaveragebitrate=192000'), true);
  equal(replaced.split('maxaveragebitrate').length, 2);
  ok(replaced.includes('usedtx=0'));
  equal(/(?:^|[;\s])usedtx=1(?:[;\r\n]|$)/.test(replaced), false);

  const mono = configureOpusSenderSdp(
    'a=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=0;sprop-stereo=1;maxaveragebitrate=64000\r\n',
    1,
  );
  ok(mono.includes('stereo=1'));
  ok(mono.includes('sprop-stereo=0'));
  ok(mono.includes('maxaveragebitrate=192000'));
  equal(mono.split('sprop-stereo').length, 2);

  const unknownChannelCount = configureOpusSenderSdp(
    'a=rtpmap:111 opus/48000/2\r\na=fmtp:111 maxaveragebitrate=64000;sprop-stereo=1\r\n',
    null,
  );
  equal(unknownChannelCount.includes('sprop-stereo='), false);

  const created = configureOpusSenderSdp(
    'a=rtpmap:111 opus/48000/2\na=rtpmap:96 H264/90000\n',
    2,
  );
  ok(created.includes('a=rtpmap:111 opus/48000/2\na=fmtp:111 minptime=10;useinbandfec=1;stereo=1;maxaveragebitrate=192000;usedtx=0;sprop-stereo=1\n'));
  ok(created.includes('a=rtpmap:96 H264/90000'));
});

test('sender RTP aplica maxBitrate e confirma o valor relendo getParameters', async () => {
  let current = { encodings: [{}] } as unknown as RTCRtpSendParameters;
  const sender = {
    getParameters: () => current,
    setParameters: async (next: RTCRtpSendParameters) => { current = next; },
  } as unknown as RTCRtpSender;
  equal(await configureAudioSenderParameters(sender), 192_000);
  equal(current.encodings?.[0]?.maxBitrate, 192_000);
});

function captureInput(reports: StatsReportLike[], role: 'sender' | 'receiver', previous: ReturnType<typeof emptyCounters> | null, wallTime: number) {
  return {
    reports,
    previous,
    role,
    wallTime,
    connectionId: role === 'sender' ? 'tx' : 'rx',
    viewerCount: role === 'sender' ? 1 : null,
    configuredFps: 30,
    connectionState: 'connected',
    iceConnectionState: 'connected',
    playback: null,
  };
}

test('constraints de processamento apos captura', async () => {
  const applied: MediaTrackConstraints[] = [];
  const stream = {
    getAudioTracks: () => [{ applyConstraints: async (value: MediaTrackConstraints) => { applied.push(value); } }],
  };
  await requestDisplayMedia(async () => stream, {}, 'source');
  equal(applied[0]?.echoCancellation, false);
  equal(applied[0]?.noiseSuppression, false);
  equal(applied[0]?.autoGainControl, false);
});

test('captura lê settings, constraints e capabilities sem inventar campo nem identificador', () => {
  const seen = readAudioCapture({
    getSettings: () => ({
      sampleRate: 48000,
      channelCount: 2,
      latency: 0.02,
      echoCancellation: false,
      deviceId: 'mic-1',
      label: 'Alto-falantes',
    }),
    getConstraints: () => ({
      sampleRate: { ideal: 48000 },
      channelCount: { exact: 2 },
      autoGainControl: { exact: false },
      latency: { min: 0, max: 1 },
    }),
    getCapabilities: () => ({
      sampleRate: { min: 48000, max: 48000 },
      channelCount: { min: 1, max: 2 },
      noiseSuppression: true,
      suppressLocalAudioPlayback: false,
    }),
  }, { displaySurface: 'browser', suppressLocalAudioPlayback: false, deviceId: 'screen' });
  equal(seen?.settings.sampleRate, 48000);
  equal(seen?.settings.channelCount, 2);
  equal(seen?.settings.sampleSize, null);
  equal(seen?.settings.echoCancellation, false);
  equal(seen?.settings.noiseSuppression, null);
  equal(seen?.constraints?.sampleRate, 48000);
  equal(seen?.constraints?.channelCount, 2);
  equal(seen?.constraints?.autoGainControl, false);
  equal(seen?.constraints?.latency, null);
  equal(seen?.capabilities?.sampleRate, 48000);
  equal(seen?.capabilities?.channelCount, null);
  equal(seen?.capabilities?.noiseSuppression, true);
  equal(seen?.capabilities?.suppressLocalAudioPlayback, false);
  equal(seen?.surfaceSuppressLocalAudioPlayback, false);
  const dumped = JSON.stringify(seen);
  ok(!dumped.includes('mic-1'));
  ok(!dumped.includes('Alto-falantes'));
  ok(!dumped.includes('deviceId'));
});

test('captura com configurações ausentes e capabilities inexistentes fica null, não zero', () => {
  const missing = readAudioCapture({
    getSettings: () => ({}),
    getConstraints: () => ({}),
  });
  equal(missing?.settings.sampleRate, null);
  equal(missing?.settings.channelCount, null);
  equal(missing?.settings.echoCancellation, null);
  equal(missing?.constraints?.sampleRate, null);
  equal(missing?.capabilities, null);
  equal(missing?.surfaceSuppressLocalAudioPlayback, null);

  const thrown = readAudioCapture({
    getSettings: () => { throw new Error('sem settings'); },
    getCapabilities: () => { throw new Error('sem capabilities'); },
  });
  equal(thrown?.settings.sampleRate, null);
  equal(thrown?.capabilities?.sampleRate, null);
  equal(readAudioCapture(null), null);
});

test('negociação Opus guarda oferta e resposta separadas e não exporta o SDP', () => {
  const local = [
    'v=0',
    'o=- 1 1 IN IP4 203.0.113.8',
    'a=candidate:1 1 udp 2122260223 203.0.113.8 9 typ host',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;stereo=1;sprop-stereo=1;maxaveragebitrate=128000;useinbandfec=1;segredo=nao-exportar',
    'a=sendrecv',
    'a=ptime:20',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'a=rtpmap:96 H264/90000',
  ].join('\r\n');
  const remote = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 110',
    'a=rtpmap:111 opus/48000',
    'a=fmtp:111 stereo=0;sprop-stereo=0;maxaveragebitrate=32000;usedtx=1',
    'a=rtpmap:110 telephone-event/8000',
    'a=recvonly',
    'a=maxptime:60',
  ].join('\n');
  const parsed = negotiationFromSdp(local, remote);
  equal(parsed.local.codec, 'opus');
  equal(parsed.local.payloadType, '111');
  equal(parsed.local.clockRate, 48000);
  equal(parsed.local.channels, 2);
  equal(parsed.local.direction, 'sendrecv');
  equal(parsed.local.fmtp.stereo, '1');
  equal(parsed.local.fmtp.maxaveragebitrate, '128000');
  equal(parsed.local.fmtp.ptime, '20');
  equal(parsed.remote.channels, null);
  equal(parsed.remote.direction, 'recvonly');
  equal(parsed.remote.fmtp.stereo, '0');
  equal(parsed.remote.fmtp.maxaveragebitrate, '32000');
  equal(parsed.remote.fmtp.usedtx, '1');
  equal(parsed.remote.fmtp.maxptime, '60');
  equal(parsed.direction, 'recvonly');
  const extracted = parseOpusFmtp('a=fmtp:111 stereo=1;minptime=10;nao-conhecido=abc;maxplaybackrate=48000');
  equal(extracted.stereo, '1');
  equal(extracted.maxplaybackrate, '48000');
  equal(extracted.spropStereo, null);
  const dumped = JSON.stringify(parsed);
  ok(!dumped.includes('v=0'));
  ok(!dumped.includes('203.0.113.8'));
  ok(!dumped.includes('candidate'));
  ok(!dumped.includes('minptime'));
  ok(!dumped.includes('nao-exportar'));
  ok(!dumped.includes('segredo'));
  ok(!('sdp' in parsed.local));
  ok(!('sdp' in parsed));

  const factsFrom = attachAudio({
    role: 'sender',
    rtp: null,
    capture: null,
    link: { senderAttached: true, negotiated: true, direction: parsed.direction, local: parsed.local, remote: parsed.remote },
    remoteAudioTracks: null,
    playback: null,
  });
  equal(factsFrom.localNegotiation?.fmtp.maxaveragebitrate, '128000');
  equal(factsFrom.remoteNegotiation?.fmtp.maxaveragebitrate, '32000');
  const report = buildReport({
    sessionId: 'sess',
    collectedFrom: 1,
    streamConfig: null,
    history: [{
      timestamp: 1,
      connectionId: 'c',
      role: 'sender',
      viewerCount: 1,
      configuredFps: 30,
      connectionState: 'connected',
      iceConnectionState: 'connected',
      dtMs: 1000,
      countersReset: false,
      videoCodec: null,
      audioCodec: 'opus',
      hasAudio: true,
      audioBitrate: 128000,
      audioRtp: null,
      audio: factsFrom,
      outbound: null,
      inbound: null,
      remoteInbound: null,
      network: {
        rttMs: null, route: 'unknown', localCandidateType: null, remoteCandidateType: null,
        protocol: null, availableOutgoingBitrate: null, availableIncomingBitrate: null,
        selectedPairId: null, selection: 'none',
      },
      playback: null,
    }],
    playback: [],
    events: [],
    diagnoses: [],
  });
  const json = JSON.stringify(report);
  ok(!json.includes('v=0'));
  ok(!json.includes('203.0.113.8'));
  ok(!json.includes('a=fmtp'));
  ok(json.includes('128000'));
  ok(json.includes('32000'));
});

test('getStats de áudio separa origem, codec, concealment e energia, e não mistura com o vídeo', () => {
  const senderReports: StatsReportLike[] = [
    {
      id: 'aout', type: 'outbound-rtp', kind: 'audio', mediaSourceId: 'asrc', timestamp: 1_000,
      bytesSent: 16000, packetsSent: 50, totalSamplesSent: 48000, codecId: 'a-codec',
    },
    {
      id: 'asrc', type: 'media-source', kind: 'audio', audioLevel: 0.2,
      totalAudioEnergy: 0.04, totalSamplesDuration: 1,
    },
    { id: 'vsrc', type: 'media-source', kind: 'video', audioLevel: 0.9, width: 1920, height: 1080 },
    {
      id: 'vout', type: 'outbound-rtp', kind: 'video', timestamp: 1_000, bytesSent: 1000,
      framesEncoded: 30, packetsLost: 7, concealedSamples: 99,
    },
    {
      id: 'a-codec', type: 'codec', mimeType: 'audio/opus', clockRate: 48000, channels: 2,
      sdpFmtpLine: 'stereo=1;sprop-stereo=1;maxaveragebitrate=128000;minptime=10',
    },
  ];
  const first = buildSample(captureInput(senderReports, 'sender', null, 1_000));
  equal(first.sample.audioRtp?.signal?.audioLevel, 0.2);
  equal(first.sample.audioRtp?.signal?.rms, null);
  equal(first.sample.audioRtp?.codecInfo?.channels, 2);
  equal(first.sample.audioRtp?.codecInfo?.clockRate, 48000);
  equal(first.sample.audioRtp?.codecInfo?.fmtp.stereo, '1');
  equal(first.sample.audioRtp?.codecInfo?.fmtp.maxaveragebitrate, '128000');
  equal(first.sample.audioRtp?.inbound, null);
  ok(!JSON.stringify(first.sample.audioRtp).includes('minptime'));

  const secondReports: StatsReportLike[] = senderReports.map((report) => (
    report.id === 'asrc'
      ? { ...report, totalAudioEnergy: 0.05, totalSamplesDuration: 2, audioLevel: 0.25 }
      : report.id === 'aout'
        ? { ...report, timestamp: 2_000, bytesSent: 32000, packetsSent: 100, totalSamplesSent: 96000 }
        : report
  ));
  const second = buildSample(captureInput(secondReports, 'sender', first.counters, 2_000));
  equal(second.sample.audioRtp?.signal?.rms, 0.1);
  equal(second.sample.audioRtp?.signal?.dbFs, 20 * Math.log10(0.1));
  equal(second.sample.audioRtp?.bitrate, 128000);

  const other = buildSample(captureInput([
    { id: 'bout', type: 'outbound-rtp', kind: 'audio', mediaSourceId: 'bsrc', timestamp: 2_000, bytesSent: 10, packetsSent: 1, codecId: 'bare' },
    { id: 'bsrc', type: 'media-source', kind: 'audio', audioLevel: 0.8, totalAudioEnergy: 1, totalSamplesDuration: 1 },
    { id: 'bare', type: 'codec', mimeType: 'audio/opus', clockRate: 48000 },
  ], 'sender', null, 2_000));
  equal(other.sample.audioRtp?.signal?.audioLevel, 0.8);
  equal(other.sample.audioRtp?.codecInfo?.channels, null);
  equal(second.sample.audioRtp?.signal?.audioLevel, 0.25);

  const receiverFirst = buildSample(captureInput([
    {
      id: 'ain', type: 'inbound-rtp', kind: 'audio', timestamp: 1_000, codecId: 'a-codec',
      bytesReceived: 16000, packetsReceived: 50, packetsLost: 1, jitter: 0.004,
      concealedSamples: 10, concealmentEvents: 2, silentConcealedSamples: 4,
      fecPacketsReceived: 3, fecPacketsDiscarded: 1,
      removedSamplesForAcceleration: 5, insertedSamplesForDeceleration: 6,
      totalSamplesReceived: 48000, totalAudioEnergy: 0.01, totalSamplesDuration: 1,
      jitterBufferDelay: 0.2, jitterBufferEmittedCount: 1000, audioLevel: 0.15,
    },
    { id: 'vin', type: 'inbound-rtp', kind: 'video', timestamp: 1_000, packetsLost: 40, concealedSamples: 800, bytesReceived: 5000, framesReceived: 30 },
    { id: 'a-codec', type: 'codec', mimeType: 'audio/opus', clockRate: 48000 },
  ], 'receiver', null, 1_000));
  equal(receiverFirst.sample.inbound?.packetsLost, 40);
  equal(receiverFirst.sample.audioRtp?.inbound?.packetsLost, 1);
  equal(receiverFirst.sample.audioRtp?.inbound?.concealedSamplesDelta, null);
  equal(receiverFirst.sample.audioRtp?.codecInfo?.channels, null);

  const receiverSecond = buildSample(captureInput([
    {
      id: 'ain', type: 'inbound-rtp', kind: 'audio', timestamp: 2_000, codecId: 'a-codec',
      bytesReceived: 32000, packetsReceived: 100, packetsLost: 3, jitter: 0.008,
      concealedSamples: 18, concealmentEvents: 4, silentConcealedSamples: 7,
      fecPacketsReceived: 5, fecPacketsDiscarded: 2,
      removedSamplesForAcceleration: 9, insertedSamplesForDeceleration: 11,
      totalSamplesReceived: 96000, totalAudioEnergy: 0.02, totalSamplesDuration: 2,
      jitterBufferDelay: 0.5, jitterBufferEmittedCount: 2000, audioLevel: 0.16,
    },
    { id: 'vin', type: 'inbound-rtp', kind: 'video', timestamp: 2_000, packetsLost: 41, concealedSamples: 900, bytesReceived: 9000, framesReceived: 60 },
    { id: 'a-codec', type: 'codec', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  ], 'receiver', receiverFirst.counters, 2_000));
  const inbound = receiverSecond.sample.audioRtp?.inbound;
  equal(inbound?.packetsLostDelta, 2);
  equal(inbound?.concealedSamplesDelta, 8);
  equal(inbound?.concealmentEventsDelta, 2);
  equal(inbound?.silentConcealedSamplesDelta, 3);
  equal(inbound?.fecPacketsReceivedDelta, 2);
  equal(inbound?.fecPacketsDiscardedDelta, 1);
  equal(inbound?.removedSamplesDelta, 4);
  equal(inbound?.insertedSamplesDelta, 5);
  equal(inbound?.jitterMs, 8);
  equal(inbound?.jitterBufferAvgDelayMs, 0.3);
  equal(receiverSecond.sample.audioRtp?.signal?.rms, 0.1);
  equal(receiverSecond.sample.inbound?.packetsLost, 41);
  equal(receiverSecond.sample.audioRtp?.codecInfo?.channels, 2);

  const reset = buildSample(captureInput([
    {
      id: 'ain', type: 'inbound-rtp', kind: 'audio', timestamp: 3_000,
      bytesReceived: 100, packetsReceived: 1, packetsLost: 0,
      concealedSamples: 1, concealmentEvents: 0, silentConcealedSamples: 0,
      fecPacketsReceived: 0, fecPacketsDiscarded: 0,
      removedSamplesForAcceleration: 0, insertedSamplesForDeceleration: 0,
      totalAudioEnergy: 0, totalSamplesDuration: 0.1,
      jitterBufferDelay: 0, jitterBufferEmittedCount: 10,
    },
  ], 'receiver', receiverSecond.counters, 3_000));
  equal(reset.sample.countersReset, true);
  equal(reset.sample.audioRtp?.inbound?.concealedSamplesDelta, null);
  equal(reset.sample.audioRtp?.signal?.rms, null);
  equal(reset.sample.audioRtp?.signal?.dbFs, null);

  const absent = buildSample(captureInput([
    { id: 'ain', type: 'inbound-rtp', kind: 'audio', timestamp: 4_000, bytesReceived: 10, packetsReceived: 1 },
  ], 'receiver', null, 4_000));
  equal(absent.sample.audioRtp?.inbound?.packetsLost, null);
  equal(absent.sample.audioRtp?.inbound?.concealedSamples, null);
  equal(absent.sample.audioRtp?.inbound?.jitterMs, null);
  equal(absent.sample.audioRtp?.signal?.audioLevel, null);
  equal(absent.sample.audioRtp?.signal?.totalAudioEnergy, null);
  equal(absent.sample.audioRtp?.codecInfo, null);
});

test('RMS e dBFS ficam null quando a energia não permite a conta', () => {
  equal(rmsFromEnergy(null, 1).rms, null);
  equal(rmsFromEnergy(1, null).dbFs, null);
  equal(rmsFromEnergy(0, 1).rms, 0);
  equal(rmsFromEnergy(0, 1).dbFs, null);
  equal(rmsFromEnergy(-1, 1).rms, null);
  equal(rmsFromEnergy(1, 0).rms, null);
  equal(rmsFromEnergy(Number.NaN, 1).rms, null);
  const valid = rmsFromEnergy(1, 1);
  equal(valid.rms, 1);
  equal(valid.dbFs, 0);
});
