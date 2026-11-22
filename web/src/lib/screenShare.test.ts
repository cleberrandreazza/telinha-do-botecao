import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectScreenShareSupport, isMobileUserAgent } from './screenShare.ts';

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
