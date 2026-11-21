import { parseOpusFmtp } from './audio.ts';
import { selectNetwork } from './ice.ts';
import { avgMsPerFrame, bitrateFromBytes, diffCounter, lossPercent, perSecond, rmsFromEnergy } from './math.ts';
import { readNumber, readString } from './read.ts';
import type {
  AudioInboundQuality,
  AudioSignalStats,
  EndpointRole,
  InboundMetrics,
  LimitationDurations,
  MetricSample,
  OutboundMetrics,
  PlaybackSample,
  RemoteInboundMetrics,
  RtpCodecInfo,
  StatsReportLike,
} from './types.ts';

export interface CounterSnapshot {
  videoTimestamp: number | null;
  audioTimestamp: number | null;
  framesEncoded: number | null;
  totalEncodeTime: number | null;
  bytesSent: number | null;
  keyFramesEncoded: number | null;
  nackOut: number | null;
  pliOut: number | null;
  firOut: number | null;
  encodedFps: number | null;
  framesReceived: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
  totalDecodeTime: number | null;
  packetsReceived: number | null;
  packetsLost: number | null;
  bytesReceived: number | null;
  jitterBufferDelay: number | null;
  jitterBufferEmittedCount: number | null;
  freezeCount: number | null;
  totalFreezesDuration: number | null;
  keyFramesDecoded: number | null;
  nackIn: number | null;
  pliIn: number | null;
  firIn: number | null;
  audioBytesOut: number | null;
  audioBytesIn: number | null;
  audioPackets: number | null;
  audioSamples: number | null;
  audioPacketsLost: number | null;
  audioConcealedSamples: number | null;
  audioConcealmentEvents: number | null;
  audioSilentConcealed: number | null;
  audioFecReceived: number | null;
  audioFecDiscarded: number | null;
  audioRemovedSamples: number | null;
  audioInsertedSamples: number | null;
  audioEnergy: number | null;
  audioEnergyDuration: number | null;
  audioJitterDelay: number | null;
  audioJitterEmitted: number | null;
}

export function emptyCounters(): CounterSnapshot {
  return {
    videoTimestamp: null,
    audioTimestamp: null,
    framesEncoded: null,
    totalEncodeTime: null,
    bytesSent: null,
    keyFramesEncoded: null,
    nackOut: null,
    pliOut: null,
    firOut: null,
    encodedFps: null,
    framesReceived: null,
    framesDecoded: null,
    framesDropped: null,
    totalDecodeTime: null,
    packetsReceived: null,
    packetsLost: null,
    bytesReceived: null,
    jitterBufferDelay: null,
    jitterBufferEmittedCount: null,
    freezeCount: null,
    totalFreezesDuration: null,
    keyFramesDecoded: null,
    nackIn: null,
    pliIn: null,
    firIn: null,
    audioBytesOut: null,
    audioBytesIn: null,
    audioPackets: null,
    audioSamples: null,
    audioPacketsLost: null,
    audioConcealedSamples: null,
    audioConcealmentEvents: null,
    audioSilentConcealed: null,
    audioFecReceived: null,
    audioFecDiscarded: null,
    audioRemovedSamples: null,
    audioInsertedSamples: null,
    audioEnergy: null,
    audioEnergyDuration: null,
    audioJitterDelay: null,
    audioJitterEmitted: null,
  };
}

export interface BuildSampleInput {
  reports: StatsReportLike[];
  previous: CounterSnapshot | null;
  role: EndpointRole;
  wallTime: number;
  connectionId: string;
  viewerCount: number | null;
  configuredFps: number | null;
  connectionState: string | null;
  iceConnectionState: string | null;
  playback: PlaybackSample | null;
}

export interface BuildSampleResult {
  sample: MetricSample;
  counters: CounterSnapshot;
}

function listOf(stats: StatsReportLike[] | { forEach: (cb: (report: StatsReportLike) => void) => void }): StatsReportLike[] {
  if (Array.isArray(stats)) return stats;
  const out: StatsReportLike[] = [];
  stats.forEach((report) => out.push(report));
  return out;
}

export function reportsFrom(stats: StatsReportLike[] | { forEach: (cb: (report: StatsReportLike) => void) => void }): StatsReportLike[] {
  return listOf(stats);
}

function pickVideo(reports: StatsReportLike[], type: 'outbound-rtp' | 'inbound-rtp'): StatsReportLike | null {
  const list = reports.filter((report) => report.type === type && report.kind === 'video');
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const bytesKey = type === 'outbound-rtp' ? 'bytesSent' : 'bytesReceived';
  return list.reduce((best, cur) => {
    const bestBytes = readNumber(best, bytesKey) ?? -1;
    const curBytes = readNumber(cur, bytesKey) ?? -1;
    return curBytes > bestBytes ? cur : best;
  });
}

function pickAudio(reports: StatsReportLike[], type: 'outbound-rtp' | 'inbound-rtp'): StatsReportLike | null {
  const list = reports.filter((report) => report.type === type && report.kind === 'audio');
  return list[0] ?? null;
}

function codecName(reports: StatsReportLike[], codecId: string | null): string | null {
  if (!codecId) return null;
  const codec = reports.find((report) => report.type === 'codec' && report.id === codecId);
  const mime = codec ? readString(codec, 'mimeType') : null;
  if (!mime) return null;
  return mime.replace(/^video\//, '').replace(/^audio\//, '');
}

function rtpCodecInfo(reports: StatsReportLike[], codecId: string | null): RtpCodecInfo | null {
  if (!codecId) return null;
  const codec = reports.find((report) => report.type === 'codec' && report.id === codecId);
  if (!codec) return null;
  return {
    mimeType: readString(codec, 'mimeType'),
    clockRate: readNumber(codec, 'clockRate'),
    channels: readNumber(codec, 'channels'),
    fmtp: parseOpusFmtp(readString(codec, 'sdpFmtpLine')),
  };
}

/** Origem de áudio. O media-source de vídeo, mesmo com o mesmo id, não entra aqui. */
function audioMediaSource(reports: StatsReportLike[], audioOutbound: StatsReportLike | null): StatsReportLike | null {
  const sourceId = audioOutbound ? readString(audioOutbound, 'mediaSourceId') : null;
  if (sourceId) {
    return reports.find((report) => report.id === sourceId && report.type === 'media-source' && report.kind === 'audio') ?? null;
  }
  const audios = reports.filter((report) => report.type === 'media-source' && report.kind === 'audio');
  return audios.length === 1 ? audios[0] : null;
}

function limitationDurations(report: StatsReportLike | null): LimitationDurations | null {
  if (!report || !('qualityLimitationDurations' in report)) return null;
  const raw = report.qualityLimitationDurations;
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const read = (key: string): number | null => {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const durations = {
    none: read('none'),
    cpu: read('cpu'),
    bandwidth: read('bandwidth'),
    other: read('other'),
  };
  if (durations.none === null && durations.cpu === null && durations.bandwidth === null && durations.other === null) {
    return null;
  }
  return durations;
}

function mediaSource(reports: StatsReportLike[], outbound: StatsReportLike | null): { report: StatsReportLike | null; id: string | null } {
  const sourceId = outbound ? readString(outbound, 'mediaSourceId') : null;
  if (sourceId) {
    return { report: reports.find((report) => report.id === sourceId) ?? null, id: sourceId };
  }
  const videos = reports.filter((report) => report.type === 'media-source' && report.kind === 'video');
  if (videos.length === 1) return { report: videos[0], id: videos[0].id };
  return { report: null, id: null };
}

function remoteInbound(reports: StatsReportLike[]): RemoteInboundMetrics | null {
  const report = reports.find((item) => item.type === 'remote-inbound-rtp' && item.kind === 'video');
  if (!report) return null;
  const fraction = readNumber(report, 'fractionLost');
  const jitter = readNumber(report, 'jitter');
  const rtt = readNumber(report, 'roundTripTime');
  return {
    packetsLost: readNumber(report, 'packetsLost'),
    lossPct: fraction === null ? null : fraction * 100,
    jitterMs: jitter === null ? null : jitter * 1000,
    rttMs: rtt === null ? null : rtt * 1000,
  };
}

export function buildSample(input: BuildSampleInput): BuildSampleResult {
  const reports = input.reports;
  const prev = input.previous;
  const outboundReport = pickVideo(reports, 'outbound-rtp');
  const inboundReport = pickVideo(reports, 'inbound-rtp');
  const audioReport = pickAudio(reports, input.role === 'sender' ? 'outbound-rtp' : 'inbound-rtp');
  const videoReport = input.role === 'sender' ? outboundReport : inboundReport;
  const videoTimestamp = readNumber(videoReport, 'timestamp');
  const audioTimestamp = readNumber(audioReport, 'timestamp');

  let dtMs: number | null = null;
  if (prev && prev.videoTimestamp !== null && videoTimestamp !== null) {
    const dt = videoTimestamp - prev.videoTimestamp;
    dtMs = Number.isFinite(dt) && dt >= 0 ? dt : null;
  }

  let audioDt: number | null = null;
  if (prev && prev.audioTimestamp !== null && audioTimestamp !== null) {
    const dt = audioTimestamp - prev.audioTimestamp;
    audioDt = Number.isFinite(dt) && dt >= 0 ? dt : null;
  }

  const encoded = diffCounter(readNumber(outboundReport, 'framesEncoded'), prev?.framesEncoded ?? null);
  const encodeTime = diffCounter(readNumber(outboundReport, 'totalEncodeTime'), prev?.totalEncodeTime ?? null);
  const bytesSent = diffCounter(readNumber(outboundReport, 'bytesSent'), prev?.bytesSent ?? null);
  const keyOut = diffCounter(readNumber(outboundReport, 'keyFramesEncoded'), prev?.keyFramesEncoded ?? null);
  const nackOut = diffCounter(readNumber(outboundReport, 'nackCount'), prev?.nackOut ?? null);
  const pliOut = diffCounter(readNumber(outboundReport, 'pliCount'), prev?.pliOut ?? null);
  const firOut = diffCounter(readNumber(outboundReport, 'firCount'), prev?.firOut ?? null);

  const received = diffCounter(readNumber(inboundReport, 'framesReceived'), prev?.framesReceived ?? null);
  const decoded = diffCounter(readNumber(inboundReport, 'framesDecoded'), prev?.framesDecoded ?? null);
  const dropped = diffCounter(readNumber(inboundReport, 'framesDropped'), prev?.framesDropped ?? null);
  const decodeTime = diffCounter(readNumber(inboundReport, 'totalDecodeTime'), prev?.totalDecodeTime ?? null);
  const packetsReceived = diffCounter(readNumber(inboundReport, 'packetsReceived'), prev?.packetsReceived ?? null);
  const packetsLost = diffCounter(readNumber(inboundReport, 'packetsLost'), prev?.packetsLost ?? null);
  const bytesReceived = diffCounter(readNumber(inboundReport, 'bytesReceived'), prev?.bytesReceived ?? null);
  const jitterDelay = diffCounter(readNumber(inboundReport, 'jitterBufferDelay'), prev?.jitterBufferDelay ?? null);
  const jitterEmitted = diffCounter(readNumber(inboundReport, 'jitterBufferEmittedCount'), prev?.jitterBufferEmittedCount ?? null);
  const freezes = diffCounter(readNumber(inboundReport, 'freezeCount'), prev?.freezeCount ?? null);
  const freezeDuration = diffCounter(readNumber(inboundReport, 'totalFreezesDuration'), prev?.totalFreezesDuration ?? null);
  const keyIn = diffCounter(readNumber(inboundReport, 'keyFramesDecoded'), prev?.keyFramesDecoded ?? null);
  const nackIn = diffCounter(readNumber(inboundReport, 'nackCount'), prev?.nackIn ?? null);
  const pliIn = diffCounter(readNumber(inboundReport, 'pliCount'), prev?.pliIn ?? null);
  const firIn = diffCounter(readNumber(inboundReport, 'firCount'), prev?.firIn ?? null);

  const audioBytes = input.role === 'sender'
    ? diffCounter(readNumber(audioReport, 'bytesSent'), prev?.audioBytesOut ?? null)
    : diffCounter(readNumber(audioReport, 'bytesReceived'), prev?.audioBytesIn ?? null);
  const audioPackets = input.role === 'sender'
    ? diffCounter(readNumber(audioReport, 'packetsSent'), prev?.audioPackets ?? null)
    : diffCounter(readNumber(audioReport, 'packetsReceived'), prev?.audioPackets ?? null);
  const sampleKey = input.role === 'sender' ? 'totalSamplesSent' : 'totalSamplesReceived';
  const audioSamples = diffCounter(readNumber(audioReport, sampleKey), prev?.audioSamples ?? null);
  const energyReport = input.role === 'sender' ? audioMediaSource(reports, audioReport) : audioReport;
  const audioPacketsLost = diffCounter(readNumber(audioReport, 'packetsLost'), prev?.audioPacketsLost ?? null);
  const audioConcealed = diffCounter(readNumber(audioReport, 'concealedSamples'), prev?.audioConcealedSamples ?? null);
  const audioConcealmentEvents = diffCounter(readNumber(audioReport, 'concealmentEvents'), prev?.audioConcealmentEvents ?? null);
  const audioSilent = diffCounter(readNumber(audioReport, 'silentConcealedSamples'), prev?.audioSilentConcealed ?? null);
  const audioFecReceived = diffCounter(readNumber(audioReport, 'fecPacketsReceived'), prev?.audioFecReceived ?? null);
  const audioFecDiscarded = diffCounter(readNumber(audioReport, 'fecPacketsDiscarded'), prev?.audioFecDiscarded ?? null);
  const audioRemoved = diffCounter(readNumber(audioReport, 'removedSamplesForAcceleration'), prev?.audioRemovedSamples ?? null);
  const audioInserted = diffCounter(readNumber(audioReport, 'insertedSamplesForDeceleration'), prev?.audioInsertedSamples ?? null);
  const audioEnergy = diffCounter(readNumber(energyReport, 'totalAudioEnergy'), prev?.audioEnergy ?? null);
  const audioEnergyDuration = diffCounter(readNumber(energyReport, 'totalSamplesDuration'), prev?.audioEnergyDuration ?? null);
  const audioJitterDelay = diffCounter(readNumber(audioReport, 'jitterBufferDelay'), prev?.audioJitterDelay ?? null);
  const audioJitterEmitted = diffCounter(readNumber(audioReport, 'jitterBufferEmittedCount'), prev?.audioJitterEmitted ?? null);

  const resets = [
    encoded, encodeTime, bytesSent, keyOut, nackOut, pliOut, firOut,
    received, decoded, dropped, decodeTime, packetsReceived, packetsLost, bytesReceived,
    jitterDelay, jitterEmitted, freezes, freezeDuration, keyIn, nackIn, pliIn, firIn,
    audioBytes, audioPackets, audioSamples, audioPacketsLost, audioConcealed, audioConcealmentEvents,
    audioSilent, audioFecReceived, audioFecDiscarded, audioRemoved, audioInserted,
    audioEnergy, audioEnergyDuration, audioJitterDelay, audioJitterEmitted,
  ];
  const countersReset = resets.some((item) => item.reset);

  const encodedFps = perSecond(encoded.delta, dtMs);
  const source = mediaSource(reports, outboundReport);
  const sourceFps = readNumber(source.report, 'framesPerSecond');
  const reportedOut = readNumber(outboundReport, 'framesPerSecond');
  const encodedForGap = encodedFps ?? reportedOut;

  const outbound: OutboundMetrics | null = outboundReport ? {
    reportedFps: reportedOut,
    encodedFps,
    framesEncoded: readNumber(outboundReport, 'framesEncoded'),
    sourceFps,
    sourceWidth: readNumber(source.report, 'width'),
    sourceHeight: readNumber(source.report, 'height'),
    sourceId: source.id,
    frameProductionVariation: encodedFps !== null && prev?.encodedFps !== null && prev?.encodedFps !== undefined
      ? Math.abs(encodedFps - prev.encodedFps)
      : null,
    sourceToEncodedGap: sourceFps !== null && encodedForGap !== null ? sourceFps - encodedForGap : null,
    encodeTimePerFrameMs: avgMsPerFrame(encodeTime.delta, encoded.delta),
    totalEncodeTime: readNumber(outboundReport, 'totalEncodeTime'),
    qualityLimitationReason: readString(outboundReport, 'qualityLimitationReason'),
    qualityLimitationDurations: limitationDurations(outboundReport),
    targetBitrate: readNumber(outboundReport, 'targetBitrate'),
    bytesSent: readNumber(outboundReport, 'bytesSent'),
    bitrate: bitrateFromBytes(bytesSent.delta, dtMs),
    frameWidth: readNumber(outboundReport, 'frameWidth'),
    frameHeight: readNumber(outboundReport, 'frameHeight'),
    keyFramesEncoded: readNumber(outboundReport, 'keyFramesEncoded'),
    keyFramesPerSec: perSecond(keyOut.delta, dtMs),
    nackCount: readNumber(outboundReport, 'nackCount'),
    nackPerSec: perSecond(nackOut.delta, dtMs),
    pliCount: readNumber(outboundReport, 'pliCount'),
    pliPerSec: perSecond(pliOut.delta, dtMs),
    firCount: readNumber(outboundReport, 'firCount'),
    firPerSec: perSecond(firOut.delta, dtMs),
  } : null;

  const jitterSec = readNumber(inboundReport, 'jitter');
  const inbound: InboundMetrics | null = inboundReport ? {
    reportedFps: readNumber(inboundReport, 'framesPerSecond'),
    receivedFps: perSecond(received.delta, dtMs),
    framesReceived: readNumber(inboundReport, 'framesReceived'),
    decodedFps: perSecond(decoded.delta, dtMs),
    framesDecoded: readNumber(inboundReport, 'framesDecoded'),
    droppedFps: perSecond(dropped.delta, dtMs),
    framesDropped: readNumber(inboundReport, 'framesDropped'),
    decodeTimePerFrameMs: avgMsPerFrame(decodeTime.delta, decoded.delta),
    totalDecodeTime: readNumber(inboundReport, 'totalDecodeTime'),
    keyFramesDecoded: readNumber(inboundReport, 'keyFramesDecoded'),
    keyFramesPerSec: perSecond(keyIn.delta, dtMs),
    packetsReceived: readNumber(inboundReport, 'packetsReceived'),
    packetsLost: readNumber(inboundReport, 'packetsLost'),
    lossPct: lossPercent(packetsLost.delta, packetsReceived.delta),
    jitterMs: jitterSec === null ? null : jitterSec * 1000,
    jitterBufferAvgDelayMs: avgMsPerFrame(jitterDelay.delta, jitterEmitted.delta),
    jitterBufferDelay: readNumber(inboundReport, 'jitterBufferDelay'),
    jitterBufferEmittedCount: readNumber(inboundReport, 'jitterBufferEmittedCount'),
    freezes: freezes.delta,
    freezeCount: readNumber(inboundReport, 'freezeCount'),
    freezeDurationSec: freezeDuration.delta,
    totalFreezesDuration: readNumber(inboundReport, 'totalFreezesDuration'),
    nackCount: readNumber(inboundReport, 'nackCount'),
    nackPerSec: perSecond(nackIn.delta, dtMs),
    pliCount: readNumber(inboundReport, 'pliCount'),
    pliPerSec: perSecond(pliIn.delta, dtMs),
    firCount: readNumber(inboundReport, 'firCount'),
    firPerSec: perSecond(firIn.delta, dtMs),
    bytesReceived: readNumber(inboundReport, 'bytesReceived'),
    bitrate: bitrateFromBytes(bytesReceived.delta, dtMs),
    frameWidth: readNumber(inboundReport, 'frameWidth'),
    frameHeight: readNumber(inboundReport, 'frameHeight'),
  } : null;

  const audioBytesNow = input.role === 'sender'
    ? readNumber(audioReport, 'bytesSent')
    : readNumber(audioReport, 'bytesReceived');

  const counters: CounterSnapshot = {
    videoTimestamp,
    audioTimestamp,
    framesEncoded: readNumber(outboundReport, 'framesEncoded'),
    totalEncodeTime: readNumber(outboundReport, 'totalEncodeTime'),
    bytesSent: readNumber(outboundReport, 'bytesSent'),
    keyFramesEncoded: readNumber(outboundReport, 'keyFramesEncoded'),
    nackOut: readNumber(outboundReport, 'nackCount'),
    pliOut: readNumber(outboundReport, 'pliCount'),
    firOut: readNumber(outboundReport, 'firCount'),
    encodedFps,
    framesReceived: readNumber(inboundReport, 'framesReceived'),
    framesDecoded: readNumber(inboundReport, 'framesDecoded'),
    framesDropped: readNumber(inboundReport, 'framesDropped'),
    totalDecodeTime: readNumber(inboundReport, 'totalDecodeTime'),
    packetsReceived: readNumber(inboundReport, 'packetsReceived'),
    packetsLost: readNumber(inboundReport, 'packetsLost'),
    bytesReceived: readNumber(inboundReport, 'bytesReceived'),
    jitterBufferDelay: readNumber(inboundReport, 'jitterBufferDelay'),
    jitterBufferEmittedCount: readNumber(inboundReport, 'jitterBufferEmittedCount'),
    freezeCount: readNumber(inboundReport, 'freezeCount'),
    totalFreezesDuration: readNumber(inboundReport, 'totalFreezesDuration'),
    keyFramesDecoded: readNumber(inboundReport, 'keyFramesDecoded'),
    nackIn: readNumber(inboundReport, 'nackCount'),
    pliIn: readNumber(inboundReport, 'pliCount'),
    firIn: readNumber(inboundReport, 'firCount'),
    audioBytesOut: input.role === 'sender' ? audioBytesNow : prev?.audioBytesOut ?? null,
    audioBytesIn: input.role === 'receiver' ? audioBytesNow : prev?.audioBytesIn ?? null,
    audioPackets: readNumber(audioReport, input.role === 'sender' ? 'packetsSent' : 'packetsReceived'),
    audioSamples: readNumber(audioReport, sampleKey),
    audioPacketsLost: readNumber(audioReport, 'packetsLost'),
    audioConcealedSamples: readNumber(audioReport, 'concealedSamples'),
    audioConcealmentEvents: readNumber(audioReport, 'concealmentEvents'),
    audioSilentConcealed: readNumber(audioReport, 'silentConcealedSamples'),
    audioFecReceived: readNumber(audioReport, 'fecPacketsReceived'),
    audioFecDiscarded: readNumber(audioReport, 'fecPacketsDiscarded'),
    audioRemovedSamples: readNumber(audioReport, 'removedSamplesForAcceleration'),
    audioInsertedSamples: readNumber(audioReport, 'insertedSamplesForDeceleration'),
    audioEnergy: readNumber(energyReport, 'totalAudioEnergy'),
    audioEnergyDuration: readNumber(energyReport, 'totalSamplesDuration'),
    audioJitterDelay: readNumber(audioReport, 'jitterBufferDelay'),
    audioJitterEmitted: readNumber(audioReport, 'jitterBufferEmittedCount'),
  };
  const audioDtMs = audioDt ?? dtMs;
  const audioFlowing = (audioBytes.delta ?? 0) > 0 || (audioPackets.delta ?? 0) > 0;
  const signal: AudioSignalStats | null = audioReport ? {
    audioLevel: readNumber(energyReport, 'audioLevel'),
    totalAudioEnergy: readNumber(energyReport, 'totalAudioEnergy'),
    totalSamplesDuration: readNumber(energyReport, 'totalSamplesDuration'),
    ...rmsFromEnergy(audioEnergy.delta, audioEnergyDuration.delta),
  } : null;
  const audioJitterSec = readNumber(audioReport, 'jitter');
  const inboundAudio: AudioInboundQuality | null = input.role === 'receiver' && audioReport ? {
    packetsReceived: readNumber(audioReport, 'packetsReceived'),
    packetsLost: readNumber(audioReport, 'packetsLost'),
    packetsLostDelta: audioPacketsLost.delta,
    jitterMs: audioJitterSec === null ? null : audioJitterSec * 1000,
    concealedSamples: readNumber(audioReport, 'concealedSamples'),
    concealedSamplesDelta: audioConcealed.delta,
    concealmentEvents: readNumber(audioReport, 'concealmentEvents'),
    concealmentEventsDelta: audioConcealmentEvents.delta,
    silentConcealedSamples: readNumber(audioReport, 'silentConcealedSamples'),
    silentConcealedSamplesDelta: audioSilent.delta,
    fecPacketsReceived: readNumber(audioReport, 'fecPacketsReceived'),
    fecPacketsReceivedDelta: audioFecReceived.delta,
    fecPacketsDiscarded: readNumber(audioReport, 'fecPacketsDiscarded'),
    fecPacketsDiscardedDelta: audioFecDiscarded.delta,
    removedSamplesForAcceleration: readNumber(audioReport, 'removedSamplesForAcceleration'),
    removedSamplesDelta: audioRemoved.delta,
    insertedSamplesForDeceleration: readNumber(audioReport, 'insertedSamplesForDeceleration'),
    insertedSamplesDelta: audioInserted.delta,
    totalSamplesReceived: readNumber(audioReport, 'totalSamplesReceived'),
    jitterBufferDelay: readNumber(audioReport, 'jitterBufferDelay'),
    jitterBufferEmittedCount: readNumber(audioReport, 'jitterBufferEmittedCount'),
    jitterBufferAvgDelayMs: avgMsPerFrame(audioJitterDelay.delta, audioJitterEmitted.delta),
  } : null;

  const sample: MetricSample = {
    timestamp: input.wallTime,
    connectionId: input.connectionId,
    role: input.role,
    viewerCount: input.viewerCount,
    configuredFps: input.configuredFps,
    connectionState: input.connectionState,
    iceConnectionState: input.iceConnectionState,
    dtMs,
    countersReset,
    videoCodec: codecName(reports, readString(videoReport, 'codecId')),
    audioCodec: codecName(reports, readString(audioReport, 'codecId')),
    hasAudio: audioFlowing,
    audioBitrate: bitrateFromBytes(audioBytes.delta, audioDtMs),
    audioRtp: audioReport ? {
      codec: codecName(reports, readString(audioReport, 'codecId')),
      packets: readNumber(audioReport, input.role === 'sender' ? 'packetsSent' : 'packetsReceived'),
      packetsPerSec: perSecond(audioPackets.delta, audioDtMs),
      bytes: audioBytesNow,
      bitrate: bitrateFromBytes(audioBytes.delta, audioDtMs),
      samples: readNumber(audioReport, sampleKey),
      samplesPerSec: perSecond(audioSamples.delta, audioDtMs),
      codecInfo: rtpCodecInfo(reports, readString(audioReport, 'codecId')),
      signal,
      inbound: inboundAudio,
    } : null,
    audio: null,
    outbound,
    inbound,
    remoteInbound: remoteInbound(reports),
    network: selectNetwork(reports),
    playback: input.playback,
  };

  return { sample, counters };
}
