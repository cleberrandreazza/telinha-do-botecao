import { classifyAudio } from './audio.ts';
import type {
  AudioDiagnosis,
  AudioFacts,
  DiagEvent,
  Diagnosis,
  MetricSample,
  PlaybackSample,
  StreamConfigSnapshot,
} from './types.ts';

export interface BrowserInfo {
  userAgent: string;
  name: string;
  version: string | null;
}

export interface DiagnosticReport {
  sessionId: string;
  connectionId: string;
  role: 'sender' | 'receiver';
  browser: BrowserInfo;
  streamConfig: StreamConfigSnapshot | null;
  viewerCount: number | null;
  collectedFrom: number;
  collectedTo: number;
  history: MetricSample[];
  playback: PlaybackSample[];
  events: DiagEvent[];
  diagnoses: Diagnosis[];
  audio: AudioFacts | null;
  audioDiagnosis: AudioDiagnosis | null;
  ice: {
    route: string;
    localCandidateType: string | null;
    remoteCandidateType: string | null;
    protocol: string | null;
    rttMs: number | null;
    selection: string;
  } | null;
  limitations: string[];
}

const BANNED_KEY = /^(ip|address|ipaddress|relatedaddress|candidate|url|username|credential|password|token|authorization|cookie|cpf|nickname|sdp|peerid)$/i;
const KEEP_IP_LOOKING = /^(version|useragent|name|reason|message|value|codec|protocol|route|selection|state|category|severity|label|id)$/i;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

export function parseBrowser(userAgent: string): BrowserInfo {
  const edge = userAgent.match(/Edg\/([\d.]+)/);
  const chrome = userAgent.match(/Chrome\/([\d.]+)/);
  const firefox = userAgent.match(/Firefox\/([\d.]+)/);
  const safari = userAgent.match(/Version\/([\d.]+).+Safari/);
  if (edge) return { userAgent, name: 'Edge', version: edge[1] };
  if (chrome) return { userAgent, name: 'Chrome', version: chrome[1] };
  if (firefox) return { userAgent, name: 'Firefox', version: firefox[1] };
  if (safari) return { userAgent, name: 'Safari', version: safari[1] };
  return { userAgent, name: userAgent ? 'desconhecido' : 'indisponível', version: null };
}

export function currentBrowser(): BrowserInfo {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return parseBrowser(ua);
}

export function sanitize<T>(value: T): T {
  return sanitizeValue(value) as T;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (BANNED_KEY.test(key)) continue;
      if (typeof inner === 'string' && !KEEP_IP_LOOKING.test(key) && (IPV4.test(inner) || (inner.includes(':') && IPV6.test(inner) && inner.length > 2))) {
        continue;
      }
      out[key] = sanitizeValue(inner);
    }
    return out;
  }
  return value;
}

export function buildReport(input: {
  sessionId: string;
  collectedFrom: number;
  streamConfig: StreamConfigSnapshot | null;
  history: MetricSample[];
  playback: PlaybackSample[];
  events: DiagEvent[];
  diagnoses: Diagnosis[];
  browser?: BrowserInfo;
}): DiagnosticReport {
  const latest = input.history[input.history.length - 1] ?? null;
  const report: DiagnosticReport = {
    sessionId: input.sessionId,
    connectionId: latest?.connectionId ?? 'sem-conexao',
    role: latest?.role ?? 'receiver',
    browser: input.browser ?? currentBrowser(),
    streamConfig: input.streamConfig,
    viewerCount: latest?.viewerCount ?? null,
    collectedFrom: input.collectedFrom,
    collectedTo: latest?.timestamp ?? Date.now(),
    history: input.history,
    playback: input.playback,
    events: input.events,
    diagnoses: input.diagnoses,
    audio: latest?.audio ?? null,
    audioDiagnosis: latest?.audio ? classifyAudio(latest.audio, latest.timestamp) : null,
    ice: latest ? {
      route: latest.network.route,
      localCandidateType: latest.network.localCandidateType,
      remoteCandidateType: latest.network.remoteCandidateType,
      protocol: latest.network.protocol,
      rttMs: latest.network.rttMs,
      selection: latest.network.selection,
    } : null,
    limitations: [
      'Medições apenas desta extremidade. O receptor não recebe o outbound de quem transmite.',
      'RTT ausente significa que o par ICE selecionado não foi identificado, não que o RTT seja zero.',
      'FPS zero é medição real. FPS solicitado não substitui FPS medido.',
      'Endereços IP, credenciais e conteúdo da tela não fazem parte deste arquivo.',
      'Áudio funcionando exige pacotes em movimento e, no receptor, o elemento desmutado. A existência de um relatório RTP não basta.',
    ],
  };
  return sanitize(report);
}

export function triggerJsonDownload(filename: string, data: unknown) {
  const json = JSON.stringify(sanitize(data), null, 2);
  if (typeof document === 'undefined') return json;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return json;
}

export function reportFilename(role: string, connectionId: string, when = new Date()): string {
  const stamp = when.toISOString().replace(/[:.]/g, '-');
  const shortId = connectionId.slice(0, 8) || 'conn';
  return `telinha-diagnostico-${role}-${shortId}-${stamp}.json`;
}
