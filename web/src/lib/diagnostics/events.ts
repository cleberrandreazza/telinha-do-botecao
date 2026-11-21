import { roundTo } from './math.ts';
import type { DiagEvent, EventSeverity, MetricSample } from './types.ts';

type Draft = Omit<DiagEvent, 'connectionId'>;

function num(value: number | null | undefined, digits = 1): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return roundTo(value, digits);
}

function fpsOf(sample: MetricSample): number | null {
  if (sample.role === 'sender') {
    return sample.outbound?.encodedFps ?? sample.outbound?.reportedFps ?? null;
  }
  return sample.inbound?.decodedFps ?? sample.inbound?.reportedFps ?? sample.inbound?.receivedFps ?? null;
}

export function detectEvents(prev: MetricSample | null, curr: MetricSample): Draft[] {
  if (!prev) return [];
  const events: Draft[] = [];
  const prevFps = fpsOf(prev);
  const currFps = fpsOf(curr);

  if (prevFps !== null && currFps !== null && prevFps >= 10 && (currFps === 0 || currFps < prevFps * 0.7)) {
    const sourceDropped = prev.outbound?.sourceFps !== null && prev.outbound?.sourceFps !== undefined
      && curr.outbound?.sourceFps !== null && curr.outbound?.sourceFps !== undefined
      && prev.outbound.sourceFps >= 10
      && curr.outbound.sourceFps < prev.outbound.sourceFps * 0.7;
    const encodedOnly = curr.role === 'sender' && !sourceDropped;
    events.push({
      timestamp: curr.timestamp,
      category: curr.role === 'sender' ? 'CAPTURA/CODIFICAÇÃO' : (curr.inbound?.receivedFps !== null && curr.inbound?.receivedFps !== undefined && prev.inbound?.receivedFps !== null && prev.inbound?.receivedFps !== undefined && curr.inbound.receivedFps < prev.inbound.receivedFps * 0.7 ? 'RECEPÇÃO' : 'DECODIFICAÇÃO'),
      severity: currFps === 0 || currFps < prevFps * 0.5 ? 'crítico' : 'atenção',
      message: encodedOnly && curr.outbound?.sourceFps !== null
        ? 'Redução da taxa de frames codificados.'
        : 'Queda significativa de FPS.',
      data: { antes: num(prevFps), agora: num(currFps) },
    });
  }

  const prevLoss = prev.inbound?.lossPct ?? null;
  const currLoss = curr.inbound?.lossPct ?? null;
  if (currLoss !== null && currLoss >= 2 && (prevLoss === null || prevLoss < 2 || currLoss >= prevLoss + 2)) {
    events.push({
      timestamp: curr.timestamp,
      category: 'REDE/TRANSPORTE',
      severity: currLoss >= 8 ? 'crítico' : 'atenção',
      message: 'Aumento relevante de perda de pacotes.',
      data: { antes: num(prevLoss), agora: num(currLoss, 1) },
    });
  }

  const prevJitter = prev.inbound?.jitterMs ?? prev.remoteInbound?.jitterMs ?? null;
  const currJitter = curr.inbound?.jitterMs ?? curr.remoteInbound?.jitterMs ?? null;
  if (prevJitter !== null && currJitter !== null && currJitter > 30 && currJitter >= prevJitter + 20) {
    events.push({
      timestamp: curr.timestamp,
      category: 'REDE/TRANSPORTE',
      severity: currJitter > 80 ? 'atenção' : 'info',
      message: 'Aumento de jitter.',
      data: { antes: num(prevJitter), agora: num(currJitter) },
    });
  }

  const prevRtt = prev.network.rttMs;
  const currRtt = curr.network.rttMs;
  if (prevRtt !== null && currRtt !== null && currRtt >= 100 && (currRtt - prevRtt >= 50 || (prevRtt > 0 && currRtt >= prevRtt * 1.5))) {
    events.push({
      timestamp: curr.timestamp,
      category: 'REDE/TRANSPORTE',
      severity: currRtt >= 300 ? 'atenção' : 'info',
      message: 'Alteração importante de RTT.',
      data: { antes: num(prevRtt, 0), agora: num(currRtt, 0) },
    });
  }

  const prevDropped = prev.playback?.droppedFps ?? prev.inbound?.droppedFps ?? null;
  const currDropped = curr.playback?.droppedFps ?? curr.inbound?.droppedFps ?? null;
  if (currDropped !== null && currDropped >= 3 && (prevDropped === null || prevDropped < 1)) {
    events.push({
      timestamp: curr.timestamp,
      category: curr.playback?.droppedFps != null && currDropped === curr.playback.droppedFps ? 'REPRODUÇÃO' : 'DECODIFICAÇÃO',
      severity: 'atenção',
      message: 'Aumento de frames descartados.',
      data: { agora: num(currDropped) },
    });
  }

  const freezeNow = (curr.playback?.freezeSuspected && !curr.playback.paused) || (curr.inbound?.freezes ?? 0) > 0;
  const freezeBefore = (prev.playback?.freezeSuspected && !prev.playback.paused) || (prev.inbound?.freezes ?? 0) > 0;
  if (freezeNow && !freezeBefore) {
    events.push({
      timestamp: curr.timestamp,
      category: 'REPRODUÇÃO',
      severity: 'crítico',
      message: 'Congelamento detectado.',
      data: {
        freezes: curr.inbound?.freezes ?? null,
        intervalos: curr.playback?.irregularIntervals ?? null,
      },
    });
  }

  const routeChanged = prev.network.route !== curr.network.route && curr.network.route !== 'unknown';
  const pairChanged = prev.network.selectedPairId !== null
    && curr.network.selectedPairId !== null
    && prev.network.selectedPairId !== curr.network.selectedPairId;
  if (routeChanged || pairChanged) {
    events.push({
      timestamp: curr.timestamp,
      category: 'REDE/TRANSPORTE',
      severity: 'info',
      message: 'Alteração de rota ICE.',
      data: {
        rota: curr.network.route,
        local: curr.network.localCandidateType,
        remoto: curr.network.remoteCandidateType,
        protocolo: curr.network.protocol,
      },
    });
  }

  const down = new Set(['disconnected', 'failed', 'closed']);
  if (prev.connectionState && curr.connectionState === 'connected' && down.has(prev.connectionState)) {
    events.push({
      timestamp: curr.timestamp,
      category: 'SISTEMA',
      severity: 'info',
      message: 'Reconexão.',
      data: { antes: prev.connectionState, agora: curr.connectionState },
    });
  } else if (prev.connectionState === 'connected' && curr.connectionState && down.has(curr.connectionState)) {
    events.push({
      timestamp: curr.timestamp,
      category: 'SISTEMA',
      severity: curr.connectionState === 'failed' ? 'crítico' : 'atenção',
      message: 'A conexão mudou de estado.',
      data: { antes: prev.connectionState, agora: curr.connectionState },
    });
  }

  return events;
}

const SEVERITY_RANK: Record<EventSeverity, number> = { info: 0, 'atenção': 1, 'crítico': 2 };

export function shouldEmit(
  lastAt: number | undefined,
  now: number,
  severity: EventSeverity,
  previousSeverity: EventSeverity | undefined,
  cooldownMs = 10_000,
): boolean {
  if (lastAt === undefined) return true;
  if (now - lastAt >= cooldownMs) return true;
  if (previousSeverity && SEVERITY_RANK[severity] > SEVERITY_RANK[previousSeverity]) return true;
  return false;
}
