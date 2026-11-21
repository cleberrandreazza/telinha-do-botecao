import type { MetricSample } from './types.ts';

export interface AbrState {
  currentMaxBitrate: number;
  initialBitrate: number;
  minBitrate: number;
  lowFpsCount: number;
  highFpsCount: number;
  targetFps: number;
}

export interface AbrDecision {
  action: 'decrease' | 'increase' | 'hold';
  reason: 'low-fps' | 'stable-fps' | 'mid' | 'unavailable' | 'already-min' | 'already-max';
  fps: number | null;
  previousBitrate: number;
  nextBitrate: number;
  state: AbrState;
}

// Com degradationPreference='balanced', o Chrome intencionalmente reduz FPS
// para preservar resolução. Thresholds antigos (60%/85%) causavam espiral de
// morte: 17 FPS < 18 threshold → ABR reduzia bitrate → Chrome reduzia FPS mais
// → cascata até 0.5 Mbps / 0 FPS.
// Novos thresholds: 25% permite FPS cair até ~7 sem reduzir bitrate (normal em
// balanced a 1080p). 90% com 15 polls garante recuperação conservadora.
const LOW_FPS_THRESHOLD = 0.25;
const HIGH_FPS_THRESHOLD = 0.90;
const DECREASE_STEP = 0.7;
const INCREASE_STEP = 1.15;
const MIN_LOW_POLLS = 5;
const MIN_HIGH_POLLS = 15;

export function initialAbrState(targetFps: number, maxBitrate: number, minBitrate = 500_000): AbrState {
  return {
    currentMaxBitrate: maxBitrate,
    initialBitrate: maxBitrate,
    minBitrate,
    lowFpsCount: 0,
    highFpsCount: 0,
    targetFps,
  };
}

/** FPS outbound usado pelo ABR. FPS inbound do receptor não entra na conta. null = métrica ausente. */
export function outboundFpsForAbr(sample: MetricSample): number | null {
  const outbound = sample.outbound;
  if (!outbound) return null;
  if (outbound.encodedFps !== null) return outbound.encodedFps;
  if (outbound.reportedFps !== null) return outbound.reportedFps;
  return null;
}

export function evaluateAbr(state: AbrState, fps: number | null): AbrDecision {
  const next: AbrState = { ...state };
  const hold = (reason: AbrDecision['reason']): AbrDecision => ({
    action: 'hold',
    reason,
    fps,
    previousBitrate: state.currentMaxBitrate,
    nextBitrate: next.currentMaxBitrate,
    state: next,
  });

  if (fps === null || !Number.isFinite(fps) || state.targetFps <= 0) {
    return hold('unavailable');
  }

  const ratio = fps / state.targetFps;
  if (ratio < LOW_FPS_THRESHOLD) {
    next.lowFpsCount = state.lowFpsCount + 1;
    next.highFpsCount = 0;
    if (next.lowFpsCount >= MIN_LOW_POLLS) {
      const reduced = Math.max(state.minBitrate, Math.round(state.currentMaxBitrate * DECREASE_STEP));
      next.lowFpsCount = 0;
      if (reduced < state.currentMaxBitrate) {
        next.currentMaxBitrate = reduced;
        return {
          action: 'decrease',
          reason: 'low-fps',
          fps,
          previousBitrate: state.currentMaxBitrate,
          nextBitrate: reduced,
          state: next,
        };
      }
      return hold('already-min');
    }
    return hold('low-fps');
  }

  if (ratio >= HIGH_FPS_THRESHOLD) {
    next.highFpsCount = state.highFpsCount + 1;
    next.lowFpsCount = 0;
    if (next.highFpsCount >= MIN_HIGH_POLLS && state.currentMaxBitrate < state.initialBitrate) {
      const raised = Math.min(state.initialBitrate, Math.round(state.currentMaxBitrate * INCREASE_STEP));
      next.highFpsCount = 0;
      if (raised > state.currentMaxBitrate) {
        next.currentMaxBitrate = raised;
        return {
          action: 'increase',
          reason: 'stable-fps',
          fps,
          previousBitrate: state.currentMaxBitrate,
          nextBitrate: raised,
          state: next,
        };
      }
      return hold('already-max');
    }
    return hold('stable-fps');
  }

  next.lowFpsCount = Math.max(0, state.lowFpsCount - 1);
  next.highFpsCount = Math.max(0, state.highFpsCount - 1);
  return hold('mid');
}

export interface BitrateApplier {
  applyMaxBitrate(bitrate: number): void;
}

export interface AbrChange {
  action: 'decrease' | 'increase';
  from: number;
  to: number;
  fps: number | null;
}

/**
 * Consome amostras já coletadas. Não chama getStats.
 * Avalia a cada 2 amostras para manter o intervalo de 2s com coleta de 1s.
 */
export class AdaptiveBitrateController {
  private state: AbrState;
  private samplesSinceEval = 0;
  private stopped = false;
  private readonly applier: BitrateApplier;
  private readonly onChange?: (change: AbrChange) => void;

  constructor(
    applier: BitrateApplier,
    targetFps: number,
    maxBitrate: number,
    onChange?: (change: AbrChange) => void,
  ) {
    this.applier = applier;
    this.onChange = onChange;
    this.state = initialAbrState(targetFps, maxBitrate);
  }

  onSample(sample: MetricSample) {
    if (this.stopped || sample.role !== 'sender') return;
    this.samplesSinceEval += 1;
    if (this.samplesSinceEval < 2) return;
    this.samplesSinceEval = 0;
    const decision = evaluateAbr(this.state, outboundFpsForAbr(sample));
    this.state = decision.state;
    if (decision.action === 'decrease' || decision.action === 'increase') {
      this.applier.applyMaxBitrate(decision.nextBitrate);
      this.onChange?.({
        action: decision.action,
        from: decision.previousBitrate,
        to: decision.nextBitrate,
        fps: decision.fps,
      });
    }
  }

  stop() {
    this.stopped = true;
  }

  getState(): string {
    const pct = Math.round((this.state.currentMaxBitrate / this.state.initialBitrate) * 100);
    return `${(this.state.currentMaxBitrate / 1_000_000).toFixed(1)}Mbps (${pct}%)`;
  }
}
