import type {
  AudioCode,
  AudioDiagnosis,
  AudioFacts,
  AudioPlaybackReport,
  AudioRtp,
  EndpointRole,
} from './types.ts';

export interface AudioSdpInfo {
  present: boolean;
  rejected: boolean;
  direction: 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive' | null;
  codecs: string[];
}

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
}

export interface AudioLinkContext {
  senderAttached: boolean;
  negotiated: boolean | null;
  direction: string | null;
}

const DIRECTION = /^(sendrecv|sendonly|recvonly|inactive)$/;

/**
 * Lê a seção de áudio do SDP já negociado. Não altera o SDP.
 * Porta 0 significa que a seção foi rejeitada.
 */
export function inspectAudioSdp(sdp: string | null | undefined): AudioSdpInfo {
  if (!sdp) return { present: false, rejected: false, direction: null, codecs: [] };
  const lines = sdp.replace(/\r\n/g, '\n').split('\n');
  let inAudio = false;
  let present = false;
  let rejected = false;
  let direction: AudioSdpInfo['direction'] = null;
  const payloads: string[] = [];
  const codecs: string[] = [];
  for (const line of lines) {
    if (line.startsWith('m=')) {
      inAudio = line.startsWith('m=audio');
      if (!inAudio) continue;
      present = true;
      const parts = line.split(' ');
      rejected = parts[1] === '0';
      payloads.splice(0, payloads.length, ...parts.slice(3));
      continue;
    }
    if (!inAudio) continue;
    const rtpmap = line.match(/^a=rtpmap:(\d+)\s+([^/\s]+)/);
    if (rtpmap && payloads.includes(rtpmap[1])) codecs.push(rtpmap[2]);
    const dir = line.match(/^a=(sendrecv|sendonly|recvonly|inactive)$/);
    if (dir && DIRECTION.test(dir[1])) direction = dir[1] as AudioSdpInfo['direction'];
  }
  if (present && !direction) direction = 'sendrecv';
  return { present, rejected, direction, codecs };
}

export function negotiationFromSdp(localSdp: string | null | undefined, remoteSdp: string | null | undefined): {
  negotiated: boolean;
  direction: string | null;
  codecs: string[];
} {
  const local = inspectAudioSdp(localSdp);
  const remote = inspectAudioSdp(remoteSdp);
  const negotiated = local.present && remote.present && !local.rejected && !remote.rejected;
  return {
    negotiated,
    direction: remote.direction ?? local.direction,
    codecs: remote.codecs.length > 0 ? remote.codecs : local.codecs,
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
 * `suppressLocalAudioPlayback` fica no topo das opções e só impede o eco local de quem compartilha.
 * `exclude` limita o escopo. `windowAudio: 'system'` não é usado.
 */
export function buildDisplayMediaOptions(
  video: Record<string, unknown>,
  mode: AudioMode,
): Record<string, unknown> {
  if (mode === 'off') return { video, audio: false };
  if (mode === 'system') {
    return { video, audio: true, systemAudio: 'include', windowAudio: 'exclude', suppressLocalAudioPlayback: true };
  }
  return { video, audio: true, systemAudio: 'exclude', windowAudio: 'exclude', suppressLocalAudioPlayback: true };
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
): Promise<{ stream: T; audioScopeFallback: boolean }> {
  const full = buildDisplayMediaOptions(video, mode);
  try {
    return { stream: await getDisplayMedia(full), audioScopeFallback: false };
  } catch (err) {
    const name = errorName(err);
    if (mode === 'off' || CANCELLED.has(name) || !UNSUPPORTED.has(name)) throw err;
    // Uma segunda tentativa, só vídeo. Não se tira `exclude` e se segue com áudio.
    const stream = await getDisplayMedia(buildDisplayMediaOptions(video, 'off'));
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
      'Os pacotes de áudio desta conexão estão aumentando. Isso não prova que o espectador está ouvindo.',
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
    'Os pacotes de áudio aumentam e o elemento está tocando, desmutado e com volume acima de zero.',
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
