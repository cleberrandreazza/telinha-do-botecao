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

const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

export function isMobileUserAgent(userAgent: string): boolean {
  return MOBILE_UA.test(userAgent);
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
