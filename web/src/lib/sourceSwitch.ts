/**
 * Troca da fonte capturada (aba / janela / tela) durante a live.
 *
 * O navegador decide o que capturar no seletor nativo: a escolha aqui é
 * só uma dica (`displaySurface`), e o que vale no fim é o que o navegador
 * entregou. Por isso a troca é sempre um novo `getDisplayMedia` seguido de
 * `replaceTrack` nos senders — sem renegociar, sem derrubar os
 * espectadores.
 */

/** Superfícies oferecidas pelo seletor nativo. */
export type DisplaySource = 'browser' | 'window' | 'monitor';

/**
 * Opções do seletor de fonte, na ordem da tela.
 *
 * A dica (`hint`) viaja para o `getDisplayMedia`; o navegador pode ignorá-la
 * — o que ele entregou é o que vale, e a UI mostra a superfície medida.
 */
export const SOURCE_OPTIONS: readonly {
  value: DisplaySource;
  label: string;
  hint: string;
}[] = [
  { value: 'browser', label: 'Aba', hint: 'Sugere uma aba — o navegador decide no seletor' },
  { value: 'window', label: 'Janela', hint: 'Sugere uma janela — o navegador decide no seletor' },
  { value: 'monitor', label: 'Tela', hint: 'Sugere a tela inteira — o navegador decide no seletor' },
];

/** Rótulo da fonte; "n/d" quando não se sabe o que foi capturado. */
export function sourceLabel(source: string | null | undefined): string {
  const found = SOURCE_OPTIONS.find((option) => option.value === source);
  return found ? found.label : 'n/d';
}

/** Sender mínimo para o `replaceTrack` (é o que o teste precisa). */
export interface TrackSenderLike {
  track: MediaStreamTrack | null;
  replaceTrack: (track: MediaStreamTrack | null) => Promise<void>;
}

/** Resultado da troca de track nos senders. */
export interface ReplaceTrackReport {
  /** Senders tentados. */
  attempted: number;
  /** Senders que aceitaram a track nova. */
  replaced: number;
  /** Senders que recusaram a track nova. */
  failed: number;
}

/**
 * Track a ser enviada: a mesma para todos os senders, ou uma por sender
 * (cada conexão de vídeo precisa do seu próprio `clone()`, senão o Chromium
 * compartilha o encoder entre elas).
 */
export type TrackProvider =
  | MediaStreamTrack
  | null
  | ((sender: TrackSenderLike, index: number) => MediaStreamTrack | null);

/**
 * Troca a track nos senders, sem renegociar.
 *
 * Uma falha em um sender não derruba os outros: cada um é tratado no seu
 * próprio try/catch e o relatório diz quantos aceitaram.
 */
export async function replaceTrackOnSenders(
  senders: readonly TrackSenderLike[],
  next: TrackProvider,
): Promise<ReplaceTrackReport> {
  const report: ReplaceTrackReport = { attempted: 0, replaced: 0, failed: 0 };
  for (let index = 0; index < senders.length; index += 1) {
    const sender = senders[index];
    report.attempted += 1;
    try {
      const track = typeof next === 'function' ? next(sender, index) : next;
      await sender.replaceTrack(track);
      report.replaced += 1;
    } catch (error) {
      report.failed += 1;
      console.warn('[WebRTC] replaceTrack recusou a track nova:', error);
    }
  }
  return report;
}

/** Nome do erro de um objeto qualquer (o erro do navegador nem sempre é Error). */
export function errorNameOf(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    return String((err as { name: unknown }).name);
  }
  return '';
}

/**
 * Motivo real de uma falha na troca de fonte — texto curto para a faixa
 * âmbar da barra do streamer. O cancelamento no seletor nativo tem texto
 * próprio: a fonte atual continua valendo.
 */
export function describeSwitchError(error: unknown): string {
  const name = errorNameOf(error);
  if (name === 'NotAllowedError') {
    return 'Troca cancelada no seletor do navegador. A fonte atual continua valendo.';
  }
  if (name === 'AbortError') {
    return 'O navegador interrompeu a troca de fonte. A fonte atual continua valendo.';
  }
  if (name === 'NotSupportedError' || name === 'TypeError') {
    return 'Este navegador não oferece a troca de fonte durante a transmissão.';
  }
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';
  if (message) return `Não foi possível trocar a fonte: ${message}`;
  return 'Não foi possível trocar a fonte. A fonte atual continua valendo.';
}
