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
 * URL do servidor de sinalização (WebSocket)
 */
export function getSignalingUrl(): string {
  // Em desenvolvimento, usa localhost:4000
  // Em produção, pode ser configurado via variável de ambiente
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = import.meta.env.VITE_SIGNAL_HOST || 'localhost:4000';
  return `${protocol}//${host}`;
}
