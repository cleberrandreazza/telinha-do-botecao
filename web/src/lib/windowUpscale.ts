/**
 * Escala proporcional de janela de aplicativo, só quando a captura é mais baixa que o alvo.
 *
 * Aba e tela inteira não passam por aqui: a track nativa segue, e o encoder
 * reduz só pela altura quando a fonte é mais alta que o preset. A captura de
 * janela não leva `width`/`height`. Se a altura já alcança o alvo, a track
 * nativa segue. Abaixo disso, um `<video>` oculto desenha num canvas par.
 */

export interface FrameSize {
  width: number;
  height: number;
}

/** Só janela de aplicativo pode passar pelo canvas. Aba e tela inteira ficam na track nativa. */
export function scalesWithCanvas(surface: string | null): boolean {
  return surface === 'window';
}

/** Inteiro par, no mínimo 2. Codec de vídeo recusa dimensão ímpar. */
export function evenDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * A captura precisa de canvas quando a altura está abaixo do alvo.
 *
 * 1080 de altura em 1080p já cobre, mesmo em ultrawide (2560×1080, 3440×1440):
 * a track nativa segue. Uma janela mais baixa liga o canvas. Medida inválida não liga.
 */
export function sourceNeedsUpscale(
  sourceWidth: number,
  sourceHeight: number,
  targetHeight: number,
): boolean {
  if (
    !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
    !Number.isFinite(targetHeight) ||
    sourceWidth < 2 || sourceHeight < 2 || targetHeight < 2
  ) {
    return false;
  }
  return sourceHeight < targetHeight;
}

/**
 * Tamanho de saída pela altura do alvo, sem teto de largura.
 *
 * A proporção da fonte fica intacta: 3000×1000 em 1080p sai 3240×1080, não
 * 1920×640. Os dois lados saem pares. Sem medida válida, null — nada é inventado.
 */
export function windowOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  targetHeight: number,
): FrameSize | null {
  if (
    !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
    !Number.isFinite(targetHeight) ||
    sourceWidth < 2 || sourceHeight < 2 || targetHeight < 2
  ) {
    return null;
  }
  const height = evenDimension(targetHeight);
  const width = evenDimension(targetHeight * (sourceWidth / sourceHeight));
  if (width < 2 || height < 2) return null;
  return { width, height };
}

/**
 * `scaleResolutionDownBy` só pela altura.
 *
 * Fonte mais alta que o preset reduz pela razão das alturas. Altura igual ou
 * menor não reduz: a largura, mesmo ultrawide, não entra na conta.
 */
export function resolutionScaleDownBy(sourceHeight: number, targetHeight: number): number {
  if (!Number.isFinite(sourceHeight) || !Number.isFinite(targetHeight) || targetHeight <= 0) return 1;
  return sourceHeight > targetHeight ? sourceHeight / targetHeight : 1;
}

/** Intervalo do relógio de desenho, em ms. 30 fps vira 33. */
export function frameIntervalMs(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return Math.max(1, Math.round(1000 / fps));
}

const FRAME_CLOCK_SOURCE = `
let timer = 0;
self.onmessage = (event) => {
  const fps = Number(event.data && event.data.fps);
  if (timer) clearInterval(timer);
  timer = 0;
  if (!Number.isFinite(fps) || fps <= 0) return;
  const interval = Math.max(1, Math.round(1000 / fps));
  timer = setInterval(() => { self.postMessage(0); }, interval);
};
`;

interface FrameClock {
  setFps(fps: number): void;
  stop(): void;
}

/**
 * Relógio fora da aba. `requestAnimationFrame` e `setTimeout` da página caem
 * para cerca de 1 fps quando a Telinha fica atrás da janela compartilhada.
 */
function createFrameClock(fps: number, onTick: () => void): FrameClock {
  try {
    const blob = new Blob([FRAME_CLOCK_SOURCE], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    worker.onmessage = () => onTick();
    worker.postMessage({ fps });
    return {
      setFps(next) {
        worker.postMessage({ fps: next });
      },
      stop() {
        worker.postMessage({ fps: 0 });
        worker.terminate();
        URL.revokeObjectURL(url);
      },
    };
  } catch {
    let timer = 0;
    const arm = (value: number) => {
      if (timer) window.clearInterval(timer);
      timer = 0;
      const interval = frameIntervalMs(value);
      if (!interval) return;
      timer = window.setInterval(onTick, interval);
    };
    arm(fps);
    return {
      setFps: arm,
      stop() {
        if (timer) window.clearInterval(timer);
        timer = 0;
      },
    };
  }
}

/**
 * Observa o tamanho nativo e, quando falta resolução, publica o canvas.
 *
 * O `<video>` fica no DOM o tempo todo, minúsculo e quase transparente: sem
 * `display: none` o Chromium não suspende os quadros. O desenho e o
 * `captureStream` só existem no upscale. O Worker pinta em todo tick, no fps
 * alvo, repetindo o último quadro quando a janela entrega menos. O callback
 * de quadro do vídeo só mantém a decodificação. Parar encerra o loop, solta
 * o `srcObject` e para a track original.
 */
export class SurfaceFramePump {
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sourceTrack: MediaStreamTrack;
  private outputTrack: MediaStreamTrack | null = null;
  private target: FrameSize;
  private fps: number;
  private lastPlayAttempt = 0;
  private videoFrameId = 0;
  private clock: FrameClock | null = null;
  private stopped = false;
  private drawing = false;
  private onSize: ((needsUpscale: boolean) => void) | null = null;
  private readonly onResize: () => void;

  private constructor(sourceTrack: MediaStreamTrack, target: FrameSize, fps: number) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
      ?? canvas.getContext('2d', { alpha: false })
      ?? canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponível para escalar a captura.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    // Sem `display: none` e sem tamanho zero: o Chromium suspende o quadro.
    video.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
    video.srcObject = new MediaStream([sourceTrack]);
    document.body.appendChild(video);

    this.video = video;
    this.canvas = canvas;
    this.ctx = ctx;
    this.sourceTrack = sourceTrack;
    this.target = target;
    this.fps = fps;
    this.onResize = () => this.handleResize();
    video.addEventListener('resize', this.onResize);
    video.addEventListener('loadedmetadata', this.onResize);
  }

  static async start(sourceTrack: MediaStreamTrack, target: FrameSize, fps: number): Promise<SurfaceFramePump> {
    const pump = new SurfaceFramePump(sourceTrack, target, fps);
    try {
      await pump.video.play();
    } catch {
      // O quadro ainda pode chegar pelo resize. A track original continua viva.
    }
    if (pump.video.videoWidth === 0) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        pump.video.addEventListener('loadedmetadata', done, { once: true });
        window.setTimeout(done, 1000);
      });
    }
    return pump;
  }

  get engaged(): boolean {
    return this.drawing;
  }

  get needsUpscale(): boolean {
    return sourceNeedsUpscale(
      this.video.videoWidth,
      this.video.videoHeight,
      this.target.height,
    );
  }

  get track(): MediaStreamTrack {
    if (!this.outputTrack) throw new Error('O canvas ainda não está publicando vídeo.');
    return this.outputTrack;
  }

  get source(): MediaStreamTrack {
    return this.sourceTrack;
  }

  /** Passa a avisar quando o tamanho nativo cruza o alvo. */
  watch(listener: (needsUpscale: boolean) => void) {
    this.onSize = listener;
  }

  /** Liga o desenho. A track do canvas nasce aqui e segue a mesma enquanto o upscale durar. */
  engage(): MediaStreamTrack {
    if (this.stopped) throw new Error('A escala da captura já foi encerrada.');
    if (!this.needsUpscale) throw new Error('A captura já cobre o alvo.');
    this.syncSize();
    if (this.canvas.width < 2 || this.canvas.height < 2) {
      throw new Error('O canvas não recebeu tamanho válido.');
    }
    if (!this.drawing || !this.outputTrack) {
      this.outputTrack = this.openStream(this.fps);
      this.drawing = true;
      this.startClock();
    }
    return this.outputTrack;
  }

  /** Para o desenho e a track do canvas. O vídeo oculto e a track original continuam. */
  disengage() {
    if (!this.drawing) return;
    this.drawing = false;
    this.stopClock();
    this.outputTrack?.stop();
    this.outputTrack = null;
  }

  /** Novo alvo (1080p, 720p…). Com o canvas ligado, o quadro acompanha na hora. */
  setTarget(target: FrameSize) {
    this.target = target;
    if (this.drawing && this.needsUpscale) this.syncSize();
  }

  /** Taxa usada no próximo `captureStream` e no relógio, mesmo com o canvas desligado. */
  setFrameRate(fps: number) {
    this.fps = fps;
    this.clock?.setFps(fps);
  }

  /**
   * Nova taxa. A track anterior só para quando `release` for chamado,
   * para um sender que recuse a troca continuar no quadro velho.
   */
  retargetFrameRate(fps: number): { previous: MediaStreamTrack; next: MediaStreamTrack } {
    if (!this.outputTrack || !this.drawing) {
      throw new Error('Não há canvas ativo para trocar a taxa de quadros.');
    }
    this.fps = fps;
    this.clock?.setFps(fps);
    const previous = this.outputTrack;
    const next = this.openStream(fps);
    this.outputTrack = next;
    return { previous, next };
  }

  restore(track: MediaStreamTrack) {
    if (this.stopped) return;
    if (this.outputTrack && this.outputTrack !== track) this.outputTrack.stop();
    this.outputTrack = track;
    this.drawing = true;
  }

  release(track: MediaStreamTrack) {
    if (track !== this.outputTrack) track.stop();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.drawing = false;
    this.onSize = null;
    this.stopClock();
    this.video.removeEventListener('resize', this.onResize);
    this.video.removeEventListener('loadedmetadata', this.onResize);
    this.video.pause();
    this.video.srcObject = null;
    this.video.remove();
    this.sourceTrack.onended = null;
    this.sourceTrack.stop();
    if (this.outputTrack) {
      this.outputTrack.onended = null;
      this.outputTrack.stop();
    }
    this.outputTrack = null;
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  private openStream(fps: number): MediaStreamTrack {
    const track = this.canvas.captureStream(fps).getVideoTracks()[0];
    if (!track) throw new Error('O canvas não devolveu track de vídeo.');
    track.contentHint = 'detail';
    const read = track.getSettings.bind(track);
    const source = this.sourceTrack;
    track.getSettings = () => {
      const settings = read();
      if (typeof settings.displaySurface === 'string') return settings;
      const surface = source.getSettings().displaySurface;
      if (typeof surface !== 'string') return settings;
      return { ...settings, displaySurface: surface };
    };
    return track;
  }

  private handleResize() {
    if (this.stopped) return;
    if (this.drawing && this.needsUpscale) this.syncSize();
    this.onSize?.(this.needsUpscale);
  }

  private syncSize() {
    const next = windowOutputSize(
      this.video.videoWidth,
      this.video.videoHeight,
      this.target.height,
    );
    if (!next) return;
    if (this.canvas.width !== next.width) this.canvas.width = next.width;
    if (this.canvas.height !== next.height) this.canvas.height = next.height;
  }

  private startClock() {
    this.stopClock();
    this.clock = createFrameClock(this.fps, () => this.onWorkerTick());
    this.armVideoFrame();
  }

  private stopClock() {
    this.clock?.stop();
    this.clock = null;
    if (this.videoFrameId) this.video.cancelVideoFrameCallback(this.videoFrameId);
    this.videoFrameId = 0;
  }

  /** O Worker dita a cadência. O callback de quadro não entra nesta conta. */
  private onWorkerTick() {
    if (this.stopped || !this.drawing) return;
    if (this.video.readyState >= 2) this.drawFrame();
  }

  /** Mantém o `<video>` oculto decodificando. Não desenha o canvas. */
  private armVideoFrame() {
    if (typeof this.video.requestVideoFrameCallback !== 'function') return;
    this.videoFrameId = this.video.requestVideoFrameCallback(() => {
      if (this.stopped || !this.drawing) return;
      this.armVideoFrame();
    });
  }

  /** Repete o último quadro quando a janela entrega menos que o fps alvo. */
  private drawFrame() {
    if (this.stopped || !this.drawing) return;
    const now = performance.now();
    if (this.video.paused && this.sourceTrack.readyState === 'live' && now - this.lastPlayAttempt > 1000) {
      this.lastPlayAttempt = now;
      void this.video.play().catch(() => {});
    }
    this.syncSize();
    if (this.canvas.width < 2 || this.video.videoWidth < 2) return;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'medium';
    try {
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    } catch {
      // O primeiro quadro da captura ainda não chegou.
    }
  }
}
