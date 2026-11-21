export const TIMELINE_LIMIT = 600;

export type TimelineEventType =
  | 'transmission-started'
  | 'viewer-requested'
  | 'peer-connection-created'
  | 'offer-sent'
  | 'answer-received'
  | 'connection-established'
  | 'ice-connected'
  | 'first-sample'
  | 'first-video-received'
  | 'viewer-disconnected'
  | 'connection-closed'
  | 'reconnected'
  | 'viewer-count-changed';

/** Evento da sessão. Sem peerId, apelido, IP ou SDP. */
export interface TimelineEvent {
  timestamp: number;
  sequence: number;
  type: TimelineEventType;
  connectionId: string | null;
  viewerCount: number;
}

/**
 * Relógio único da sessão neste navegador: o mesmo `now` serve para a linha do tempo e para os monitores.
 * Não há relógio compartilhado entre máquinas.
 */
export class SessionTimeline {
  readonly sessionStartedAt: number;
  private sequence = 0;
  private viewerCount = 0;
  private readonly events: TimelineEvent[] = [];
  private readonly onceKeys = new Set<string>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.sessionStartedAt = now();
  }

  clock(): number {
    return this.now();
  }

  snapshot(): TimelineEvent[] {
    return this.events.slice();
  }

  setViewerCount(count: number) {
    if (count === this.viewerCount) return;
    this.viewerCount = count;
    this.push('viewer-count-changed', null);
  }

  transmissionStarted() {
    this.push('transmission-started', null);
  }

  viewerRequested() {
    this.push('viewer-requested', null);
  }

  peerConnectionCreated(connectionId: string) {
    this.push('peer-connection-created', connectionId);
  }

  offerSent(connectionId: string | null) {
    this.push('offer-sent', connectionId);
  }

  answerReceived(connectionId: string | null) {
    this.push('answer-received', connectionId);
  }

  connectionEstablished(connectionId: string) {
    this.pushOnce(connectionId, 'connection-established');
  }

  iceConnected(connectionId: string) {
    this.pushOnce(connectionId, 'ice-connected');
  }

  firstSample(connectionId: string) {
    this.pushOnce(connectionId, 'first-sample');
  }

  firstVideo(connectionId: string) {
    this.pushOnce(connectionId, 'first-video-received');
  }

  viewerDisconnected(connectionId: string) {
    this.push('viewer-disconnected', connectionId);
  }

  connectionClosed(connectionId: string) {
    this.push('connection-closed', connectionId);
  }

  reconnected(connectionId: string) {
    this.push('reconnected', connectionId);
  }

  private pushOnce(connectionId: string, type: TimelineEventType) {
    const key = `${connectionId}:${type}`;
    if (this.onceKeys.has(key)) return;
    this.onceKeys.add(key);
    this.push(type, connectionId);
  }

  private push(type: TimelineEventType, connectionId: string | null) {
    this.sequence += 1;
    this.events.push({
      timestamp: this.now(),
      sequence: this.sequence,
      type,
      connectionId,
      viewerCount: this.viewerCount,
    });
    if (this.events.length > TIMELINE_LIMIT) this.events.shift();
  }
}
