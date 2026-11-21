import type { ChartPoint, IceRoute, MetricSample, PlaybackSample } from './types.ts';
import { UNAVAILABLE_LABEL } from './types.ts';

export interface PipelineFps {
  requested: number | null;
  source: number | null;
  encoded: number | null;
  received: number | null;
  decoded: number | null;
  presented: number | null;
}

/** Medições separadas. O FPS solicitado nunca preenche um medido ausente ou zero. */
export function pipelineFps(sample: MetricSample): PipelineFps {
  return {
    requested: sample.configuredFps,
    source: sample.outbound?.sourceFps ?? null,
    encoded: sample.outbound ? (sample.outbound.encodedFps ?? sample.outbound.reportedFps) : null,
    received: sample.inbound?.receivedFps ?? null,
    decoded: sample.inbound ? (sample.inbound.decodedFps ?? sample.inbound.reportedFps) : null,
    presented: sample.playback && sample.playback.api !== 'none' ? sample.playback.presentedFps : null,
  };
}

export function formatMeasuredFps(measured: number | null, digits = 0): string {
  if (measured === null || !Number.isFinite(measured)) return UNAVAILABLE_LABEL;
  return measured.toFixed(digits);
}

export function formatBitrate(bps: number | null): string {
  if (bps === null || !Number.isFinite(bps) || bps < 0) return UNAVAILABLE_LABEL;
  if (bps === 0) return '0 bps';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`;
  return `${Math.round(bps)} bps`;
}

export function formatOptional(value: number | null, digits: number, unit: string): string {
  if (value === null || !Number.isFinite(value)) return UNAVAILABLE_LABEL;
  const shown = value.toFixed(digits);
  return unit ? `${shown} ${unit}` : shown;
}

export function routeLabel(route: IceRoute): string {
  if (route === 'direct') return 'Direta';
  if (route === 'relay') return 'TURN/Relay';
  return 'Desconhecida';
}

export function fpsColor(fps: number | null, configured: number | null): string {
  if (fps === null) return 'text-white';
  if (fps === 0) return 'text-red-400';
  const ref = configured && configured > 0 ? configured : 30;
  const ratio = fps / ref;
  if (ratio < 0.5) return 'text-red-400';
  if (ratio < 0.8) return 'text-yellow-400';
  return 'text-green-400';
}

export function effectiveResolution(sample: MetricSample): { width: number | null; height: number | null } {
  if (sample.role === 'sender' && sample.outbound) {
    if (sample.outbound.frameWidth !== null && sample.outbound.frameHeight !== null) {
      return { width: sample.outbound.frameWidth, height: sample.outbound.frameHeight };
    }
    if (sample.outbound.sourceWidth !== null && sample.outbound.sourceHeight !== null) {
      return { width: sample.outbound.sourceWidth, height: sample.outbound.sourceHeight };
    }
  }
  if (sample.role === 'receiver' && sample.inbound?.frameWidth !== null && sample.inbound?.frameHeight !== null && sample.inbound) {
    return { width: sample.inbound.frameWidth, height: sample.inbound.frameHeight };
  }
  return { width: null, height: null };
}

export function toChartPoint(sample: MetricSample): ChartPoint {
  const fps = pipelineFps(sample);
  const bitrate = sample.role === 'sender' ? sample.outbound?.bitrate ?? null : sample.inbound?.bitrate ?? null;
  const jitter = sample.role === 'receiver'
    ? sample.inbound?.jitterMs ?? null
    : sample.remoteInbound?.jitterMs ?? null;
  return {
    t: sample.timestamp,
    sourceFps: fps.source,
    encodedFps: fps.encoded,
    receivedFps: fps.received,
    decodedFps: fps.decoded,
    presentedFps: fps.presented,
    lossPct: sample.inbound?.lossPct ?? sample.remoteInbound?.lossPct ?? null,
    bitrate,
    rttMs: sample.network.rttMs,
    jitterMs: jitter,
  };
}

export function buildChart(samples: MetricSample[], playback: PlaybackSample[] = []): ChartPoint[] {
  if (samples.length === 0) {
    return playback.slice(-60).map((item) => ({
      t: item.timestamp,
      sourceFps: null,
      encodedFps: null,
      receivedFps: null,
      decodedFps: null,
      presentedFps: item.api === 'none' ? null : item.presentedFps,
      lossPct: null,
      bitrate: null,
      rttMs: null,
      jitterMs: null,
    }));
  }
  return samples.slice(-60).map((sample) => {
    const point = toChartPoint(sample);
    if (point.presentedFps === null && playback.length) {
      let best: PlaybackSample | null = null;
      let bestDist = Infinity;
      for (const item of playback) {
        const dist = Math.abs(item.timestamp - sample.timestamp);
        if (dist < bestDist) {
          best = item;
          bestDist = dist;
        }
      }
      if (best && bestDist <= 1500 && best.api !== 'none') point.presentedFps = best.presentedFps;
    }
    return point;
  });
}
