import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FRAME_FRAGMENT_SHADER,
  FRAME_GL_ATTRIBUTES,
  FRAME_VERTEX_SHADER,
  createGlFrameDrawer,
  pickFrameContext,
} from './nativeFrameSurface.ts';

test('o contexto pede webgl2 opaco, sem antialias e sem preservar o buffer', () => {
  const calls: Array<{ kind: string; attrs: unknown }> = [];
  const picked = pickFrameContext({
    getContext(kind, attrs) {
      calls.push({ kind, attrs });
      return kind === 'webgl2' ? { gpu: true } : null;
    },
  });
  assert.equal(picked?.kind, 'webgl2');
  assert.deepEqual(calls, [{ kind: 'webgl2', attrs: FRAME_GL_ATTRIBUTES }]);
  assert.equal(FRAME_GL_ATTRIBUTES.preserveDrawingBuffer, false);
  assert.equal(FRAME_GL_ATTRIBUTES.alpha, false);
  assert.equal(FRAME_GL_ATTRIBUTES.antialias, false);
});

test('sem webgl o quadro cai para o canvas 2d', () => {
  const calls: string[] = [];
  const picked = pickFrameContext({
    getContext(kind) {
      calls.push(kind);
      return kind === '2d' ? { canvas2d: true } : null;
    },
  });
  assert.deepEqual(calls, ['webgl2', 'webgl', '2d']);
  assert.equal(picked?.kind, '2d');
});

test('o mesmo tamanho atualiza a textura com texSubImage2D e desenha o quad', () => {
  assert.equal(FRAME_VERTEX_SHADER.includes('1.0 - aUv.y'), true);
  assert.equal(FRAME_FRAGMENT_SHADER.includes('vec4(texel.b, texel.g, texel.r, 1.0)'), true);
  const { gl, calls } = fakeGl();
  const canvas = { width: 2, height: 2 };
  const drawer = createGlFrameDrawer(gl, canvas, 'webgl2');
  const first = new Uint8Array(2 * 2 * 4).fill(7);
  const second = new Uint8Array(2 * 2 * 4).fill(9);
  drawer.draw(2, 2, first);
  drawer.draw(2, 2, second);

  const images = calls.filter((call) => call.name === 'texImage2D');
  const subs = calls.filter((call) => call.name === 'texSubImage2D');
  const draws = calls.filter((call) => call.name === 'drawArrays');
  assert.equal(images.length, 1);
  assert.equal(subs.length, 1);
  assert.equal(images[0]?.args[2], gl.RGBA);
  assert.equal(images[0]?.args[6], gl.RGBA);
  assert.equal(images[0]?.args[7], gl.UNSIGNED_BYTE);
  assert.equal(images[0]?.args[8], first);
  assert.equal(subs[0]?.args[8], second);
  assert.equal(draws.length, 2);
  assert.deepEqual(draws[0]?.args, [gl.TRIANGLE_STRIP, 0, 4]);
  assert.equal(canvas.width, 2);
});

test('mudar a resolução volta a alocar a textura com texImage2D', () => {
  const { gl, calls } = fakeGl();
  const canvas = { width: 2, height: 2 };
  const drawer = createGlFrameDrawer(gl, canvas, 'webgl');
  drawer.draw(2, 2, new Uint8Array(16));
  calls.length = 0;
  drawer.draw(4, 2, new Uint8Array(32));
  assert.equal(calls.filter((call) => call.name === 'texImage2D').length, 1);
  assert.equal(calls.filter((call) => call.name === 'texSubImage2D').length, 0);
  assert.equal(canvas.width, 4);
  assert.equal(canvas.height, 2);
  const viewport = calls.find((call) => call.name === 'viewport');
  assert.deepEqual(viewport?.args, [0, 0, 4, 2]);
});

function fakeGl(): { gl: WebGLRenderingContext; calls: Array<{ name: string; args: unknown[] }> } {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
  };
  const gl = {
    TEXTURE_2D: 0x0de1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    TRIANGLE_STRIP: 5,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    COLOR_BUFFER_BIT: 0x4000,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE0: 0x84c0,
    UNPACK_ALIGNMENT: 0x0cf5,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => ({}),
    attachShader: () => {},
    bindAttribLocation: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    useProgram: () => {},
    getAttribLocation: (_program: unknown, name: string) => (name === 'aPos' ? 0 : 1),
    getUniformLocation: () => ({}),
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    createTexture: () => ({}),
    bindTexture: () => {},
    activeTexture: () => {},
    uniform1i: () => {},
    texParameteri: () => {},
    pixelStorei: () => {},
    viewport: record('viewport'),
    clearColor: () => {},
    clear: () => {},
    texImage2D: record('texImage2D'),
    texSubImage2D: record('texSubImage2D'),
    drawArrays: record('drawArrays'),
  };
  return { gl: gl as unknown as WebGLRenderingContext, calls };
}
