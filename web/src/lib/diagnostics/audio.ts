import type {
  AudioCaptureObservation,
  AudioCode,
  AudioDiagnosis,
  AudioFacts,
  AudioFormatFields,
  AudioPlaybackReport,
  AudioRtp,
  AudioSdpInfo,
  EndpointRole,
  OpusFmtp,
} from './types.ts';

export type { AudioSdpInfo } from './types.ts';

export type AudioMode = 'off' | 'source' | 'system';

export interface AudioCaptureContext {
  requested: boolean;
  audioMode: AudioMode | null;
  trackCount: number;
  returnedTracks: number | null;
  readyState: string | null;
  enabled: boolean | null;
  muted: boolean | null;
  displaySurface: string | null;
  policy: string | null;
  discardReason: string | null;
  /** Leitura única de getSettings, getConstraints e getCapabilities no momento da captura. */
  format?: AudioCaptureObservation | null;
}

export interface AudioLinkContext {
  senderAttached: boolean;
  negotiated: boolean | null;
  direction: string | null;
  local?: AudioSdpInfo | null;
  remote?: AudioSdpInfo | null;
}

export interface AudioInspectTrack {
  getSettings?: () => unknown;
  getConstraints?: () => unknown;
  getCapabilities?: () => unknown;
}

const FMTP_FIELD: Record<string, keyof OpusFmtp> = {
  stereo: 'stereo',
  'sprop-stereo': 'spropStereo',
  maxaveragebitrate: 'maxaveragebitrate',
  maxplaybackrate: 'maxplaybackrate',
  'sprop-maxcapturerate': 'spropMaxcapturerate',
  useinbandfec: 'useinbandfec',
  usedtx: 'usedtx',
  ptime: 'ptime',
  maxptime: 'maxptime',
};

export function emptyOpusFmtp(): OpusFmtp {
  return {
    stereo: null,
    spropStereo: null,
    maxaveragebitrate: null,
    maxplaybackrate: null,
    spropMaxcapturerate: null,
    useinbandfec: null,
    usedtx: null,
    ptime: null,
    maxptime: null,
  };
}

/** Só os parâmetros Opus conhecidos. O restante da linha, inclusive o SDP, é descartado. */
export function parseOpusFmtp(line: string | null | undefined): OpusFmtp {
  const out = emptyOpusFmtp();
  if (!line) return out;
  let body = line.trim();
  const prefixed = body.toLowerCase().startsWith('a=fmtp:');
  if (prefixed) {
    const space = body.indexOf(' ');
    body = space === -1 ? '' : body.slice(space + 1);
  }
  for (const part of body.split(';')) {
    const item = part.trim();
    if (!item) continue;
    const eq = item.indexOf('=');
    if (eq <= 0) continue;
    const field = FMTP_FIELD[item.slice(0, eq).trim().toLowerCase()];
    const value = item.slice(eq + 1).trim();
    if (!field || value.length === 0) continue;
    out[field] = value;
  }
  return out;
}

function emptyAudioSdp(): AudioSdpInfo {
  return {
    present: false,
    rejected: false,
    direction: null,
    codecs: [],
    codec: null,
    payloadType: null,
    clockRate: null,
    channels: null,
    fmtp: emptyOpusFmtp(),
  };
}

function emptyAudioFormat(): AudioFormatFields {
  return {
    sampleRate: null,
    sampleSize: null,
    channelCount: null,
    latency: null,
    echoCancellation: null,
    noiseSuppression: null,
    autoGainControl: null,
    suppressLocalAudioPlayback: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function callRecord(fn: (() => unknown) | undefined): { called: boolean; record: Record<string, unknown> | null } {
  if (typeof fn !== 'function') return { called: false, record: null };
  try {
    return { called: true, record: asRecord(fn()) };
  } catch {
    return { called: true, record: null };
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function settingNumber(record: Record<string, unknown> | null, key: string): number | null {
  if (!record || !(key in record)) return null;
  return finiteNumber(record[key]);
}

function settingBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  if (!record || !(key in record)) return null;
  return typeof record[key] === 'boolean' ? record[key] : null;
}

function requestedNumber(record: Record<string, unknown> | null, key: string): number | null {
  if (!record || !(key in record)) return null;
  const value = record[key];
  const bare = finiteNumber(value);
  if (bare !== null) return bare;
  const obj = asRecord(value);
  if (!obj) return null;
  const exact = finiteNumber(obj.exact);
  if (exact !== null) return exact;
  return finiteNumber(obj.ideal);
}

function requestedBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  if (!record || !(key in record)) return null;
  const value = record[key];
  if (typeof value === 'boolean') return value;
  const obj = asRecord(value);
  if (!obj) return null;
  if (typeof obj.exact === 'boolean') return obj.exact;
  if (typeof obj.ideal === 'boolean') return obj.ideal;
  return null;
}

/** Faixa numérica só vira um número quando min e max são o mesmo valor. */
function capabilityNumber(record: Record<string, unknown> | null, key: string): number | null {
  if (!record || !(key in record)) return null;
  const value = record[key];
  const bare = finiteNumber(value);
  if (bare !== null) return bare;
  const obj = asRecord(value);
  if (!obj) return null;
  const min = finiteNumber(obj.min);
  const max = finiteNumber(obj.max);
  if (min !== null && max !== null && min === max) return min;
  return null;
}

function capabilityBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  if (!record || !(key in record)) return null;
  return typeof record[key] === 'boolean' ? record[key] : null;
}

function readFormat(record: Record<string, unknown> | null, mode: 'settings' | 'constraints' | 'capabilities'): AudioFormatFields {
  const numberOf = mode === 'settings' ? settingNumber : mode === 'constraints' ? requestedNumber : capabilityNumber;
  const booleanOf = mode === 'settings' ? settingBoolean : mode === 'constraints' ? requestedBoolean : capabilityBoolean;
  return {
    sampleRate: numberOf(record, 'sampleRate'),
    sampleSize: numberOf(record, 'sampleSize'),
    channelCount: numberOf(record, 'channelCount'),
    latency: numberOf(record, 'latency'),
    echoCancellation: booleanOf(record, 'echoCancellation'),
    noiseSuppression: booleanOf(record, 'noiseSuppression'),
    autoGainControl: booleanOf(record, 'autoGainControl'),
    suppressLocalAudioPlayback: booleanOf(record, 'suppressLocalAudioPlayback'),
  };
}

/**
 * Lê a track autorizada sem inventar campo ausente.
 * getCapabilities inexistente deixa `capabilities` null. Um método que existe e não devolve campos deixa os campos null.
 */
export function readAudioCapture(
  track: AudioInspectTrack | null | undefined,
  surfaceSettings?: Record<string, unknown> | null,
): AudioCaptureObservation | null {
  if (!track) return null;
  const settingsCall = callRecord(track.getSettings);
  const constraintsCall = callRecord(track.getConstraints);
  const capabilitiesCall = callRecord(track.getCapabilities);
  let surface: boolean | null = null;
  if (surfaceSettings && typeof surfaceSettings === 'object' && 'suppressLocalAudioPlayback' in surfaceSettings) {
    const value = surfaceSettings.suppressLocalAudioPlayback;
    surface = typeof value === 'boolean' ? value : null;
  }
  return {
    settings: settingsCall.called ? readFormat(settingsCall.record, 'settings') : emptyAudioFormat(),
    constraints: constraintsCall.called ? readFormat(constraintsCall.record, 'constraints') : null,
    capabilities: capabilitiesCall.called ? readFormat(capabilitiesCall.record, 'capabilities') : null,
    surfaceSuppressLocalAudioPlayback: surface,
  };
}

const DIRECTION = /^(sendrecv|sendonly|recvonly|inactive)$/;

/**
 * Lê a seção de áudio do SDP já negociado. Não altera o SDP e não o devolve.
 * Porta 0 significa que a seção foi rejeitada. `opus/48000` sem o terceiro número deixa canais null.
 */
export function inspectAudioSdp(sdp: string | null | undefined): AudioSdpInfo {
  if (!sdp) return emptyAudioSdp();
  const lines = sdp.replace(/\r\n/g, '\n').split('\n');
  let inAudio = false;
  let present = false;
  let rejected = false;
  let direction: AudioSdpInfo['direction'] = null;
  const payloads: string[] = [];
  const codecs: string[] = [];
  const maps: { payload: string; name: string; clockRate: number | null; channels: number | null }[] = [];
  const fmtpByPayload = new Map<string, OpusFmtp>();
  let ptime: string | null = null;
  let maxptime: string | null = null;
  for (const line of lines) {
    if (line.startsWith('m=')) {
      if (inAudio) break;
      inAudio = line.startsWith('m=audio');
      if (!inAudio) continue;
      present = true;
      const parts = line.split(' ');
      rejected = parts[1] === '0';
      payloads.splice(0, payloads.length, ...parts.slice(3));
      continue;
    }
    if (!inAudio) continue;
    const rtpmap = line.match(/^a=rtpmap:(\d+)\s+([^/\s]+)(?:\/(\d+))?(?:\/(\d+))?/);
    if (rtpmap && payloads.includes(rtpmap[1])) {
      codecs.push(rtpmap[2]);
      maps.push({
        payload: rtpmap[1],
        name: rtpmap[2],
        clockRate: rtpmap[3] !== undefined ? Number(rtpmap[3]) : null,
        channels: rtpmap[4] !== undefined ? Number(rtpmap[4]) : null,
      });
    }
    const fmtp = line.match(/^a=fmtp:(\d+)\s+(.+)$/);
    if (fmtp && payloads.includes(fmtp[1])) fmtpByPayload.set(fmtp[1], parseOpusFmtp(fmtp[2]));
    const dir = line.match(/^a=(sendrecv|sendonly|recvonly|inactive)$/);
    if (dir && DIRECTION.test(dir[1])) direction = dir[1] as AudioSdpInfo['direction'];
    const pt = line.match(/^a=ptime:(\d+(?:\.\d+)?)$/);
    if (pt) ptime = pt[1];
    const mpt = line.match(/^a=maxptime:(\d+(?:\.\d+)?)$/);
    if (mpt) maxptime = mpt[1];
  }
  if (present && !direction) direction = 'sendrecv';
  const chosen = maps.find((item) => item.name.toLowerCase() === 'opus') ?? maps[0] ?? null;
  const fmtp = chosen ? { ...(fmtpByPayload.get(chosen.payload) ?? emptyOpusFmtp()) } : emptyOpusFmtp();
  if (fmtp.ptime === null && ptime !== null) fmtp.ptime = ptime;
  if (fmtp.maxptime === null && maxptime !== null) fmtp.maxptime = maxptime;
  return {
    present,
    rejected,
    direction,
    codecs,
    codec: chosen ? chosen.name.toLowerCase() : null,
    payloadType: chosen?.payload ?? null,
    clockRate: chosen?.clockRate ?? null,
    channels: chosen?.channels ?? null,
    fmtp,
  };
}

export function negotiationFromSdp(localSdp: string | null | undefined, remoteSdp: string | null | undefined): {
  negotiated: boolean;
  direction: string | null;
  codecs: string[];
  local: AudioSdpInfo;
  remote: AudioSdpInfo;
} {
  const local = inspectAudioSdp(localSdp);
  const remote = inspectAudioSdp(remoteSdp);
  const negotiated = local.present && remote.present && !local.rejected && !remote.rejected;
  return {
    negotiated,
    direction: remote.direction ?? local.direction,
    codecs: remote.codecs.length > 0 ? remote.codecs : local.codecs,
    local,
    remote,
  };
}

/** Preferência antiga `shareAudio: true` vira `source`. Nunca vira `system`. */
export function migrateAudioMode(stored: { audioMode?: unknown; shareAudio?: unknown } | null | undefined): AudioMode {
  if (stored?.audioMode === 'off' || stored?.audioMode === 'source' || stored?.audioMode === 'system') {
    return stored.audioMode;
  }
  if (stored?.shareAudio === false) return 'off';
  if (stored?.shareAudio === true) return 'source';
  return 'source';
}

export function audioModeFromConfig(config: { audio?: boolean; audioMode?: AudioMode | null }): AudioMode {
  if (config.audioMode === 'off' || config.audioMode === 'source' || config.audioMode === 'system') return config.audioMode;
  if (config.audio === false) return 'off';
  return 'source';
}

/**
 * Pedido ao getDisplayMedia. Áudio continua boolean: um objeto de processamento
 * (echoCancellation etc.) faz o Chrome descartar a faixa.
 * `suppressLocalAudioPlayback` pertence a `audio` na especificação de screen capture.
 * Não pedimos essa restrição: o valor antigo no topo das opções era inválido, e
 * colocá-lo dentro de `audio` nesta etapa mudaria o que a pessoa ouve localmente.
 * `exclude` limita o escopo. `windowAudio: 'system'` não é usado.
 */
export function buildDisplayMediaOptions(
  video: Record<string, unknown>,
  mode: AudioMode,
): Record<string, unknown> {
  if (mode === 'off') return { video, audio: false };
  if (mode === 'system') {
    return { video, audio: true, systemAudio: 'include', windowAudio: 'exclude' };
  }
  return { video, audio: true, systemAudio: 'exclude', windowAudio: 'exclude' };
}

function errorName(err: unknown): string {
  return err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
}

const CANCELLED = new Set(['NotAllowedError', 'AbortError']);
const UNSUPPORTED = new Set(['TypeError', 'NotSupportedError', 'OverconstrainedError']);

export async function requestDisplayMedia<T>(
  getDisplayMedia: (options: Record<string, unknown>) => Promise<T>,
  video: Record<string, unknown>,
  mode: AudioMode,
  options: { fallbackToVideoOnly?: boolean } = {},
): Promise<{ stream: T; audioScopeFallback: boolean }> {
  const full = buildDisplayMediaOptions(video, mode);
  const capture = async (options: Record<string, unknown>): Promise<T> => {
    const stream = await getDisplayMedia(options);
    if (mode !== 'off' && stream && typeof stream === 'object' && 'getAudioTracks' in stream) {
      const tracks = (stream as T & { getAudioTracks: () => Array<{ applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void> }> }).getAudioTracks();
      await Promise.all(tracks.map(async (track) => {
        if (typeof track.applyConstraints !== 'function') return;
        try {
          await track.applyConstraints({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
        } catch {
          // Constraints opcionais não devem interromper o compartilhamento de vídeo.
        }
      }));
    }
    return stream;
  };
  try {
    return { stream: await capture(full), audioScopeFallback: false };
  } catch (err) {
    const name = errorName(err);
    if (mode === 'off' || CANCELLED.has(name) || !UNSUPPORTED.has(name)) throw err;
    // A troca de fonte precisa do erro na mão: quem chamou decide se repete
    // sem a dica de superfície em vez de cair para vídeo só.
    if (options.fallbackToVideoOnly === false) throw err;
    // Uma segunda tentativa, só vídeo. Não se tira `exclude` e se segue com áudio.
    const stream = await capture(buildDisplayMediaOptions(video, 'off'));
    return { stream, audioScopeFallback: true };
  }
}

export interface AudioScopeDecision {
  keepAudio: boolean;
  policy: string;
  message: string | null;
}

export function decideAudioScope(mode: AudioMode, surface: string): AudioScopeDecision {
  if (mode === 'off') {
    return { keepAudio: false, policy: 'off', message: disabledAudioMessage() };
  }
  if (surface !== 'browser' && surface !== 'window' && surface !== 'monitor') {
    return {
      keepAudio: false,
      policy: 'unknown-surface',
      message: 'Áudio não capturado pela superfície selecionada. A superfície não foi identificada, então nenhum áudio é transmitido.',
    };
  }
  if (mode === 'source') {
    if (surface === 'browser') return { keepAudio: true, policy: 'tab-audio', message: null };
    if (surface === 'window') {
      return {
        keepAudio: false,
        policy: 'window-no-global',
        message: 'Áudio global desabilitado para janelas. O vídeo segue, sem áudio. O navegador não entrega o som exclusivo dessa janela.',
      };
    }
    return {
      keepAudio: false,
      policy: 'source-blocks-monitor',
      message: 'Áudio não capturado pela superfície selecionada. Neste modo a tela inteira não transmite o áudio do Windows.',
    };
  }
  if (surface === 'monitor') return { keepAudio: true, policy: 'system-monitor', message: null };
  return {
    keepAudio: false,
    policy: 'system-requires-monitor',
    message: 'Áudio do Windows exige compartilhamento da tela inteira. O vídeo foi mantido e o áudio foi descartado.',
  };
}

export function policyLabel(policy: string | null): string {
  switch (policy) {
    case 'tab-audio': return 'Áudio da aba disponível.';
    case 'system-monitor': return 'Áudio do Windows na tela inteira.';
    case 'window-no-global': return 'Áudio global desabilitado para janelas.';
    case 'source-blocks-monitor': return 'Áudio não capturado pela superfície selecionada.';
    case 'system-requires-monitor': return 'Áudio do Windows exige compartilhamento da tela inteira.';
    case 'unknown-surface': return 'Áudio não capturado pela superfície selecionada.';
    case 'scope-unsupported': return 'Navegador não oferece opções suficientes para garantir o escopo solicitado.';
    case 'off': return 'Áudio desligado.';
    default: return 'n/d';
  }
}

export interface ScopeTrack {
  stop: () => void;
}

export interface ScopeStream {
  getAudioTracks: () => ScopeTrack[];
  getVideoTracks: () => { getSettings: () => { displaySurface?: string } }[];
  removeTrack: (track: ScopeTrack) => void;
}

export function readDisplaySurface(stream: ScopeStream): string {
  const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
  return surface === 'browser' || surface === 'window' || surface === 'monitor' ? surface : 'unknown';
}

export function stripDisallowedAudio(stream: ScopeStream, keepAudio: boolean): { returned: number; kept: number } {
  const tracks = [...stream.getAudioTracks()];
  if (keepAudio) return { returned: tracks.length, kept: tracks.length };
  for (const track of tracks) {
    track.stop();
    stream.removeTrack(track);
  }
  return { returned: tracks.length, kept: stream.getAudioTracks().length };
}

/**
 * Tira o áudio fora do escopo, e só então entrega o stream e anuncia a transmissão.
 * `start-sharing` não corre antes da atribuição local.
 */
export function commitPreparedShare(args: {
  stream: ScopeStream;
  mode: AudioMode;
  scopeUnsupported?: boolean;
  assignLocal: (stream: ScopeStream, prepared: PreparedShare) => void;
  startSharing: () => void;
}): PreparedShare {
  const surface = readDisplaySurface(args.stream);
  const decision = args.scopeUnsupported
    ? {
      keepAudio: false,
      policy: 'scope-unsupported',
      message: 'Navegador não oferece opções suficientes para garantir o escopo solicitado. A transmissão segue só com vídeo.',
    }
    : decideAudioScope(args.mode, surface);
  const counts = stripDisallowedAudio(args.stream, decision.keepAudio);
  let message = decision.message;
  if (decision.keepAudio && counts.kept === 0) {
    message = captureUnavailableMessage(surface === 'unknown' ? null : surface);
  }
  const prepared: PreparedShare = {
    surface,
    decision,
    returned: counts.returned,
    kept: counts.kept,
    message,
  };
  args.assignLocal(args.stream, prepared);
  args.startSharing();
  return prepared;
}

export interface PreparedShare {
  surface: string;
  decision: AudioScopeDecision;
  returned: number;
  kept: number;
  message: string | null;
}

export function captureUnavailableMessage(surface: string | null): string {
  if (surface === 'browser') {
    return 'AUDIO_CAPTURE_UNAVAILABLE. A aba veio sem áudio. No seletor do Chrome ou do Edge, marque "Compartilhar áudio da guia". Sem essa marca o navegador devolve só vídeo.';
  }
  if (surface === 'monitor') {
    return 'AUDIO_CAPTURE_UNAVAILABLE. A tela inteira veio sem áudio. Marque "Compartilhar áudio do sistema" no seletor. Isso não é microfone.';
  }
  if (surface === 'window') {
    return 'AUDIO_CAPTURE_UNAVAILABLE. Áudio global desabilitado para janelas. Chrome e Edge no Windows não entregam o áudio exclusivo de uma janela.';
  }
  return 'AUDIO_CAPTURE_UNAVAILABLE. O áudio foi pedido e o navegador devolveu zero tracks. A transmissão segue só com vídeo.';
}

export function disabledAudioMessage(): string {
  return 'Áudio desligado na configuração. Esta transmissão sai só com vídeo.';
}

export function sameTrackSet(current: string[], next: string[]): boolean {
  if (current.length !== next.length) return false;
  const pending = [...next];
  for (const id of current) {
    const index = pending.indexOf(id);
    if (index < 0) return false;
    pending.splice(index, 1);
  }
  return true;
}

/**
 * O Chromium não passa a reproduzir uma track adicionada depois que srcObject já foi atribuído.
 * Se o conjunto mudou, o elemento precisa receber um MediaStream novo com todas as tracks.
 */
export function shouldRebindSrcObject(currentIds: string[], nextIds: string[]): boolean {
  return !sameTrackSet(currentIds, nextIds);
}

export function resolvePlayback(input: {
  wantSound: boolean;
  audibleError: string | null;
  mutedError: string | null;
}): { blocked: boolean; muted: boolean; error: string | null } {
  if (!input.wantSound) {
    return { blocked: false, muted: true, error: input.mutedError };
  }
  if (!input.audibleError) return { blocked: false, muted: false, error: null };
  return {
    blocked: true,
    muted: true,
    error: input.mutedError ? `${input.audibleError} | ${input.mutedError}` : input.audibleError,
  };
}

export function attachAudio(input: {
  role: EndpointRole;
  rtp: AudioRtp | null;
  capture: AudioCaptureContext | null;
  link: AudioLinkContext | null;
  remoteAudioTracks: number | null;
  playback: AudioPlaybackReport | null;
}): AudioFacts {
  return {
    role: input.role,
    requested: input.capture?.requested ?? null,
    audioMode: input.capture?.audioMode ?? null,
    displaySurface: input.capture?.displaySurface ?? null,
    policy: input.capture?.policy ?? null,
    returnedTracks: input.capture?.returnedTracks ?? null,
    authorizedTracks: input.capture?.trackCount ?? null,
    discardReason: input.capture?.discardReason ?? null,
    capturedTracks: input.capture?.trackCount ?? null,
    trackReadyState: input.capture?.readyState ?? null,
    trackEnabled: input.capture?.enabled ?? null,
    trackMuted: input.capture?.muted ?? null,
    senderAttached: input.link?.senderAttached ?? null,
    negotiated: input.link?.negotiated ?? null,
    direction: input.link?.direction ?? null,
    remoteAudioTracks: input.remoteAudioTracks,
    packetsPerSec: input.rtp?.packetsPerSec ?? null,
    bitrate: input.rtp?.bitrate ?? null,
    samplesPerSec: input.rtp?.samplesPerSec ?? null,
    codec: input.rtp?.codec ?? null,
    playbackMuted: input.playback?.muted ?? null,
    playbackVolume: input.playback?.volume ?? null,
    playbackPaused: input.playback?.paused ?? null,
    playbackBlocked: input.playback?.blocked ?? null,
    playError: input.playback?.playError ?? null,
    elementAudioTracks: input.playback?.elementAudioTracks ?? null,
    captureFormat: input.capture?.format ?? null,
    localNegotiation: input.link?.local ?? null,
    remoteNegotiation: input.link?.remote ?? null,
    codecInfo: input.rtp?.codecInfo ?? null,
    signal: input.rtp?.signal ?? null,
    inbound: input.rtp?.inbound ?? null,
  };
}

function flowing(facts: AudioFacts): boolean | null {
  if (facts.packetsPerSec === null && facts.bitrate === null) return null;
  return (facts.packetsPerSec ?? 0) > 0 || (facts.bitrate ?? 0) > 0;
}

function diagnosis(code: AudioCode, label: string, reason: string, timestamp: number): AudioDiagnosis {
  return { code, label, reason, timestamp };
}

/**
 * Não trata a mera existência de um relatório RTP como áudio funcionando.
 * Pacotes avançando, track presente e elemento desmutado são condições distintas.
 */
export function classifyAudio(facts: AudioFacts | null, timestamp = Date.now()): AudioDiagnosis {
  if (!facts) {
    return diagnosis('INSUFFICIENT', 'ÁUDIO SEM DADOS SUFICIENTES', 'Ainda não há amostra desta conexão.', timestamp);
  }
  if (facts.role === 'sender' && facts.requested === false) {
    return diagnosis('DISABLED', 'ÁUDIO DESABILITADO', 'A configuração desta transmissão pediu para não capturar áudio.', timestamp);
  }
  if (facts.role === 'sender' && facts.requested === true && facts.capturedTracks === 0) {
    return diagnosis(
      'NOT_CAPTURED',
      'ÁUDIO NÃO CAPTURADO',
      facts.discardReason ?? captureUnavailableMessage(facts.displaySurface),
      timestamp,
    );
  }
  if (facts.role === 'sender' && facts.capturedTracks !== null && facts.capturedTracks > 0) {
    if (facts.trackReadyState === 'ended') {
      return diagnosis('CAPTURED_NOT_SENT', 'ÁUDIO CAPTURADO, MAS NÃO ENVIADO', 'A track de áudio encerrou.', timestamp);
    }
    if (facts.trackEnabled === false) {
      return diagnosis('CAPTURED_NOT_SENT', 'ÁUDIO CAPTURADO, MAS NÃO ENVIADO', 'A track de áudio está desabilitada.', timestamp);
    }
    if (facts.senderAttached === false) {
      return diagnosis('CAPTURED_NOT_SENT', 'ÁUDIO CAPTURADO, MAS NÃO ENVIADO', 'Nenhum RTCRtpSender de áudio está associado à track.', timestamp);
    }
  }
  if (facts.negotiated === false) {
    return diagnosis('NOT_NEGOTIATED', 'ÁUDIO NÃO NEGOCIADO', 'O SDP negociado não tem uma seção de áudio aceita.', timestamp);
  }
  // A direction vem do SDP remoto (negotiationFromSdp retorna remote.direction).
  // Para o sender: remote 'recvonly' = viewer aceita receber áudio (correto).
  //                remote 'sendonly' = viewer quer enviar, não receber (problema).
  // Para o receiver: remote 'sendonly' = sender envia áudio (correto).
  //                  remote 'recvonly' = sender quer receber, não enviar (problema).
  if (facts.role === 'sender' && (facts.direction === 'inactive' || facts.direction === 'sendonly')) {
    return diagnosis('NOT_NEGOTIATED', 'ÁUDIO NÃO NEGOCIADO', `A direção negociada (remota) é ${facts.direction}, que não aceita receber áudio do sender.`, timestamp);
  }
  if (facts.role === 'receiver' && (facts.direction === 'inactive' || facts.direction === 'recvonly')) {
    return diagnosis('NOT_NEGOTIATED', 'ÁUDIO NÃO NEGOCIADO', `A direção negociada (remota) é ${facts.direction}, que não envia áudio para o receiver.`, timestamp);
  }

  const flow = flowing(facts);
  if (facts.role === 'sender') {
    if (facts.capturedTracks === null && facts.senderAttached === null && flow === null) {
      return diagnosis('INSUFFICIENT', 'ÁUDIO SEM DADOS SUFICIENTES', 'A captura e o RTP de áudio ainda não foram lidos.', timestamp);
    }
    if (flow === null) {
      return diagnosis('INSUFFICIENT', 'ÁUDIO SEM DADOS SUFICIENTES', 'Ainda não há intervalo para saber se os pacotes de áudio estão saindo.', timestamp);
    }
    if (!flow) {
      const why = facts.trackMuted
        ? 'A track está muted na origem, então não há amostras saindo.'
        : 'O sender está associado, mas pacotes e bytes de áudio não aumentam.';
      return diagnosis('CAPTURED_NOT_SENT', 'ÁUDIO CAPTURADO, MAS NÃO ENVIADO', why, timestamp);
    }
    return diagnosis(
      'SENDING',
      'ÁUDIO SENDO ENVIADO',
      'Os pacotes de áudio desta conexão estão aumentando. Isso não prova que o espectador está ouvindo nem que o som chegou nítido.',
      timestamp,
    );
  }

  if (facts.remoteAudioTracks === 0 && flow !== true) {
    return diagnosis('NOT_RECEIVED', 'ÁUDIO NÃO RECEBIDO', 'O evento ontrack não entregou track de áudio nesta conexão.', timestamp);
  }
  if (flow === null) {
    return diagnosis('INSUFFICIENT', 'ÁUDIO SEM DADOS SUFICIENTES', 'A track pode existir, mas ainda não há intervalo de pacotes recebidos.', timestamp);
  }
  if (!flow) {
    return diagnosis('NOT_RECEIVED', 'ÁUDIO NÃO RECEBIDO', 'Há relatório de áudio, mas os bytes recebidos não aumentam.', timestamp);
  }
  if (facts.playbackBlocked || facts.playbackMuted || facts.playbackVolume === 0 || facts.playbackPaused) {
    const why = facts.playbackBlocked
      ? `O navegador bloqueou a reprodução com som.${facts.playError ? ` ${facts.playError}` : ''}`
      : facts.playbackPaused
        ? 'Os pacotes chegam, mas o vídeo está pausado.'
        : 'Os pacotes chegam, mas o elemento está silenciado ou com volume zero.';
    return diagnosis('RECEIVED_MUTED', 'ÁUDIO RECEBIDO, MAS SILENCIADO', why, timestamp);
  }
  if (facts.playbackMuted === null || facts.playbackVolume === null) {
    return diagnosis('INSUFFICIENT', 'ÁUDIO SEM DADOS SUFICIENTES', 'Os pacotes chegam, mas o estado do elemento de vídeo ainda não foi lido.', timestamp);
  }
  return diagnosis(
    'PLAYING',
    'ÁUDIO RECEBIDO E REPRODUZINDO',
    'Os pacotes de áudio aumentam e o elemento está tocando, desmutado e com volume acima de zero. Isso não mede se o som chegou nítido.',
    timestamp,
  );
}

export function audioEvents(previous: AudioFacts | null, current: AudioFacts | null): { severity: 'info' | 'atenção' | 'crítico'; message: string }[] {
  if (!current) return [];
  const prevCode = previous ? classifyAudio(previous, 0).code : null;
  const nextCode = classifyAudio(current, 0).code;
  const out: { severity: 'info' | 'atenção' | 'crítico'; message: string }[] = [];
  if (prevCode !== 'NOT_NEGOTIATED' && nextCode === 'NOT_NEGOTIATED') {
    out.push({ severity: 'crítico', message: 'Áudio não negociado.' });
  }
  if (prevCode !== 'NOT_RECEIVED' && nextCode === 'NOT_RECEIVED') {
    out.push({ severity: 'crítico', message: 'Áudio não recebido.' });
  }
  if (prevCode !== 'SENDING' && nextCode === 'SENDING') {
    out.push({ severity: 'info', message: 'Áudio sendo enviado.' });
  }
  if (prevCode === 'SENDING' && nextCode === 'CAPTURED_NOT_SENT') {
    out.push({ severity: 'atenção', message: 'Áudio interrompido.' });
  }
  if (prevCode !== 'PLAYING' && nextCode === 'PLAYING') {
    out.push({ severity: 'info', message: 'Áudio recebido e em reprodução.' });
  }
  if (previous?.playbackBlocked !== true && current.playbackBlocked === true) {
    out.push({ severity: 'atenção', message: 'Reprodução bloqueada pelo navegador.' });
  }
  if (previous?.playbackBlocked === true && current.playbackBlocked === false) {
    out.push({ severity: 'info', message: 'Áudio ativado pelo usuário.' });
  }
  return out;
}
