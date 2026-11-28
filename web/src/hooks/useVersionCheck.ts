import { useCallback, useEffect, useState } from 'react';

const CHECK_INTERVAL_MS = 60_000;

function readVersion(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('version' in body)) return null;
  const version = (body as { version: unknown }).version;
  return typeof version === 'string' && version.length > 0 ? version : null;
}

/**
 * Compara a versão publicada com a que esta aba carregou.
 * Em dev não consulta a rede. Falha de rede não altera o estado.
 */
export function useVersionCheck(): {
  hasUpdate: boolean;
  dismiss: () => void;
  reload: () => void;
} {
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const controller = new AbortController();
    let active = true;

    const check = async () => {
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const version = readVersion(await response.json());
        if (!active || version === null) return;
        setRemoteVersion(version === __APP_VERSION__ ? null : version);
      } catch {
        // Rede fora ou JSON inválido: quem transmite ou assiste continua.
      }
    };

    void check();
    const timer = window.setInterval(() => { void check(); }, CHECK_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const dismiss = useCallback(() => {
    setDismissedVersion(remoteVersion);
  }, [remoteVersion]);

  const reload = useCallback(() => {
    window.location.reload();
  }, []);

  return {
    hasUpdate: remoteVersion !== null && remoteVersion !== dismissedVersion,
    dismiss,
    reload,
  };
}
