import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectScreenShareSupport,
  isMobileUserAgent,
  contentHintForSurface,
  orderVideoCodecs,
  captureLimitNotice,
  captureVideoConstraints,
  captureFrameRateConstraints,
  isScreenShareCancellation,
  SHARE_CANCEL_NOTICE,
} from './screenShare.ts';

const DESKTOP_SECURE = {
  secureContext: true,
  hasMediaDevices: true,
  hasGetDisplayMedia: true,
  isMobile: false,
};

test('navegador de computador em localhost suporta compartilhamento', () => {
  const support = detectScreenShareSupport(DESKTOP_SECURE);
  assert.equal(support.supported, true);
  assert.equal(support.reason, null);
  assert.equal(support.message, '');
});

test('celular sem getDisplayMedia e tratado como plataforma sem suporte', () => {
  const support = detectScreenShareSupport({
    secureContext: false,
    hasMediaDevices: false,
    hasGetDisplayMedia: false,
    isMobile: true,
  });
  assert.equal(support.supported, false);
  assert.equal(support.reason, 'unsupported-platform');
  assert.ok(/navegadores de computador/i.test(support.message));
});

test('computador em http sem HTTPS e tratado como contexto inseguro', () => {
  const support = detectScreenShareSupport({
    secureContext: false,
    hasMediaDevices: false,
    hasGetDisplayMedia: false,
    isMobile: false,
  });
  assert.equal(support.supported, false);
  assert.equal(support.reason, 'insecure-context');
  assert.ok(/localhost/i.test(support.message));
});

test('navegador sem a API em contexto seguro cai em missing-api', () => {
  const support = detectScreenShareSupport({
    secureContext: true,
    hasMediaDevices: true,
    hasGetDisplayMedia: false,
    isMobile: false,
  });
  assert.equal(support.supported, false);
  assert.equal(support.reason, 'missing-api');
});

test('getDisplayMedia presente mas contexto inseguro nao passa', () => {
  const support = detectScreenShareSupport({
    secureContext: false,
    hasMediaDevices: true,
    hasGetDisplayMedia: true,
    isMobile: false,
  });
  assert.equal(support.supported, false);
  assert.equal(support.reason, 'insecure-context');
});

test('detecta user agent de celular', () => {
  assert.equal(isMobileUserAgent('Mozilla/5.0 (Linux; Android 14) Mobile Safari'), true);
  assert.equal(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), true);
  assert.equal(isMobileUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'), false);
});

test('aba e janela usam hint de motion para segurar 30 fps', () => {
  assert.equal(contentHintForSurface('browser'), 'motion');
  assert.equal(contentHintForSurface('window'), 'motion');
});

test('tela inteira continua com hint de motion', () => {
  assert.equal(contentHintForSurface('monitor'), 'motion');
});

test('VP9 fica na frente e H.264 logo atrás, com RTX no codec certo', () => {
  const ordered = orderVideoCodecs([
    { mimeType: 'video/VP8', preferredPayloadType: 96 },
    { mimeType: 'video/rtx', preferredPayloadType: 97, sdpFmtpLine: 'apt=96' },
    { mimeType: 'video/H264', preferredPayloadType: 102 },
    { mimeType: 'video/rtx', preferredPayloadType: 103, sdpFmtpLine: 'apt=102' },
    { mimeType: 'video/VP9', preferredPayloadType: 98 },
    { mimeType: 'video/rtx', preferredPayloadType: 99, sdpFmtpLine: 'apt=98' },
  ]);
  assert.deepEqual(ordered.map((codec) => codec.preferredPayloadType), [98, 99, 102, 103, 96, 97]);
});

test('sem VP9 a lista começa no H.264', () => {
  const ordered = orderVideoCodecs([
    { mimeType: 'video/VP8', preferredPayloadType: 96 },
    { mimeType: 'video/H264', preferredPayloadType: 102 },
  ]);
  assert.deepEqual(ordered.map((codec) => codec.mimeType), ['video/H264', 'video/VP8']);
});

test('superficie desconhecida nao muda o comportamento anterior', () => {
  assert.equal(contentHintForSurface(null), 'motion');
});

test('captura menor que o alvo gera aviso com os numeros reais', () => {
  const notice = captureLimitNotice(
    { width: 510, height: 230 },
    { width: 1920, height: 1080 },
    'browser',
  );
  assert.ok(notice !== null);
  assert.ok(/510×230/.test(String(notice)));
  assert.ok(/resolução nativa/.test(String(notice)));
  assert.ok(/sem esticar/.test(String(notice)));
  assert.ok(!/menor que o alvo/.test(String(notice)));
});

test('captura do tamanho do alvo nao gera aviso', () => {
  assert.equal(
    captureLimitNotice({ width: 1920, height: 1080 }, { width: 1920, height: 1080 }, 'browser'),
    null,
  );
});

test('sem medicao nao ha aviso (nada e estimado)', () => {
  assert.equal(captureLimitNotice(null, { width: 1920, height: 1080 }, 'browser'), null);
  assert.equal(captureLimitNotice({ width: 510, height: 230 }, null, 'browser'), null);
});

test('janela mais alta que 16:9 que alcanca a altura do alvo nao gera aviso', () => {
  assert.equal(
    captureLimitNotice({ width: 1440, height: 1080 }, { width: 1920, height: 1080 }, 'window'),
    null,
  );
});

test('janela pequena nos dois lados gera aviso', () => {
  const notice = captureLimitNotice({ width: 1280, height: 720 }, { width: 1920, height: 1080 }, 'window');
  assert.ok(/A janela está sendo transmitida na resolução nativa \(1280×720\), sem esticar/.test(String(notice)));
});

test('tela inteira limita só a altura, sem teto de largura', () => {
  const constraints = captureVideoConstraints({ width: 1920, height: 1080 }, 30);
  assert.deepEqual(constraints, {
    height: { max: 1080 },
    frameRate: { ideal: 30, max: 30 },
  });
  assert.equal('width' in constraints, false);
  assert.ok(!('ideal' in constraints.height));
});

test('pedido inicial, janela e aba levam só a taxa de quadros', () => {
  const constraints = captureFrameRateConstraints(30);
  assert.deepEqual(constraints, { frameRate: { ideal: 30, max: 30 } });
  assert.equal('width' in constraints, false);
  assert.equal('height' in constraints, false);
});

test('cancelar o seletor nativo e reconhecido pelo NotAllowedError', () => {
  const err = new Error('Permission denied');
  err.name = 'NotAllowedError';
  assert.equal(isScreenShareCancellation(err), true);
});

test('cancelamento tambem e reconhecido em erro que nao e Error', () => {
  assert.equal(isScreenShareCancellation({ name: 'NotAllowedError' }), true);
  assert.equal(isScreenShareCancellation({ name: 'NotAllowedError', message: 'x' }), true);
});

test('falha de captura real nao vira cancelamento', () => {
  const notReadable = new Error('Track start failed');
  notReadable.name = 'NotReadableError';
  assert.equal(isScreenShareCancellation(notReadable), false);

  const notSupported = new Error('unsupported');
  notSupported.name = 'NotSupportedError';
  assert.equal(isScreenShareCancellation(notSupported), false);

  assert.equal(isScreenShareCancellation(new Error('sem name de erro')), false);
  assert.equal(isScreenShareCancellation(undefined), false);
  assert.equal(isScreenShareCancellation(null), false);
  assert.equal(isScreenShareCancellation('NotAllowedError'), false);
});

test('aviso de cancelamento diz que nada foi transmitido', () => {
  assert.ok(/cancelado/i.test(SHARE_CANCEL_NOTICE));
  assert.ok(/nada foi transmitido/i.test(SHARE_CANCEL_NOTICE));
});
