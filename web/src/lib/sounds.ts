/**
 * Sons de evento da sala.
 *
 * Tudo é sintetizado com WebAudio (osciladores curtos): nenhum arquivo
 * externo, nenhuma licença, nada para baixar. O timbre é curto e "de
 * boteco" para não atrapalhar o áudio da live.
 *
 * Regras que valem para todos os sons:
 * - o som da MENSAGEM toca mesmo com o chat aberto e em foco (decisão do
 *   Cleber): por isso o volume dele é baixo — é um aviso, não um susto;
 * - a mensagem PRÓPRIA nunca toca;
 * - o HISTÓRICO nunca toca (chega inteiro quando a aba entra na sala: seria
 *   uma avalanche de bipes).
 *
 * O mute é o toggle "Sons de eventos" da SettingsModal (M11): a preferência é
 * persistida em `botecao-settings` e aplicada com `setSoundsEnabled` — o
 * motor não muda.
 */

export type SoundKind = 'message' | 'peer-joined' | 'peer-left' | 'stream-started';

/** Eventos da sala que podem tocar um som. */
export type RoomSoundEvent =
  | { type: 'peer-joined' }
  | { type: 'peer-left' }
  | { type: 'sharing-started' }
  | { type: 'chat-message'; own: boolean; history: boolean };

/**
 * Mapeamento evento → som (função pura: decide, não toca).
 *
 * `own` = a mensagem é minha; `history` = a mensagem veio do histórico.
 */
export function soundForEvent(event: RoomSoundEvent): SoundKind | null {
  switch (event.type) {
    case 'peer-joined':
      return 'peer-joined';
    case 'peer-left':
      return 'peer-left';
    case 'sharing-started':
      return 'stream-started';
    case 'chat-message':
      if (event.own) return null;
      if (event.history) return null;
      return 'message';
  }
}

interface Tone {
  /** Frequência em Hz. */
  freq: number;
  /** Duração do tom em segundos. */
  duration: number;
  /** Atraso antes do tom começar. */
  delay: number;
  type: OscillatorType;
}

/** Volume de cada som (0..1). O da mensagem é baixo de propósito. */
const SOUND_VOLUME: Record<SoundKind, number> = {
  message: 0.1,
  'peer-joined': 0.22,
  'peer-left': 0.18,
  'stream-started': 0.24,
};

const SOUND_TONES: Record<SoundKind, Tone[]> = {
  message: [{ freq: 880, duration: 0.1, delay: 0, type: 'sine' }],
  'peer-joined': [
    { freq: 523.25, duration: 0.09, delay: 0, type: 'triangle' },
    { freq: 783.99, duration: 0.13, delay: 0.08, type: 'triangle' },
  ],
  'peer-left': [
    { freq: 392, duration: 0.1, delay: 0, type: 'triangle' },
    { freq: 261.63, duration: 0.15, delay: 0.09, type: 'triangle' },
  ],
  'stream-started': [
    { freq: 659.25, duration: 0.08, delay: 0, type: 'sine' },
    { freq: 987.77, duration: 0.12, delay: 0.07, type: 'sine' },
  ],
};

let context: AudioContext | null = null;
let unlockInstalled = false;
let enabled = true;

/**
 * Lê o valor persistido de "Sons de eventos".
 *
 * A preferência só está desligada quando a pessoa salva `false` de fato:
 * chave ausente (primeiro uso, config antiga) ou valor corrompido significam
 * ligado, que é o comportamento padrão do app.
 */
export function resolveEventSounds(value: unknown): boolean {
  return value !== false;
}

/** Volume que o browser aplicaria: 0 desliga os sons de uma vez. */
export function setSoundsEnabled(next: boolean): void {
  enabled = next;
}

export function areSoundsEnabled(): boolean {
  return enabled;
}

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (context) return context;
  const scope = window as unknown as { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
}

/**
 * Libera o áudio no primeiro gesto do usuário.
 *
 * O browser começa o AudioContext suspenso e só deixa tocar depois de um
 * clique/tecla. Esta função é idempotente: chame uma vez no mount.
 */
export function installAudioUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const unlock = () => {
    const ctx = getContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

/**
 * Toca o som de um evento (ou não, conforme o mapeamento).
 * Silencioso quando os sons estão desligados, quando não há áudio no browser
 * ou quando o contexto ainda está suspenso por falta de gesto do usuário.
 */
export function playSound(kind: SoundKind): void {
  if (!enabled) return;
  const ctx = getContext();
  if (!ctx) return;

  // Sem gesto do usuário o browser não deixa tocar: tenta retomar e segua.
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }

  const tones = SOUND_TONES[kind];
  if (!tones || tones.length === 0) return;
  const volume = SOUND_VOLUME[kind] ?? 0.2;
  const now = ctx.currentTime;

  for (const tone of tones) {
    const start = now + tone.delay;
    const oscillator = ctx.createOscillator();
    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.freq, start);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.012);
    gain.gain.linearRampToValueAtTime(0, start + tone.duration);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + tone.duration + 0.02);
  }
}
