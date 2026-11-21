import { test } from 'node:test';
import { equal, ok } from 'node:assert/strict';
import {
  attachAudio,
  buildDisplayMediaOptions,
  captureUnavailableMessage,
  classifyAudio,
  inspectAudioSdp,
  negotiationFromSdp,
  requestDisplayMedia,
  resolvePlayback,
  shouldRebindSrcObject,
} from './audio.ts';
import { buildSample, emptyCounters } from './parse.ts';
import type { AudioFacts, AudioPlaybackReport, StatsReportLike } from './types.ts';

function facts(partial: Partial<AudioFacts> & Pick<AudioFacts, 'role'>): AudioFacts {
  return {
    requested: null,
    displaySurface: null,
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

test('compartilhamento com áudio pede boolean e não aplica processamento', () => {
  const options = buildDisplayMediaOptions({ frameRate: { ideal: 30 } }, true);
  equal(options.audio, true);
  equal(options.systemAudio, 'include');
  equal(options.windowAudio, 'system');
  ok(!('echoCancellation' in options));
  equal(buildDisplayMediaOptions({}, false).audio, false);
  equal(buildDisplayMediaOptions({}, false).systemAudio, undefined);
});

test('captura sem suporte a windowAudio tenta de novo sem essa opção', async () => {
  const seen: Record<string, unknown>[] = [];
  const stream = await requestDisplayMedia(async (options) => {
    seen.push(options);
    if (options.windowAudio) {
      const error = new Error('unsupported');
      error.name = 'NotSupportedError';
      throw error;
    }
    return { getAudioTracks: () => [{}] };
  }, { ideal: true }, true);
  equal(seen.length, 2);
  equal(seen[1].windowAudio, undefined);
  equal(stream.getAudioTracks().length, 1);
  let cancelled = false;
  try {
    await requestDisplayMedia(async () => {
      const error = new Error('cancel');
      error.name = 'NotAllowedError';
      throw error;
    }, {}, true);
  } catch (err) {
    cancelled = err instanceof Error && err.name === 'NotAllowedError';
  }
  equal(cancelled, true);
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
    rtp: { codec: 'opus', packets: 10, packetsPerSec: 10, bytes: 1000, bitrate: 8000, samples: null, samplesPerSec: null },
    capture: null,
    link: { senderAttached: false, negotiated: true, direction: 'sendrecv' },
    remoteAudioTracks: 1,
    playback: playback(),
  });
  const viewerB = attachAudio({
    role: 'receiver',
    rtp: { codec: 'opus', packets: 0, packetsPerSec: 0, bytes: 0, bitrate: 0, samples: null, samplesPerSec: null },
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
