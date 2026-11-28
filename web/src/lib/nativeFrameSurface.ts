/** Quadro BGRA do WebSocket local. O shader troca R e B na GPU. */

export const FRAME_GL_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  premultipliedAlpha: false,
  powerPreference: 'high-performance',
};

/** O BGRA do Rust começa na linha de cima. O clip do WebGL tem Y para cima. */
export const FRAME_VERTEX_SHADER = `
attribute vec2 aPos;
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = vec2(aUv.x, 1.0 - aUv.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const FRAME_FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uFrame;
void main() {
  vec4 texel = texture2D(uFrame, vUv);
  gl_FragColor = vec4(texel.b, texel.g, texel.r, 1.0);
}
`;

const QUAD = new Float32Array([
  -1, -1, 0, 0,
  1, -1, 1, 0,
  -1, 1, 0, 1,
  1, 1, 1, 1,
]);

export type FrameContextKind = 'webgl2' | 'webgl' | '2d';

export interface FrameDrawer {
  kind: FrameContextKind;
  draw(width: number, height: number, pixels: ArrayBufferView): void;
}

type ContextHost = {
  getContext(kind: string, attrs?: unknown): unknown;
};

export function pickFrameContext(canvas: ContextHost): { kind: FrameContextKind; context: object } | null {
  const gl2 = canvas.getContext('webgl2', FRAME_GL_ATTRIBUTES);
  if (isObject(gl2)) return { kind: 'webgl2', context: gl2 };
  const gl = canvas.getContext('webgl', FRAME_GL_ATTRIBUTES);
  if (isObject(gl)) return { kind: 'webgl', context: gl };
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (isObject(ctx)) return { kind: '2d', context: ctx };
  return null;
}

export function createFrameDrawer(canvas: HTMLCanvasElement): FrameDrawer {
  const picked = pickFrameContext(canvas);
  if (!picked) throw new Error('Não foi possível criar o quadro da captura.');
  if (picked.kind === '2d') {
    return new Canvas2dDrawer(canvas, picked.context as CanvasRenderingContext2D);
  }
  return new GlFrameDrawer(canvas, picked.context as WebGLRenderingContext, picked.kind);
}

export function createGlFrameDrawer(
  gl: WebGLRenderingContext,
  canvas: { width: number; height: number },
  kind: 'webgl2' | 'webgl' = 'webgl2',
): FrameDrawer {
  return new GlFrameDrawer(canvas, gl, kind);
}

class GlFrameDrawer implements FrameDrawer {
  readonly kind: 'webgl2' | 'webgl';
  private textureWidth = 0;
  private textureHeight = 0;
  private readonly canvas: { width: number; height: number };
  private readonly gl: WebGLRenderingContext;
  private readonly texture: WebGLTexture;

  constructor(
    canvas: { width: number; height: number },
    gl: WebGLRenderingContext,
    kind: 'webgl2' | 'webgl',
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.kind = kind;
    const program = linkProgram(gl, FRAME_VERTEX_SHADER, FRAME_FRAGMENT_SHADER);
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Não foi possível criar o quadro da captura.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    const stride = 4 * 4;
    bindAttrib(gl, program, 'aPos', 2, stride, 0);
    bindAttrib(gl, program, 'aUv', 2, stride, 8);
    const texture = gl.createTexture();
    if (!texture) throw new Error('Não foi possível criar o quadro da captura.');
    this.texture = texture;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    const sampler = gl.getUniformLocation(program, 'uFrame');
    gl.uniform1i(sampler, 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  draw(width: number, height: number, pixels: ArrayBufferView): void {
    const { gl } = this;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const sameSize = this.textureWidth === width && this.textureHeight === height;
    if (sameSize) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      this.textureWidth = width;
      this.textureHeight = height;
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

class Canvas2dDrawer implements FrameDrawer {
  readonly kind = '2d' as const;
  private image: ImageData | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas;
    this.ctx = ctx;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  draw(width: number, height: number, pixels: ArrayBufferView): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.image = null;
    }
    const view = pixels instanceof Uint8ClampedArray
      ? pixels
      : new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    if (!this.image || this.image.width !== width || this.image.height !== height) {
      this.image = new ImageData(width, height);
    }
    const dest = this.image.data;
    for (let index = 0; index + 3 < view.length; index += 4) {
      dest[index] = view[index + 2];
      dest[index + 1] = view[index + 1];
      dest[index + 2] = view[index];
      dest[index + 3] = view[index + 3];
    }
    this.ctx.putImageData(this.image, 0, 0);
  }
}

function linkProgram(gl: WebGLRenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Não foi possível criar o quadro da captura.');
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.bindAttribLocation(program, 1, 'aUv');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'Não foi possível criar o quadro da captura.');
  }
  return program;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Não foi possível criar o quadro da captura.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'Não foi possível criar o quadro da captura.');
  }
  return shader;
}

function bindAttrib(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  name: string,
  size: number,
  stride: number,
  offset: number,
): void {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) throw new Error('Não foi possível criar o quadro da captura.');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
