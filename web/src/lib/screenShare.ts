/**
 * Suporte a compartilhamento de tela (getDisplayMedia).
 *
 * A API só existe em contexto seguro (https ou localhost) e em navegadores de
 * computador. Celular (Android/iOS) não implementa getDisplayMedia: chamar a
 * função lá estoura um TypeError genérico ("getDisplayMedia is not a function"),
 * que não diz nada para o usuário. Aqui detectamos o caso antes e devolvemos
 * uma mensagem clara.
 */

export type ScreenShareBlockReason =
  | 'insecure-context'
  | 'unsupported-platform'
  | 'missing-api';

export interface ScreenShareEnvironment {
  /** window.isSecureContext */
  secureContext: boolean;
  /** navigator.mediaDevices existe */
  hasMediaDevices: boolean;
  /** navigator.mediaDevices.getDisplayMedia é função */
  hasGetDisplayMedia: boolean;
  /** User agent parece de celular/tablet */
  isMobile: boolean;
}

export interface ScreenShareSupport {
  supported: boolean;
  reason: ScreenShareBlockReason | null;
  message: string;
}

export const SCREEN_SHARE_MESSAGES: Record<ScreenShareBlockReason, string> = {
  'insecure-context':
    'O navegador bloqueia a captura de tela fora de HTTPS. Abra o app em http://localhost:3000 ou por HTTPS e tente de novo.',
  'unsupported-platform':
    'Celular e tablet não compartilham a tela: a captura existe só em navegadores de computador. Compartilhe pelo PC (Chrome, Edge ou Firefox) e assista pelo celular.',
  'missing-api':
    'Este navegador não oferece captura de tela (getDisplayMedia). Use Chrome, Edge ou Firefox no computador.',
};

/**
 * Aviso exibido quando a pessoa fecha o seletor nativo sem escolher nada.
 *
 * O texto diz o que aconteceu (cancelou) e o que NÃO aconteceu (nada foi
 * transmitido), para ninguém ficar achando que está no ar.
 */
export const SHARE_CANCEL_NOTICE =
  'Compartilhamento cancelado. Nada foi transmitido — tente de novo quando quiser.';

const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

export function isMobileUserAgent(userAgent: string): boolean {
  return MOBILE_UA.test(userAgent);
}

/** Nome do erro de um objeto qualquer (o erro do navegador nem sempre é Error). */
function errorName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    return String((err as { name: unknown }).name);
  }
  return '';
}

/**
 * A pessoa cancelou o seletor nativo de compartilhamento?
 *
 * O Chrome fecha o seletor "Escolher o que compartilhar" com `NotAllowedError`
 * quando a pessoa clica em Cancelar ou aperta Esc. Como o seletor vive fora do
 * nosso controle, a captura nunca começa e ninguém é avisado — quem compartilha
 * fica sem saber se cancelou, se falhou ou se já está no ar.
 *
 * Só `NotAllowedError` conta como cancelamento: os demais erros (falha de
 * hardware, permissão negada pelo sistema, faixa ocupada) continuam com o
 * tratamento de erro que já existia.
 */
export function isScreenShareCancellation(err: unknown): boolean {
  return errorName(err) === 'NotAllowedError';
}

/**
 * Decide se o compartilhamento de tela pode funcionar e por que não.
 * Prioridade: celular (não existe em nenhum navegador móvel) → contexto
 * inseguro (endereço http://192.168.x.x) → API ausente.
 */
export function detectScreenShareSupport(env: ScreenShareEnvironment): ScreenShareSupport {
  if (env.hasGetDisplayMedia && env.secureContext) {
    return { supported: true, reason: null, message: '' };
  }
  if (env.isMobile) {
    return {
      supported: false,
      reason: 'unsupported-platform',
      message: SCREEN_SHARE_MESSAGES['unsupported-platform'],
    };
  }
  if (!env.secureContext) {
    return {
      supported: false,
      reason: 'insecure-context',
      message: SCREEN_SHARE_MESSAGES['insecure-context'],
    };
  }
  return {
    supported: false,
    reason: 'missing-api',
    message: SCREEN_SHARE_MESSAGES['missing-api'],
  };
}

/** Lê o ambiente real do navegador. */
export function readScreenShareEnvironment(): ScreenShareEnvironment {
  const hasNavigator = typeof navigator !== 'undefined';
  const hasWindow = typeof window !== 'undefined';
  const mediaDevices = hasNavigator
    ? (navigator.mediaDevices as MediaDevices | undefined)
    : undefined;

  return {
    secureContext: hasWindow ? window.isSecureContext === true : false,
    hasMediaDevices: Boolean(mediaDevices),
    hasGetDisplayMedia: typeof mediaDevices?.getDisplayMedia === 'function',
    isMobile: hasNavigator ? isMobileUserAgent(navigator.userAgent ?? '') : false,
  };
}

/**
 * Hint de conteúdo do encoder.
 *
 * Aba, janela e tela inteira ficam em 'motion'. 'detail' faz o Chromium
 * derrubar a aba para 5–15 FPS quando vê vídeo em movimento. 'motion' segura
 * os 30 FPS; a nitidez fica com VP9 e com `degradationPreference` `balanced`.
 * A superfície entra só para a chamada continuar estável: o hint não muda.
 */
export function contentHintForSurface(_displaySurface: string | null): 'motion' {
  return 'motion';
}

export interface VideoCodecPreference {
  mimeType: string;
  sdpFmtpLine?: string;
  preferredPayloadType?: number | null;
}

function codecMime(codec: VideoCodecPreference): string {
  return codec.mimeType.toLowerCase();
}

function codecApt(codec: VideoCodecPreference): string | null {
  const match = codec.sdpFmtpLine?.match(/(?:^|;)\s*apt=(\d+)/);
  return match ? match[1] : null;
}

/**
 * VP9 na frente, quando o navegador oferece. H.264 vem logo depois, para
 * Safari e iOS. O restante da lista (VP8, AV1, RTX dos outros) permanece,
 * e o RTX acompanha o codec a que pertence.
 */
export function orderVideoCodecs<T extends VideoCodecPreference>(codecs: readonly T[]): T[] {
  const payload = (codec: T) => (
    codec.preferredPayloadType == null ? null : String(codec.preferredPayloadType)
  );
  const vp9Payloads = new Set(
    codecs.filter((codec) => codecMime(codec) === 'video/vp9').map(payload).filter((value): value is string => value !== null),
  );
  const h264Payloads = new Set(
    codecs.filter((codec) => codecMime(codec) === 'video/h264').map(payload).filter((value): value is string => value !== null),
  );
  const vp9: T[] = [];
  const h264: T[] = [];
  const rest: T[] = [];
  for (const codec of codecs) {
    const kind = codecMime(codec);
    const associated = kind === 'video/rtx' ? codecApt(codec) : null;
    if (kind === 'video/vp9' || (associated !== null && vp9Payloads.has(associated))) vp9.push(codec);
    else if (kind === 'video/h264' || (associated !== null && h264Payloads.has(associated))) h264.push(codec);
    else rest.push(codec);
  }
  return [...vp9, ...h264, ...rest];
}

/** Tamanho medido de uma captura (em pixels). */
export interface CaptureSize {
  width: number;
  height: number;
}

/**
 * Aviso para quem transmite quando a captura é MENOR que a resolução pedida.
 *
 * O navegador não amplia nem estica: a aba e a janela saem no tamanho nativo.
 * O texto explica isso. Não é uma falha da transmissão.
 *
 * A captura cabe no alvo mantendo a proporção: uma janela mais alta que 16:9
 * chega em 1080 de altura com largura menor. Só há aviso quando nenhum dos
 * dois lados alcança o alvo. Só a janela mais baixa que o alvo sai pelo
 * canvas. A aba segue na track nativa, então a faixa enviada é a nativa.
 *
 * Devolve null quando não há medição (nada é estimado — ver
 * docs/diagnostics.md) ou quando a captura já cobre o alvo.
 */
export function captureLimitNotice(
  captured: CaptureSize | null,
  target: CaptureSize | null,
  displaySurface: string | null,
): string | null {
  if (!captured || !target) return null;
  if (captured.width >= target.width || captured.height >= target.height) return null;

  const size = `${captured.width}×${captured.height}`;
  const goal = `${target.width}×${target.height}`;
  const source = displaySurface === 'browser' ? 'A aba' : displaySurface === 'window' ? 'A janela' : 'A captura';
  return `${source} está sendo transmitida na resolução nativa (${size}), sem esticar. O alvo ${goal} só vale quando a fonte é maior.`;
}

/**
 * Constraints de vídeo da tela inteira, aplicadas depois que a superfície já é conhecida.
 *
 * Só a altura tem teto (`max`). A largura acompanha a proporção: um ultrawide
 * 2560×1080 em 1080p não é espremido para caber em 1920. O navegador não
 * amplia. Janela e aba não usam estas constraints — `width` e `height` cortam
 * o conteúdo quando a pessoa redimensiona. O canvas entra só na janela, e só
 * quando a altura nativa fica abaixo do alvo. A aba permanece na track nativa.
 */
export function captureVideoConstraints(
  target: CaptureSize,
  frameRate: number,
): { height: { max: number }; frameRate: { ideal: number; max: number } } {
  return {
    height: { max: target.height },
    frameRate: frameRateConstraints(frameRate),
  };
}

/** Só a taxa de quadros. É o pedido de `getDisplayMedia` e o de janela ou aba no `applyConstraints`. */
export function captureFrameRateConstraints(
  frameRate: number,
): { frameRate: { ideal: number; max: number } } {
  return { frameRate: frameRateConstraints(frameRate) };
}

function frameRateConstraints(frameRate: number): { ideal: number; max: number } {
  return { ideal: frameRate, max: frameRate };
}

export class ScreenShareUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScreenShareUnsupportedError';
  }
}

/** Lança ScreenShareUnsupportedError quando o dispositivo não pode capturar a tela. */
export function assertScreenShareSupported(
  env: ScreenShareEnvironment = readScreenShareEnvironment(),
): void {
  const support = detectScreenShareSupport(env);
  if (!support.supported) {
    throw new ScreenShareUnsupportedError(support.message);
  }
}
