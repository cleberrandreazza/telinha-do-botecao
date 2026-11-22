/**
 * Formata código de sala com traço no meio: ABC-DEF
 */
export function formatCode(code: string): string {
  if (code.length === 6) {
    return `${code.slice(0, 3)}-${code.slice(3)}`;
  }
  return code;
}

/**
 * Limpa código (remove traços, espaços, uppercase)
 */
export function cleanCode(input: string): string {
  return input.replace(/[-\s]/g, '').toUpperCase().slice(0, 6);
}

/**
 * Copia texto para clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hosts de loopback: valem para a própria máquina, não para a rede.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** Extrai só o nome do host (sem esquema, porta ou caminho). */
export function hostnameOnly(host: string): string {
  const withoutScheme = host.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const withoutPath = withoutScheme.split('/')[0];
  const bracketed = withoutPath.match(/^\[([^\]]+)\]/);
  if (bracketed) return bracketed[1].toLowerCase();
  const colon = withoutPath.lastIndexOf(':');
  const name = colon > -1 ? withoutPath.slice(0, colon) : withoutPath;
  return name.trim().toLowerCase();
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(hostnameOnly(host));
}

/**
 * URL do servidor de sinalização (WebSocket)
 *
 * Padrão: mesma máquina que serve a página, na porta 4000 (funciona em
 * localhost e pela LAN). Uma configuração em loopback é ignorada quando a
 * página foi aberta por IP de rede — no celular "localhost" seria o próprio
 * celular, e a conexão com o servidor cairia.
 */
export function getSignalingHost(hostname: string, configuredHost?: string): string {
  const fallback = `${hostname}:4000`;
  if (!configuredHost) return fallback;
  if (isLoopbackHost(configuredHost) && !isLoopbackHost(hostname)) return fallback;
  return configuredHost;
}

export function getSignalingUrl(): string {
  // ws:// em http, wss:// em https (o host vem do hostname da página ou da env)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = getSignalingHost(window.location.hostname, import.meta.env.VITE_SIGNAL_HOST);
  return `${protocol}//${host}`;
}
