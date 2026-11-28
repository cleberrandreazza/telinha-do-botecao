import { useCallback, useEffect, useState } from 'react';

export interface DesktopUpdate {
  version: string;
  assetName: string;
}

interface UpdateProgress {
  received: number;
  total: number | null;
}

function updateError(cause: unknown): string {
  if (typeof cause === 'string' && cause.trim()) return cause;
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return 'Não foi possível atualizar.';
}

function tauriShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Aviso da release publicada no GitHub. No site isto não consulta nada:
 * só o shell do Tauri tem os comandos.
 */
export function useDesktopUpdate(): {
  active: boolean;
  update: DesktopUpdate | null;
  installing: boolean;
  progress: number | null;
  error: string | null;
  install: () => void;
} {
  const active = tauriShell();
  const [update, setUpdate] = useState<DesktopUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const stops: Array<() => void> = [];

    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      if (cancelled) return;
      const stopAvailable = await listen<DesktopUpdate>('desktop-update-available', (event) => {
        setUpdate(event.payload);
      });
      if (cancelled) {
        stopAvailable();
        return;
      }
      stops.push(stopAvailable);
      const stopProgress = await listen<UpdateProgress>('desktop-update-progress', (event) => {
        const { received, total } = event.payload;
        setProgress(total && total > 0 ? received / total : null);
      });
      if (cancelled) {
        stopProgress();
        return;
      }
      stops.push(stopProgress);
      try {
        const found = await invoke<DesktopUpdate | null>('check_for_update');
        if (!cancelled && found) setUpdate(found);
      } catch {
        // Sem rede ou sem release: a janela segue.
      }
    })();

    return () => {
      cancelled = true;
      for (const stop of stops) stop();
    };
  }, [active]);

  const install = useCallback(() => {
    if (!active || installing) return;
    setInstalling(true);
    setError(null);
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('install_portable_update');
      } catch (cause) {
        setInstalling(false);
        setError(updateError(cause));
      }
    })();
  }, [active, installing]);

  return { active, update, installing, progress, error, install };
}
