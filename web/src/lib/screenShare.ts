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
 * Uma ABA do navegador é texto e interface: o encoder precisa gastar bits com
 * nitidez, não com movimento — era o que deixava a aba pequena (510×230)
 * ilegível. Tela cheia e janela são, em geral, vídeo ou jogo: aí 'motion' é o
 * certo. Quando o navegador não informa a superfície, fica 'motion'
 * (comportamento de antes, sem regressão).
 */
export function contentHintForSurface(displaySurface: string | null): 'detail' | 'motion' {
  return displaySurface === 'browser' ? 'detail' : 'motion';
}

/** Tamanho medido de uma captura (em pixels). */
export interface CaptureSize {
  width: number;
  height: number;
}

/**
 * Aviso para quem transmite quando a captura é MENOR que a resolução pedida.
 *
 * O navegador não amplia: uma aba entrega o tamanho da própria janela e uma
 * janela pequena entrega poucos pixels. Sem isso o streamer acha que está
 * transmitindo em 1080p e a sala enxerga 510×230.
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
  if (captured.width >= target.width) return null;

  const size = `${captured.width}×${captured.height}`;
  const goal = `${target.width}×${target.height}`;
  if (displaySurface === 'browser') {
    return `A aba transmite no tamanho da janela (${size}). O navegador não amplia: maximize a janela para chegar mais perto de ${goal}.`;
  }
  return `A captura está em ${size}, menor que o alvo ${goal}.`;
}

/**
 * Fator de redução do encoder para chegar na resolução pedida.
 *
 * A largura vem da medição real (`getSettings().width`): se a captura já for
 * menor que o alvo, o fator é 1 — o navegador não amplia, então reduzir de
 * novo só pioraria a imagem (é o que fazia a aba sair em 510×230 ilegível).
 * Sem largura medida não há como saber o tamanho da fonte: assume-se 1 em vez
 * de estimar, porque um valor estimado faria o encoder reduzir a imagem duas
 * vezes.
 */
export function scaleFactorForCapture(
  capturedWidth: number | null,
  target: CaptureSize | null,
): number {
  if (!capturedWidth || !target) return 1;
  if (capturedWidth < target.width) return 1;
  return Math.max(1, Math.round((capturedWidth / target.width) * 100) / 100);
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
