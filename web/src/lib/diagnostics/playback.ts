import { median } from './math.ts';
import type { CompositorFrameInfo, PlaybackSample, PlaybackStall } from './types.ts';

export interface VideoFrameMetadataLike {
  mediaTime: number;
  presentedFrames?: number;
  width?: number;
  height?: number;
  expectedDisplayTime?: number;
  presentationTime?: number;
  processingDuration?: number;
}

export interface VideoPlaybackQualityLike {
  totalVideoFrames: number;
  droppedVideoFrames: number;
  corruptedVideoFrames: number;
}

export interface PlaybackVideo {
  paused: boolean;
  readyState: number;
  videoWidth?: number;
  videoHeight?: number;
  currentTime?: number;
  requestVideoFrameCallback?: (cb: (now: number, metadata: VideoFrameMetadataLike) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
  getVideoPlaybackQuality?: () => VideoPlaybackQualityLike;
}

export interface PlaybackEnvironment {
  visibilityState: string | null;
  hasFocus: boolean | null;
}

/**
 * Amostragem de apresentação a cada 1s.
 * O callback por frame só incrementa contadores; quem chama decide quando publicar na UI.
 * Um callback do compositor não significa que o quadro ficou visível na tela.
 */
export class PlaybackMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private handle = 0;
  private stopped = false;
  private usingRvfc = false;
  private framesThisSecond = 0;
  private irregular = 0;
  private maxGap: number | null = null;
  private lastMediaTime: number | null = null;
  private gaps: number[] = [];
  private seenFrame = false;
  private lastTotal: number | null = null;
  private lastDropped: number | null = null;
  private lastCorrupted: number | null = null;
  private hasQuality = false;
  private intervalFrame: CompositorFrameInfo | null = null;

  private readonly video: PlaybackVideo;
  private readonly onSample: (sample: PlaybackSample) => void;
  private readonly intervalMs: number;
  private readonly environment: () => PlaybackEnvironment;

  constructor(
    video: PlaybackVideo,
    onSample: (sample: PlaybackSample) => void,
    intervalMs = 1000,
    environment?: () => PlaybackEnvironment,
  ) {
    this.video = video;
    this.onSample = onSample;
    this.intervalMs = intervalMs;
    this.environment = environment ?? readPlaybackEnvironment;
  }

  start() {
    if (this.timer || this.stopped) return;
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.usingRvfc = true;
      this.armFrameCallback();
    }
    this.hasQuality = typeof this.video.getVideoPlaybackQuality === 'function';
    this.timer = setInterval(() => {
      this.onSample(this.collect());
    }, this.intervalMs);
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.handle && typeof this.video.cancelVideoFrameCallback === 'function') {
      this.video.cancelVideoFrameCallback(this.handle);
    }
    this.handle = 0;
  }

  collect(): PlaybackSample {
    const now = Date.now();
    const env = this.environment();
    const quality = this.hasQuality ? this.video.getVideoPlaybackQuality?.() ?? null : null;
    const api: PlaybackSample['api'] = this.usingRvfc ? 'rvfc' : quality ? 'playback-quality' : 'none';

    let compositorFps: number | null = null;
    let compositorCallbacks: number | null = null;
    if (this.usingRvfc) {
      compositorCallbacks = this.framesThisSecond;
      compositorFps = this.framesThisSecond;
      this.framesThisSecond = 0;
    }

    let totalPresented: number | null = null;
    let droppedFrames: number | null = null;
    let droppedFps: number | null = null;
    let corruptedFrames: number | null = null;
    let corruptedFps: number | null = null;
    let qualityTotalDelta: number | null = null;

    if (quality) {
      totalPresented = finite(quality.totalVideoFrames);
      droppedFrames = finite(quality.droppedVideoFrames);
      corruptedFrames = finite(quality.corruptedVideoFrames);
      if (this.lastTotal !== null && totalPresented !== null) {
        const delta = totalPresented - this.lastTotal;
        qualityTotalDelta = delta >= 0 ? delta : null;
      }
      if (this.lastDropped !== null && droppedFrames !== null) {
        const delta = droppedFrames - this.lastDropped;
        droppedFps = delta >= 0 ? delta : null;
      }
      if (this.lastCorrupted !== null && corruptedFrames !== null) {
        const delta = corruptedFrames - this.lastCorrupted;
        corruptedFps = delta >= 0 ? delta : null;
      }
      this.lastTotal = totalPresented;
      this.lastDropped = droppedFrames;
      this.lastCorrupted = corruptedFrames;
    }

    const qualityDisplayedEstimate = qualityTotalDelta !== null && droppedFps !== null && qualityTotalDelta >= droppedFps
      ? qualityTotalDelta - droppedFps
      : null;

    const irregular = this.irregular;
    const maxGap = this.maxGap;
    this.irregular = 0;
    this.maxGap = null;
    const lastFrame = this.intervalFrame;
    this.intervalFrame = null;
    const processingDuration = lastFrame?.processingDuration ?? null;
    const compositionLeadSec = leadSeconds(lastFrame);

    const hidden = env.visibilityState === 'hidden';
    const playing = !this.video.paused && this.video.readyState >= 2;
    const visibleEnough = env.visibilityState === null || env.visibilityState === 'visible';
    let stall: PlaybackStall = 'none';
    let freezeSuspected = false;

    if (!this.usingRvfc && !quality) stall = 'measurement-unavailable';
    else if (this.video.paused) stall = 'paused';
    else if (hidden) stall = 'hidden';
    else if (this.usingRvfc && visibleEnough && playing && this.seenFrame && compositorFps === 0) {
      stall = 'no-callbacks';
      freezeSuspected = true;
    } else if (droppedFps !== null && droppedFps >= 3) stall = 'dropped-frames';
    else if (irregular >= 1) stall = 'irregular-media-time';
    else if (
      compositorFps !== null && compositorFps > 0
      && ((processingDuration !== null && processingDuration >= 0.05) || (compositionLeadSec !== null && compositionLeadSec >= 0.05))
    ) stall = 'composition-delay';

    return {
      timestamp: now,
      presentedFps: compositorFps,
      presentedFrames: compositorCallbacks,
      totalPresentedFrames: totalPresented,
      droppedFrames,
      droppedFps,
      corruptedFrames,
      corruptedFps,
      irregularIntervals: irregular,
      freezeSuspected,
      paused: this.video.paused,
      api,
      visibilityState: env.visibilityState,
      hasFocus: env.hasFocus,
      videoWidth: finite(this.video.videoWidth),
      videoHeight: finite(this.video.videoHeight),
      currentTime: finite(this.video.currentTime),
      readyState: finite(this.video.readyState),
      qualityTotalDelta,
      qualityDisplayedEstimate,
      maxMediaTimeGapSec: maxGap,
      processingDuration,
      compositionLeadSec,
      lastFrame,
      stall,
    };
  }

  private armFrameCallback() {
    if (this.stopped || typeof this.video.requestVideoFrameCallback !== 'function') return;
    this.handle = this.video.requestVideoFrameCallback((now, metadata) => {
      if (this.stopped) return;
      this.seenFrame = true;
      this.framesThisSecond += 1;
      if (this.lastMediaTime !== null && Number.isFinite(metadata.mediaTime)) {
        const gap = metadata.mediaTime - this.lastMediaTime;
        if (gap > 0) {
          const typical = median(this.gaps);
          if (this.gaps.length >= 5 && typical !== null && gap > Math.max(0.2, typical * 2.5)) {
            this.irregular += 1;
          }
          if (this.maxGap === null || gap > this.maxGap) this.maxGap = gap;
          this.gaps.push(gap);
          if (this.gaps.length > 30) this.gaps.shift();
        }
      }
      this.lastMediaTime = Number.isFinite(metadata.mediaTime) ? metadata.mediaTime : this.lastMediaTime;
      this.intervalFrame = {
        presentedFrames: finite(metadata.presentedFrames),
        mediaTime: finite(metadata.mediaTime),
        expectedDisplayTime: finite(metadata.expectedDisplayTime),
        presentationTime: finite(metadata.presentationTime),
        processingDuration: finite(metadata.processingDuration),
        callbackTime: finite(now),
        wallTime: Date.now(),
      };
      this.armFrameCallback();
    });
  }
}

export function readPlaybackEnvironment(): PlaybackEnvironment {
  if (typeof document === 'undefined') return { visibilityState: null, hasFocus: null };
  return {
    visibilityState: typeof document.visibilityState === 'string' ? document.visibilityState : null,
    hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
  };
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function leadSeconds(frame: CompositorFrameInfo | null): number | null {
  if (!frame || frame.expectedDisplayTime === null || frame.presentationTime === null) return null;
  return frame.expectedDisplayTime - frame.presentationTime;
}
