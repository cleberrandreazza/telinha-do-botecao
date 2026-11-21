import { median } from './math.ts';
import type { PlaybackSample } from './types.ts';

export interface VideoFrameMetadataLike {
  mediaTime: number;
  presentedFrames?: number;
  width?: number;
  height?: number;
  expectedDisplayTime?: number;
}

export interface VideoPlaybackQualityLike {
  totalVideoFrames: number;
  droppedVideoFrames: number;
  corruptedVideoFrames: number;
}

export interface PlaybackVideo {
  paused: boolean;
  readyState: number;
  requestVideoFrameCallback?: (cb: (now: number, metadata: VideoFrameMetadataLike) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
  getVideoPlaybackQuality?: () => VideoPlaybackQualityLike;
}

/**
 * Amostragem de apresentação a cada 1s.
 * O callback por frame só incrementa contadores; quem chama decide quando publicar na UI.
 */
export class PlaybackMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private handle = 0;
  private stopped = false;
  private usingRvfc = false;
  private framesThisSecond = 0;
  private irregular = 0;
  private lastMediaTime: number | null = null;
  private gaps: number[] = [];
  private seenFrame = false;
  private lastPresented: number | null = null;
  private lastDropped: number | null = null;
  private lastCorrupted: number | null = null;
  private hasQuality = false;

  private readonly video: PlaybackVideo;
  private readonly onSample: (sample: PlaybackSample) => void;
  private readonly intervalMs: number;

  constructor(video: PlaybackVideo, onSample: (sample: PlaybackSample) => void, intervalMs = 1000) {
    this.video = video;
    this.onSample = onSample;
    this.intervalMs = intervalMs;
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
    const quality = this.hasQuality ? this.video.getVideoPlaybackQuality?.() ?? null : null;
    let presentedFrames: number | null = null;
    let presentedFps: number | null = null;
    let totalPresented: number | null = null;
    let api: PlaybackSample['api'] = 'none';

    if (this.usingRvfc) {
      api = 'rvfc';
      presentedFrames = this.framesThisSecond;
      presentedFps = this.framesThisSecond;
      this.framesThisSecond = 0;
    }

    let droppedFrames: number | null = null;
    let droppedFps: number | null = null;
    let corruptedFrames: number | null = null;
    let corruptedFps: number | null = null;

    if (quality) {
      totalPresented = quality.totalVideoFrames;
      droppedFrames = quality.droppedVideoFrames;
      corruptedFrames = quality.corruptedVideoFrames;
      if (!this.usingRvfc) {
        api = 'playback-quality';
        if (this.lastPresented !== null) {
          const delta = quality.totalVideoFrames - this.lastPresented;
          presentedFrames = delta >= 0 ? delta : null;
          presentedFps = presentedFrames;
        }
      }
      if (this.lastDropped !== null) {
        const delta = quality.droppedVideoFrames - this.lastDropped;
        droppedFps = delta >= 0 ? delta : null;
      }
      if (this.lastCorrupted !== null) {
        const delta = quality.corruptedVideoFrames - this.lastCorrupted;
        corruptedFps = delta >= 0 ? delta : null;
      }
      this.lastPresented = quality.totalVideoFrames;
      this.lastDropped = quality.droppedVideoFrames;
      this.lastCorrupted = quality.corruptedVideoFrames;
    }

    const irregular = this.irregular;
    this.irregular = 0;
    const playing = !this.video.paused && this.video.readyState >= 2;
    const freezeSuspected = playing && this.seenFrame && (
      irregular > 0 || (this.usingRvfc && presentedFps === 0)
    );

    return {
      timestamp: now,
      presentedFps,
      presentedFrames,
      totalPresentedFrames: totalPresented,
      droppedFrames,
      droppedFps,
      corruptedFrames,
      corruptedFps,
      irregularIntervals: irregular,
      freezeSuspected,
      paused: this.video.paused,
      api,
    };
  }

  private armFrameCallback() {
    if (this.stopped || typeof this.video.requestVideoFrameCallback !== 'function') return;
    this.handle = this.video.requestVideoFrameCallback((_now, metadata) => {
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
          this.gaps.push(gap);
          if (this.gaps.length > 30) this.gaps.shift();
        }
      }
      this.lastMediaTime = metadata.mediaTime;
      this.armFrameCallback();
    });
  }
}
