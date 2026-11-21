import { attachAudio, audioEvents, classifyAudio, type AudioCaptureContext, type AudioLinkContext } from './audio.ts';
import { classifyDiagnosis } from './classify.ts';
import { detectEvents, shouldEmit } from './events.ts';
import { buildReport, type BrowserInfo, type DiagnosticReport } from './export.ts';
import { buildChart } from './format.ts';
import { buildSample, emptyCounters, reportsFrom, type CounterSnapshot } from './parse.ts';
import type {
  DiagEvent,
  Diagnosis,
  DiagnosticsSnapshot,
  EventSeverity,
  AudioDiagnosis,
  AudioPlaybackReport,
  MetricSample,
  PlaybackSample,
  StatsReportLike,
  StreamConfigSnapshot,
} from './types.ts';
import { CHART_LIMIT, EVENT_LIMIT, HISTORY_LIMIT } from './types.ts';

export interface PeerConnectionLike {
  connectionState: string;
  iceConnectionState: string;
  getStats: () => Promise<{ forEach: (cb: (report: StatsReportLike) => void) => void }>;
}

export interface MonitorContext {
  viewerCount: number | null;
  configuredFps: number | null;
  streamConfig: StreamConfigSnapshot | null;
  adaptiveState: string | null;
  audioCapture?: AudioCaptureContext | null;
  audioLink?: AudioLinkContext | null;
  remoteAudioTracks?: number | null;
}

export interface MonitorOptions {
  pc: PeerConnectionLike;
  role: 'sender' | 'receiver';
  sessionId: string;
  connectionId?: string;
  intervalMs?: number;
  getContext: () => MonitorContext;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Uma coleta de getStats por conexão e por ciclo.
 * O painel e o ABR leem o resultado; não disparam outra consulta.
 */
export class ConnectionMonitor {
  readonly connectionId: string;
  readonly role: 'sender' | 'receiver';
  readonly sessionId: string;
  private readonly pc: PeerConnectionLike;
  private readonly intervalMs: number;
  private readonly getContext: () => MonitorContext;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private stopped = false;
  private generation = 0;
  private history: MetricSample[] = [];
  private playbackHistory: PlaybackSample[] = [];
  private events: DiagEvent[] = [];
  private diagnoses: Diagnosis[] = [];
  private counters: CounterSnapshot = emptyCounters();
  private listeners = new Set<(snapshot: DiagnosticsSnapshot) => void>();
  private anyListeners = new Set<() => void>();
  private onSample?: (sample: MetricSample) => void;
  private lastDiagnosis: Diagnosis | null = null;
  private eventCooldown = new Map<string, { at: number; severity: EventSeverity }>();
  private startedAt = Date.now();
  private streamConfig: StreamConfigSnapshot | null = null;
  private adaptiveState: string | null = null;
  private lastPlayback: PlaybackSample | null = null;
  private playbackAudio: AudioPlaybackReport | null = null;
  private lastAudio: AudioDiagnosis | null = null;

  constructor(options: MonitorOptions) {
    this.pc = options.pc;
    this.role = options.role;
    this.sessionId = options.sessionId;
    this.connectionId = options.connectionId ?? newId();
    this.intervalMs = options.intervalMs ?? 1000;
    this.getContext = options.getContext;
  }

  start() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.listeners.clear();
    this.anyListeners.clear();
    this.onSample = undefined;
    this.history = [];
    this.playbackHistory = [];
    this.events = [];
    this.diagnoses = [];
    this.counters = emptyCounters();
    this.lastDiagnosis = null;
    this.lastPlayback = null;
    this.playbackAudio = null;
    this.lastAudio = null;
    this.eventCooldown.clear();
  }

  get isStopped() {
    return this.stopped;
  }

  setSampleListener(listener: ((sample: MetricSample) => void) | undefined) {
    this.onSample = listener;
  }

  subscribe(listener: (snapshot: DiagnosticsSnapshot) => void): () => void {
    if (this.stopped) return () => {};
    this.listeners.add(listener);
    const current = this.getSnapshot();
    if (current) listener(current);
    return () => this.listeners.delete(listener);
  }

  subscribeAny(listener: () => void): () => void {
    if (this.stopped) return () => {};
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  pushPlayback(sample: PlaybackSample): boolean {
    if (this.stopped) return false;
    this.lastPlayback = sample;
    this.playbackHistory.push(sample);
    if (this.playbackHistory.length > HISTORY_LIMIT) this.playbackHistory.shift();
    const latest = this.history[this.history.length - 1];
    if (latest && Math.abs(latest.timestamp - sample.timestamp) <= 2000) {
      latest.playback = sample;
      this.reclassify();
    }
    this.emit();
    return true;
  }

  pushAudioPlayback(report: AudioPlaybackReport): boolean {
    if (this.stopped) return false;
    const previous = this.history[this.history.length - 1]?.audio ?? null;
    this.playbackAudio = report;
    const latest = this.history[this.history.length - 1];
    if (latest?.audio) {
      latest.audio = {
        ...latest.audio,
        playbackMuted: report.muted,
        playbackVolume: report.volume,
        playbackPaused: report.paused,
        playbackBlocked: report.blocked,
        playError: report.playError,
        elementAudioTracks: report.elementAudioTracks,
      };
      this.noteAudio(previous, latest.audio);
      this.emit();
    }
    return true;
  }

  recordEvent(event: Omit<DiagEvent, 'connectionId' | 'timestamp'> & { timestamp?: number }) {
    if (this.stopped) return;
    this.pushEvent({
      timestamp: event.timestamp ?? Date.now(),
      connectionId: this.connectionId,
      category: event.category,
      severity: event.severity,
      message: event.message,
      data: event.data,
    });
    this.emit();
  }

  getHistory(): MetricSample[] {
    return this.history.slice();
  }

  getSnapshot(): DiagnosticsSnapshot | null {
    const sample = this.history[this.history.length - 1];
    if (!sample && !this.lastPlayback) return null;
    const diagnosis = this.lastDiagnosis ?? (sample ? classifyDiagnosis(this.history) : {
      category: 'NENHUMA' as const,
      state: 'INDETERMINADO' as const,
      confidence: 'baixo' as const,
      reason: 'Ainda não há amostras WebRTC.',
      evidence: [],
      timestamp: this.lastPlayback?.timestamp ?? Date.now(),
    });
    const baseSample: MetricSample = sample ?? {
      timestamp: this.lastPlayback!.timestamp,
      connectionId: this.connectionId,
      role: this.role,
      viewerCount: null,
      configuredFps: null,
      connectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
      dtMs: null,
      countersReset: false,
      videoCodec: null,
      audioCodec: null,
      hasAudio: false,
      audioBitrate: null,
      audioRtp: null,
      audio: null,
      outbound: null,
      inbound: null,
      remoteInbound: null,
      network: {
        rttMs: null,
        route: 'unknown',
        localCandidateType: null,
        remoteCandidateType: null,
        protocol: null,
        availableOutgoingBitrate: null,
        availableIncomingBitrate: null,
        selectedPairId: null,
        selection: 'none',
      },
      playback: this.lastPlayback,
    };
    return {
      sessionId: this.sessionId,
      collectedFrom: this.startedAt,
      streamConfig: this.streamConfig,
      adaptiveState: this.adaptiveState,
      sample: { ...baseSample, playback: baseSample.playback ?? this.lastPlayback },
      diagnosis,
      audioDiagnosis: this.lastAudio,
      chart: buildChart(this.history.slice(-CHART_LIMIT), this.playbackHistory.slice(-CHART_LIMIT)),
      recentEvents: this.events.slice(-8).reverse(),
    };
  }

  exportReport(browser?: BrowserInfo): DiagnosticReport {
    return buildReport({
      sessionId: this.sessionId,
      collectedFrom: this.startedAt,
      streamConfig: this.streamConfig,
      history: this.history.slice(),
      playback: this.playbackHistory.slice(),
      events: this.events.slice(),
      diagnoses: this.diagnoses.slice(),
      browser,
    });
  }

  async tick() {
    if (this.stopped || this.inFlight) return;
    this.inFlight = true;
    const generation = this.generation;
    try {
      if (this.pc.connectionState === 'closed') return;
      const raw = await this.pc.getStats();
      if (this.stopped || generation !== this.generation) return;
      const context = this.getContext();
      this.streamConfig = context.streamConfig;
      this.adaptiveState = context.adaptiveState;
      const built = buildSample({
        reports: reportsFrom(raw),
        previous: this.counters,
        role: this.role,
        wallTime: Date.now(),
        connectionId: this.connectionId,
        viewerCount: context.viewerCount,
        configuredFps: context.configuredFps,
        connectionState: this.pc.connectionState,
        iceConnectionState: this.pc.iceConnectionState,
        playback: this.lastPlayback,
      });
      if (this.stopped || generation !== this.generation) return;
      const previousAudio = this.history[this.history.length - 1]?.audio ?? null;
      built.sample.audio = attachAudio({
        role: this.role,
        rtp: built.sample.audioRtp,
        capture: context.audioCapture ?? null,
        link: context.audioLink ?? null,
        remoteAudioTracks: context.remoteAudioTracks ?? null,
        playback: this.playbackAudio,
      });
      this.noteAudio(previousAudio, built.sample.audio);
      this.counters = built.counters;
      const previous = this.history[this.history.length - 1] ?? null;
      this.history.push(built.sample);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      this.consumeEvents(previous, built.sample);
      this.reclassify();
      this.emit();
      this.onSample?.(built.sample);
    } catch {
      // getStats falha durante renegociação ou fechamento
    } finally {
      this.inFlight = false;
    }
  }

  private noteAudio(previous: MetricSample['audio'], current: MetricSample['audio']) {
    this.lastAudio = classifyAudio(current);
    for (const draft of audioEvents(previous, current)) {
      const key = `ÁUDIO:${draft.message}`;
      const prev = this.eventCooldown.get(key);
      const now = Date.now();
      if (!shouldEmit(prev?.at, now, draft.severity, prev?.severity)) continue;
      this.eventCooldown.set(key, { at: now, severity: draft.severity });
      this.pushEvent({
        timestamp: now,
        connectionId: this.connectionId,
        category: 'ÁUDIO',
        severity: draft.severity,
        message: draft.message,
        data: { estado: this.lastAudio.code },
      });
    }
  }

  private reclassify() {
    if (!this.history.length) return;
    const diagnosis = classifyDiagnosis(this.history);
    const changed = !this.lastDiagnosis
      || this.lastDiagnosis.state !== diagnosis.state
      || this.lastDiagnosis.category !== diagnosis.category;
    this.lastDiagnosis = diagnosis;
    this.diagnoses.push(diagnosis);
    if (this.diagnoses.length > HISTORY_LIMIT) this.diagnoses.shift();
    if (changed && this.history.length >= 3) {
      this.pushEvent({
        timestamp: diagnosis.timestamp,
        connectionId: this.connectionId,
        category: diagnosis.category,
        severity: diagnosis.state === 'CRÍTICO' ? 'crítico' : diagnosis.state === 'ATENÇÃO' ? 'atenção' : 'info',
        message: 'Mudança do estado de diagnóstico.',
        data: { estado: diagnosis.state, categoria: diagnosis.category },
      });
    }
  }

  private consumeEvents(previous: MetricSample | null, current: MetricSample) {
    for (const draft of detectEvents(previous, current)) {
      const key = `${draft.category}:${draft.message}`;
      const prev = this.eventCooldown.get(key);
      if (!shouldEmit(prev?.at, draft.timestamp, draft.severity, prev?.severity)) continue;
      this.eventCooldown.set(key, { at: draft.timestamp, severity: draft.severity });
      this.pushEvent({ ...draft, connectionId: this.connectionId });
    }
  }

  private pushEvent(event: DiagEvent) {
    this.events.push(event);
    if (this.events.length > EVENT_LIMIT) this.events.shift();
  }

  private emit() {
    if (this.stopped) return;
    const snapshot = this.getSnapshot();
    if (snapshot) {
      for (const listener of this.listeners) listener(snapshot);
    }
    for (const listener of this.anyListeners) listener();
  }
}
