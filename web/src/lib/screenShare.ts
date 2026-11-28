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
 * Aba e janela são texto e interface: 'detail' faz o encoder gastar bits com
 * nitidez de letras e botões, mesmo quando a janela é menor que o alvo
 * (1078×730 com 1080p pedido). 'motion' fica só para a tela inteira, que em
 * geral é vídeo ou jogo. Quando o navegador não informa a superfície, fica
 * 'motion' (o comportamento de antes, sem tratar uma tela desconhecida como texto).
 */
export function contentHintForSurface(displaySurface: string | null): 'detail' | 'motion' {
  return displaySurface === 'browser' || displaySurface === 'window' ? 'detail' : 'motion';
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
 * dois lados alcança o alvo.
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
 * O limite fica na captura (`max`), não no encoder: o navegador reduz cada
 * frame para caber no alvo mantendo a proporção e não amplia. Janela e aba
 * não usam estas constraints — `width` e `height` cortam o conteúdo quando a
 * pessoa redimensiona. O canvas escala as duas só quando os dois lados estão
 * abaixo do alvo.
 */
export function captureVideoConstraints(
  target: CaptureSize,
  frameRate: number,
): { width: { max: number }; height: { max: number }; frameRate: { ideal: number; max: number } } {
  return {
    width: { max: target.width },
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
