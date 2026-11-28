import { invoke } from '@tauri-apps/api/core';
import { createFrameDrawer } from './nativeFrameSurface.ts';
import type { StreamConfig } from './webrtc';

export interface CaptureSource {
  id: string;
  kind: 'window' | 'monitor';
  title: string;
  appName: string;
  width: number;
  height: number;
  thumbnail: string;
}

export type CaptureQuality = '720' | '1080' | 'native';

export interface NativeShareRequest {
  sourceId: string;
  kind: 'window' | 'monitor';
  quality: CaptureQuality;
  fps: 30 | 60;
  captureAudio: boolean;
}

interface SessionInfo {
  sessionId: number;
  videoUrl: string;
  audioUrl: string;
  sampleRate: number;
  channels: number;
  width: number;
  height: number;
  audio: boolean;
}

const PCM_RATE = 48_000;
const PCM_CHANNELS = 2;
/** 60 ms a 48 kHz. O worklet segura isso antes de tocar e não passa desse estoque. */
const PCM_HOLD_FRAMES = 2_880;

const PCM_WORKLET = `
class TelinhaPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 48000;
    this.left = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.read = 0;
    this.write = 0;
    this.primed = false;
    this.port.onmessage = (event) => {
      const data = event.data;
      const pcm = data instanceof Float32Array ? data : new Float32Array(data);
      const frames = Math.floor(pcm.length / 2);
      for (let index = 0; index < frames; index += 1) {
        this.left[this.write] = pcm[index * 2];
        this.right[this.write] = pcm[index * 2 + 1];
        this.write += 1;
        if (this.write === this.capacity) this.write = 0;
        if (this.write === this.read) {
          this.read += 1;
          if (this.read === this.capacity) this.read = 0;
        }
      }
      let available = this.write - this.read;
      if (available < 0) available += this.capacity;
      if (!this.primed && available >= ${PCM_HOLD_FRAMES}) this.primed = true;
      if (available > ${PCM_HOLD_FRAMES}) {
        this.read = (this.read + (available - ${PCM_HOLD_FRAMES})) % this.capacity;
      }
    };
  }
  process(_inputs, outputs) {
    const left = outputs[0] && outputs[0][0];
    const right = (outputs[0] && outputs[0][1]) || left;
    if (!left || !right) return true;
    if (!this.primed) {
      left.fill(0);
      if (right !== left) right.fill(0);
      return true;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (this.read === this.write) {
        left[index] = 0;
        right[index] = 0;
        this.primed = false;
        continue;
      }
      left[index] = this.left[this.read];
      right[index] = this.right[this.read];
      this.read += 1;
      if (this.read === this.capacity) this.read = 0;
    }
    return true;
  }
}
registerProcessor('telinha-pcm', TelinhaPcm);
`;

export function targetHeightForQuality(quality: CaptureQuality): number {
  if (quality === '720') return 720;
  if (quality === '1080') return 1080;
  return 0;
}

export function streamConfigForShare(request: NativeShareRequest): StreamConfig {
  return {
    resolution: request.quality === '720' ? '720' : request.quality === '1080' ? '1080' : '2160',
    frameRate: request.fps,
    audio: request.captureAudio,
    audioMode: request.captureAudio ? 'system' : 'off',
  };
}

export async function listCaptureSources(): Promise<CaptureSource[]> {
  const sources = await invoke<CaptureSource[]>('list_capture_sources');
  return sources.filter((source) => source.kind === 'window' || source.kind === 'monitor');
}

/** BGRA na textura WebGL, com R e B trocados no shader, e PCM no worklet. */
export async function openNativeCapture(request: NativeShareRequest): Promise<MediaStream> {
  const session = await invoke<SessionInfo>('start_native_capture', {
    sourceId: request.sourceId,
    kind: request.kind,
    targetHeight: targetHeightForQuality(request.quality),
    fps: request.fps,
    captureAudio: request.captureAudio,
  });
  try {
    return await mountSession(session, request.fps);
  } catch (error) {
    await invoke('stop_native_capture', { sessionId: session.sessionId }).catch(() => {});
    throw error;
  }
}

async function mountSession(session: SessionInfo, fps: number): Promise<MediaStream> {
  const canvas = document.createElement('canvas');
  canvas.width = session.width > 0 ? session.width : 1280;
  canvas.height = session.height > 0 ? session.height : 720;
  const surface = createFrameDrawer(canvas);

  const manualFrames = typeof CanvasCaptureMediaStreamTrack !== 'undefined';
  const videoTrack = canvas.captureStream(manualFrames ? 0 : fps).getVideoTracks()[0];
  if (!videoTrack) throw new Error('A captura não gerou faixa de vídeo.');
  videoTrack.contentHint = 'motion';

  const videoLink = connectSocket(session.videoUrl);
  const videoSocket = videoLink.socket;
  const draw = (bytes: Uint8Array) => {
    try {
      const frame = readRgbaFrame(bytes);
      if (!frame) return;
      surface.draw(frame.width, frame.height, frame.pixels);
      const requester = videoTrack as CanvasCaptureMediaStreamTrack;
      if (typeof requester.requestFrame === 'function') requester.requestFrame();
    } finally {
      if (videoSocket.readyState === WebSocket.OPEN) videoSocket.send(new Uint8Array([1]));
    }
  };
  videoSocket.addEventListener('message', (event) => {
    const bytes = asBytes(event.data);
    if (bytes) draw(bytes);
    else if (videoSocket.readyState === WebSocket.OPEN) videoSocket.send(new Uint8Array([1]));
  });
  await videoLink.opened;

  let audioCtx: AudioContext | null = null;
  let destination: MediaStreamAudioDestinationNode | null = null;
  let audioSocket: WebSocket | null = null;
  if (session.audio && session.audioUrl && session.sampleRate === PCM_RATE && session.channels === PCM_CHANNELS) {
    try {
      const audio = await attachPcm();
      audioCtx = audio.context;
      destination = audio.destination;
      const audioLink = connectSocket(session.audioUrl);
      audioSocket = audioLink.socket;
      audioSocket.addEventListener('message', (event) => {
        const pcm = asPcmBuffer(event.data);
        if (pcm) audio.push(pcm);
      });
      await audioLink.opened;
    } catch (error) {
      console.warn('[captura] áudio nativo indisponível:', error);
    }
  }

  let closed = false;
  const shutdown = () => {
    if (closed) return;
    closed = true;
    try { videoSocket.close(); } catch { /* já fechado */ }
    try { audioSocket?.close(); } catch { /* já fechado */ }
    void audioCtx?.close().catch(() => {});
    void invoke('stop_native_capture', { sessionId: session.sessionId }).catch(() => {});
  };
  videoSocket.addEventListener('close', () => {
    if (!closed) shutdown();
  });

  const originalStop = videoTrack.stop.bind(videoTrack);
  videoTrack.stop = () => {
    shutdown();
    originalStop();
  };

  const tracks: MediaStreamTrack[] = [videoTrack];
  const audioTrack = destination?.stream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.contentHint = 'music';
    tracks.push(audioTrack);
  }
  return new MediaStream(tracks);
}

function connectSocket(url: string): { socket: WebSocket; opened: Promise<void> } {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const opened = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      socket.close();
      reject(new Error('A captura local não conectou.'));
    }, 8000);
    socket.addEventListener('open', () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      window.clearTimeout(timer);
      reject(new Error('Não foi possível ligar a captura local.'));
    }, { once: true });
  });
  return { socket, opened };
}

async function attachPcm(): Promise<{
  context: AudioContext;
  destination: MediaStreamAudioDestinationNode;
  push: (pcm: ArrayBuffer) => void;
}> {
  const context = new AudioContext({ sampleRate: PCM_RATE, latencyHint: 'interactive' });
  if (context.sampleRate !== PCM_RATE) {
    await context.close().catch(() => {});
    throw new Error('O navegador não abriu o áudio em 48 kHz.');
  }
  const url = URL.createObjectURL(new Blob([PCM_WORKLET], { type: 'application/javascript' }));
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(context, 'telinha-pcm', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [PCM_CHANNELS],
    channelCount: PCM_CHANNELS,
    channelCountMode: 'explicit',
    channelInterpretation: 'discrete',
  });
  const destination = context.createMediaStreamDestination();
  try {
    destination.channelCount = PCM_CHANNELS;
    destination.channelCountMode = 'explicit';
    destination.channelInterpretation = 'discrete';
  } catch {
    // O destino segue no arranjo padrão do navegador.
  }
  node.connect(destination);
  const push = (pcm: ArrayBuffer) => {
    node.port.postMessage(pcm, [pcm]);
  };
  await context.resume();
  return { context, destination, push };
}

export function readRgbaFrame(bytes: Uint8Array): { width: number; height: number; pixels: Uint8ClampedArray } | null {
  if (bytes.byteLength < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return null;
  const size = width * height * 4;
  if (bytes.byteLength < 8 + size) return null;
  return {
    width,
    height,
    pixels: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, size),
  };
}

function asBytes(message: unknown): Uint8Array | null {
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (message instanceof Uint8Array) return message;
  if (ArrayBuffer.isView(message)) {
    return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  }
  return null;
}

function asPcmBuffer(message: unknown): ArrayBuffer | null {
  if (message instanceof ArrayBuffer) return message.byteLength >= 8 ? message : null;
  if (!ArrayBuffer.isView(message) || message.byteLength < 8) return null;
  const copy = new ArrayBuffer(message.byteLength);
  new Uint8Array(copy).set(new Uint8Array(message.buffer, message.byteOffset, message.byteLength));
  return copy;
}
