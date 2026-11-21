import { median, roundTo } from './math.ts';
import type {
  Diagnosis,
  DiagnosisConfidence,
  DiagnosisState,
  MetricSample,
} from './types.ts';

function pick(samples: MetricSample[], fn: (sample: MetricSample) => number | null | undefined): number[] {
  const values: number[] = [];
  for (const sample of samples) {
    const value = fn(sample);
    if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
  }
  return values;
}

function nums(sample: MetricSample, fn: (sample: MetricSample) => number | null | undefined): number | null {
  const value = fn(sample);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface Drop {
  dropped: boolean;
  severe: boolean;
  current: number | null;
  reference: number | null;
}

function sustainedDrop(
  recent: MetricSample[],
  baseline: MetricSample[],
  fn: (sample: MetricSample) => number | null | undefined,
  configured: number | null,
): Drop {
  const recentValues = pick(recent, fn);
  const baseValues = pick(baseline, fn);
  const current = recentValues.length >= 2 ? recentValues.reduce((a, b) => a + b, 0) / recentValues.length : null;
  const baselineMedian = baseValues.length >= 3 ? median(baseValues) : null;
  const reference = baselineMedian !== null && baselineMedian >= 5
    ? baselineMedian
    : (configured !== null && configured >= 5 ? configured : null);
  if (current === null || reference === null || recentValues.length < 2) {
    return { dropped: false, severe: false, current, reference };
  }
  const severeCut = reference * 0.5;
  const dropCut = reference * 0.7;
  const dropped = recentValues.every((value) => value < dropCut);
  const severe = dropped && recentValues.every((value) => value === 0 || value < severeCut);
  return { dropped, severe, current, reference };
}

function everyAbove(samples: MetricSample[], fn: (sample: MetricSample) => number | null | undefined, threshold: number): boolean {
  const values = pick(samples, fn);
  return values.length >= 2 && values.every((value) => value > threshold);
}

function evidence(pairs: [string, number | string | null, string? ][]): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const [name, value, unit] of pairs) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'number') {
      const shown = Number.isInteger(value) ? String(value) : String(roundTo(value, 1));
      out.push({ name, value: unit ? `${shown} ${unit}` : shown });
    } else {
      out.push({ name, value });
    }
  }
  return out;
}

function make(
  sample: MetricSample,
  category: Diagnosis['category'],
  state: DiagnosisState,
  confidence: DiagnosisConfidence,
  reason: string,
  items: [string, number | string | null, string?][],
): Diagnosis {
  return {
    category,
    state,
    confidence,
    reason,
    evidence: evidence(items),
    timestamp: sample.timestamp,
  };
}

function insufficient(sample: MetricSample, reason: string): Diagnosis {
  return make(sample, 'NENHUMA', 'INDETERMINADO', 'baixo', reason, []);
}

function encodedFps(sample: MetricSample): number | null {
  if (!sample.outbound) return null;
  return sample.outbound.encodedFps ?? sample.outbound.reportedFps;
}

function sourceFps(sample: MetricSample): number | null {
  return sample.outbound?.sourceFps ?? null;
}

function receivedFps(sample: MetricSample): number | null {
  return sample.inbound?.receivedFps ?? null;
}

function decodedFps(sample: MetricSample): number | null {
  if (!sample.inbound) return null;
  return sample.inbound.decodedFps ?? sample.inbound.reportedFps;
}

function presentedFps(sample: MetricSample): number | null {
  if (!sample.playback || sample.playback.api === 'none') return null;
  return sample.playback.presentedFps;
}

function viewerOf(sample: MetricSample): number | null {
  return sample.viewerCount;
}

function viewersIncreased(baseline: MetricSample[], recent: MetricSample[]): boolean {
  const base = pick(baseline, viewerOf);
  const now = pick(recent, viewerOf);
  if (base.length < 3 || now.length < 2) return false;
  const before = median(base);
  const current = Math.min(...now);
  if (before === null) return false;
  return current >= 2 && current >= before + 1;
}

function limitation(recent: MetricSample[]): string | null {
  const reasons = recent
    .map((sample) => sample.outbound?.qualityLimitationReason ?? null)
    .filter((reason): reason is string => !!reason && reason !== 'none');
  if (reasons.length < 2) return null;
  return reasons[reasons.length - 1];
}

function hasRtp(samples: MetricSample[]): boolean {
  return samples.some((sample) => sample.outbound !== null || sample.inbound !== null);
}

function severity(drop: Drop, extraCritical: boolean): DiagnosisState {
  if (drop.severe || extraCritical) return 'CRÍTICO';
  return 'ATENÇÃO';
}

function classifySender(recent: MetricSample[], baseline: MetricSample[], last: MetricSample): Diagnosis {
  if (!recent.some((sample) => sample.outbound)) {
    return insufficient(last, 'Esta extremidade não tem relatório outbound-rtp de vídeo. Sem isso não dá para avaliar captura nem codificação.');
  }
  const baseReady = baseline.length >= 3;
  const enc = sustainedDrop(recent, baseline, encodedFps, last.configuredFps);
  const src = sustainedDrop(recent, baseline, sourceFps, last.configuredFps);
  const limit = limitation(recent);
  const scale = baseReady && viewersIncreased(baseline, recent) && (enc.dropped || limit === 'cpu' || limit === 'bandwidth');

  const common: [string, number | string | null, string?][] = [
    ['FPS codificado', enc.current, 'fps'],
    ['FPS da origem', src.current, 'fps'],
    ['referência', enc.reference ?? src.reference, 'fps'],
    ['limitação do encoder', limit],
    ['espectadores', last.viewerCount],
    ['bitrate enviado', last.outbound?.bitrate ?? null, 'bps'],
  ];

  if (!baseReady && limit !== 'bandwidth' && limit !== 'cpu') {
    return insufficient(last, 'Ainda não há baseline suficiente (cerca de 6 segundos) para comparar a codificação.');
  }

  if (scale && (enc.dropped || limit === 'cpu' || limit === 'bandwidth')) {
    return make(
      last,
      'ESCALA',
      enc.severe ? 'CRÍTICO' : 'ATENÇÃO',
      'médio',
      'A piora coincidiu com o aumento de espectadores. Isso pode ser limite de envio para várias conexões; não prova a causa sozinho.',
      common,
    );
  }

  if (baseReady && src.dropped && enc.dropped) {
    return make(
      last,
      'CAPTURA/CODIFICAÇÃO',
      severity(enc, src.severe),
      'alto',
      'O FPS da origem e o FPS codificado caíram juntos. A indicação é captura ou codificação, não a rede de quem assiste.',
      common,
    );
  }

  if (limit === 'bandwidth') {
    return make(
      last,
      'REDE/TRANSPORTE',
      enc.dropped ? severity(enc, false) : 'ATENÇÃO',
      enc.dropped ? 'alto' : 'médio',
      'O encoder reportou limitação de banda. O FPS pode cair ou a resolução pode ser reduzida para caber no envio.',
      common,
    );
  }

  if (limit === 'cpu') {
    return make(
      last,
      'CAPTURA/CODIFICAÇÃO',
      enc.severe ? 'CRÍTICO' : 'ATENÇÃO',
      'alto',
      'O encoder reportou limitação de CPU. A produção de frames está sendo contida neste aparelho.',
      common,
    );
  }

  if (baseReady && enc.dropped && src.current !== null && !src.dropped) {
    return make(
      last,
      'CAPTURA/CODIFICAÇÃO',
      severity(enc, false),
      'médio',
      'A origem manteve os frames, mas a codificação caiu. A indicação é o encoder, não a captura da tela.',
      common,
    );
  }

  if (baseReady && enc.dropped && src.current === null) {
    return make(
      last,
      'CAPTURA/CODIFICAÇÃO',
      severity(enc, false),
      'baixo',
      'O FPS codificado caiu. O FPS da origem não está disponível, então captura e encoder não podem ser separados.',
      common,
    );
  }

  const nackValues = pick(recent, (sample) => sample.outbound?.nackPerSec);
  const nack = nackValues.length ? nackValues.reduce((a, b) => a + b, 0) / nackValues.length : 0;
  const rttHigh = everyAbove(recent, (sample) => sample.network.rttMs, 300);
  const remoteLoss = everyAbove(recent, (sample) => sample.remoteInbound?.lossPct, 5);
  if ((Number.isFinite(nack) && nack > 10 && rttHigh) || remoteLoss) {
    return make(
      last,
      'REDE/TRANSPORTE',
      'ATENÇÃO',
      'médio',
      'Há sinais de transporte (NACK, RTT ou perda reportada via RTCP) sem uma queda clara isolada na origem.',
      [
        ...common,
        ['NACK/s', Number.isFinite(nack) ? nack : null],
        ['RTT', last.network.rttMs, 'ms'],
        ['perda RTCP', last.remoteInbound?.lossPct ?? null, '%'],
      ],
    );
  }

  return make(
    last,
    'NENHUMA',
    'NORMAL',
    'médio',
    'Nenhuma camada local de captura ou codificação apresenta degradação sustentada.',
    common,
  );
}

function classifyReceiver(recent: MetricSample[], baseline: MetricSample[], last: MetricSample): Diagnosis {
  const rtp = hasRtp(recent);
  const playbackSamples = recent.filter((sample) => sample.playback && sample.playback.api !== 'none');
  const paused = playbackSamples.length > 0 && playbackSamples.every((sample) => sample.playback?.paused);

  if (!rtp && playbackSamples.length === 0) {
    return insufficient(last, 'Não há estatísticas WebRTC nem amostragem de apresentação neste intervalo.');
  }

  if (paused && !rtp) {
    return insufficient(last, 'A reprodução está pausada. FPS apresentado zero, nesse caso, não indica falha da transmissão.');
  }

  const baseReady = baseline.length >= 3;
  const recv = sustainedDrop(recent, baseline, receivedFps, null);
  const dec = sustainedDrop(recent, baseline, decodedFps, null);
  const presented = sustainedDrop(recent, baseline, presentedFps, null);
  const lossValues = pick(recent, (sample) => sample.inbound?.lossPct);
  const lossAvg = lossValues.length >= 2 ? lossValues.reduce((a, b) => a + b, 0) / lossValues.length : null;
  const jitterHigh = everyAbove(recent, (sample) => sample.inbound?.jitterMs, 80);
  const rttHigh = everyAbove(recent, (sample) => sample.network.rttMs, 250);
  const lossHigh = lossAvg !== null && lossAvg > 2;
  const lossCritical = lossAvg !== null && lossAvg > 8;
  const networkBad = lossHigh || jitterHigh || rttHigh;

  const decodeMsValues = pick(recent, (sample) => sample.inbound?.decodeTimePerFrameMs);
  const decodeMs = decodeMsValues.length >= 2 ? decodeMsValues.reduce((a, b) => a + b, 0) / decodeMsValues.length : null;
  const baseDecode = median(pick(baseline, (sample) => sample.inbound?.decodeTimePerFrameMs));
  const decodeSlow = decodeMs !== null && baseDecode !== null && baseDecode > 0 && decodeMs >= 20 && decodeMs > baseDecode * 1.8;

  const recvCurrent = recv.current;
  const decCurrent = dec.current;
  const recvStable = recvCurrent !== null && !recv.dropped && (recv.reference === null || recvCurrent >= (recv.reference * 0.8));
  const decStable = decCurrent !== null && !dec.dropped && decCurrent >= 5;
  const decodeGap = recvCurrent !== null && decCurrent !== null && recvCurrent >= 8 && decCurrent < recvCurrent * 0.75;

  const droppedPlay = pick(recent, (sample) => sample.playback?.droppedFps);
  const droppedAvg = droppedPlay.length ? droppedPlay.reduce((a, b) => a + b, 0) / droppedPlay.length : null;
  const freeze = recent.some((sample) => sample.playback?.freezeSuspected && !sample.playback.paused)
    || recent.some((sample) => (sample.inbound?.freezes ?? 0) > 0);
  const presentCurrent = presented.current;
  const presentGap = decStable && presentCurrent !== null && presentCurrent < decCurrent! * 0.75;
  const presentZero = decStable && presentCurrent === 0;

  const items: [string, number | string | null, string?][] = [
    ['FPS recebido', recvCurrent, 'fps'],
    ['FPS decodificado', decCurrent, 'fps'],
    ['Callbacks do compositor', presentCurrent, 'fps'],
    ['visibilidade', last.playback?.visibilityState ?? null],
    ['foco', last.playback?.hasFocus === null || last.playback?.hasFocus === undefined ? null : last.playback.hasFocus ? 'sim' : 'não'],
    ['situação da reprodução', last.playback?.stall ?? null],
    ['perda', lossAvg, '%'],
    ['jitter', last.inbound?.jitterMs ?? null, 'ms'],
    ['RTT', last.network.rttMs, 'ms'],
    ['decode', decodeMs, 'ms/frame'],
    ['descartes de apresentação', droppedAvg, 'fps'],
  ];

  if (!rtp && playbackSamples.length && !paused && presented.dropped) {
    return make(
      last,
      'REPRODUÇÃO',
      presented.severe || presentCurrent === 0 ? 'CRÍTICO' : 'ATENÇÃO',
      'baixo',
      'A apresentação caiu, mas não há estatísticas WebRTC para comparar com a decodificação.',
      items,
    );
  }

  if (!baseReady && !lossCritical && !jitterHigh && !(rtp && recvCurrent === 0 && last.connectionState === 'connected' && (last.configuredFps ?? 0) >= 5)) {
    return insufficient(last, 'Ainda não há baseline suficiente para separar rede, recepção, decodificação e reprodução.');
  }

  if (rtp && (recv.dropped || recvCurrent === 0) && networkBad) {
    return make(
      last,
      'REDE/TRANSPORTE',
      lossCritical || recv.severe || recvCurrent === 0 ? 'CRÍTICO' : 'ATENÇÃO',
      lossHigh && recv.dropped ? 'alto' : 'médio',
      'A perda, o jitter ou o RTT subiram junto com a piora no recebimento dos frames. A indicação é rede ou transporte WebRTC.',
      items,
    );
  }

  if (rtp && (lossCritical || (lossHigh && (jitterHigh || rttHigh)))) {
    return make(
      last,
      'REDE/TRANSPORTE',
      lossCritical ? 'CRÍTICO' : 'ATENÇÃO',
      'alto',
      'A perda de pacotes está alta. Os frames ainda podem aparecer por um tempo, mas o transporte está degradado.',
      items,
    );
  }

  if (jitterHigh && rtp) {
    return make(
      last,
      'REDE/TRANSPORTE',
      'ATENÇÃO',
      recv.dropped ? 'médio' : 'médio',
      'Jitter elevado de forma sustentada. Os frames podem continuar chegando, mas a rede está instável.',
      items,
    );
  }

  if (rtp && baseReady && (recv.dropped || recvCurrent === 0) && !networkBad) {
    return make(
      last,
      'RECEPÇÃO',
      recv.severe || recvCurrent === 0 ? 'CRÍTICO' : 'ATENÇÃO',
      'médio',
      'Os frames recebidos caíram sem aumento correspondente de perda, jitter ou RTT. A causa pode estar em quem transmite; este navegador não vê o outbound de lá.',
      items,
    );
  }

  if (rtp && recvStable && (decodeGap || decodeSlow)) {
    const fpsBroken = decodeGap || dec.dropped;
    return make(
      last,
      'DECODIFICAÇÃO',
      fpsBroken && (dec.severe || decodeGap) ? 'CRÍTICO' : 'ATENÇÃO',
      fpsBroken ? 'alto' : 'médio',
      fpsBroken
        ? 'Os frames recebidos seguem à frente da decodificação. A indicação é o decoder, não a rede.'
        : 'O tempo de decodificação por frame aumentou com a recepção ainda estável. O decoder pode estar no limite.',
      items,
    );
  }

  const hiddenTab = last.playback?.visibilityState === 'hidden'
    || (playbackSamples.length > 0 && playbackSamples.every((sample) => sample.playback?.visibilityState === 'hidden'));
  if (hiddenTab && !networkBad && !(rtp && recv.dropped)) {
    return make(
      last,
      'NENHUMA',
      'INDETERMINADO',
      'baixo',
      'A aba do espectador está oculta. O navegador pode reduzir os callbacks do compositor; isso não é congelamento da transmissão.',
      items,
    );
  }

  if (!paused && ((presentGap || presentZero) || (decStable && ((droppedAvg !== null && droppedAvg >= 3) || freeze)))) {
    return make(
      last,
      'REPRODUÇÃO',
      presentZero || presented.severe || (presentCurrent !== null && decCurrent !== null && presentCurrent < decCurrent * 0.5) ? 'CRÍTICO' : 'ATENÇÃO',
      decStable ? 'alto' : 'baixo',
      'A decodificação se manteve, mas os callbacks do compositor ficaram atrás ou o elemento passou a descartar quadros. Callback não prova que o quadro foi pintado.',
      items,
    );
  }

  if (!rtp && playbackSamples.length) {
    return insufficient(last, 'Há FPS apresentado, mas não há estatísticas WebRTC para avaliar as outras camadas.');
  }

  if (!rtp) return insufficient(last, 'Sem relatório inbound-rtp de vídeo nesta extremidade.');

  return make(
    last,
    'NENHUMA',
    'NORMAL',
    baseReady ? 'médio' : 'baixo',
    'Nenhuma camada local apresenta degradação sustentada nas últimas amostras.',
    items,
  );
}

export function classifyDiagnosis(samples: MetricSample[]): Diagnosis {
  const last = samples[samples.length - 1];
  if (!last || samples.length < 3) {
    const stamp = last?.timestamp ?? Date.now();
    return {
      category: 'NENHUMA',
      state: 'INDETERMINADO',
      confidence: 'baixo',
      reason: 'Ainda não há amostras suficientes (mínimo de 3 segundos).',
      evidence: [],
      timestamp: stamp,
    };
  }
  const recent = samples.slice(-3);
  const baseline = samples.slice(0, -3);
  if (last.role === 'sender') return classifySender(recent, baseline, last);
  return classifyReceiver(recent, baseline, last);
}

export function diagnosisSummary(diagnosis: Diagnosis): string {
  if (diagnosis.state === 'INDETERMINADO') return 'Dados insuficientes para diagnóstico';
  if (diagnosis.state === 'NORMAL') return 'Transmissão normal';
  switch (diagnosis.category) {
    case 'REDE/TRANSPORTE':
      return 'Possível problema de rede';
    case 'DECODIFICAÇÃO':
      return 'Possível problema de decodificação';
    case 'REPRODUÇÃO':
      return 'Possível problema de reprodução';
    case 'CAPTURA/CODIFICAÇÃO':
      return 'Possível problema de captura/codificação';
    case 'RECEPÇÃO':
      return 'Possível problema de recepção';
    case 'ESCALA':
      return 'Possível limitação pelo número de espectadores';
    default:
      return 'Dados insuficientes para diagnóstico';
  }
}
