import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectScreenShareSupport,
  isMobileUserAgent,
  contentHintForSurface,
  captureLimitNotice,
  scaleFactorForCapture,
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

test('aba do navegador usa hint de detail (texto e interface)', () => {
  assert.equal(contentHintForSurface('browser'), 'detail');
});

test('tela e janela continuam com hint de motion', () => {
  assert.equal(contentHintForSurface('monitor'), 'motion');
  assert.equal(contentHintForSurface('window'), 'motion');
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
  assert.ok(/maximize/i.test(String(notice)));
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

test('captura menor que o alvo nao recebe downscale (nada de reduzir duas vezes)', () => {
  assert.equal(scaleFactorForCapture(510, { width: 1920, height: 1080 }), 1);
});

test('captura do tamanho do alvo nao recebe downscale', () => {
  assert.equal(scaleFactorForCapture(1920, { width: 1920, height: 1080 }), 1);
});

test('captura maior que o alvo reduz pela razao medida', () => {
  assert.equal(scaleFactorForCapture(3840, { width: 1920, height: 1080 }), 2);
  assert.equal(scaleFactorForCapture(2560, { width: 1920, height: 1080 }), 1.33);
});

test('sem medicao ou sem alvo o fator fica em 1 (nada e estimado)', () => {
  assert.equal(scaleFactorForCapture(null, { width: 1920, height: 1080 }), 1);
  assert.equal(scaleFactorForCapture(3840, null), 1);
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
