import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DESKTOP_APP_DOWNLOAD_URL,
  clampWebPreset,
  hasDesktopRelay,
  webShareNeedsDesktopPrompt,
  webViewerShouldSuggestDesktop,
} from './desktopPrompt.ts';

const web = (id: string) => ({ id, isDesktop: false });
const desktop = (id: string) => ({ id, isDesktop: true });

test('o download aponta para o executável da última release', () => {
  assert.equal(
    DESKTOP_APP_DOWNLOAD_URL,
    'https://github.com/cleberrandreazza/telinha-do-botecao/releases/latest/download/telinha-do-botecao.exe',
  );
});

test('um espectador continua no P2P direto, sem pedir o app', () => {
  assert.equal(webShareNeedsDesktopPrompt({
    isDesktopApp: false,
    myPeerId: 'eu',
    peers: [web('eu'), web('a')],
  }), false);
});

test('dois espectadores Web pedem o app antes de transmitir', () => {
  assert.equal(webShareNeedsDesktopPrompt({
    isDesktopApp: false,
    myPeerId: 'eu',
    peers: [web('eu'), web('a'), web('b')],
  }), true);
  assert.equal(hasDesktopRelay([web('eu'), web('a'), web('b')], 'eu'), false);
});

test('um desktop na sala dispensa o aviso e serve de relay', () => {
  assert.equal(webShareNeedsDesktopPrompt({
    isDesktopApp: false,
    myPeerId: 'eu',
    peers: [web('eu'), desktop('a'), web('b')],
  }), false);
});

test('o app desktop nunca pede para baixar o próprio executável', () => {
  assert.equal(webShareNeedsDesktopPrompt({
    isDesktopApp: true,
    myPeerId: 'eu',
    peers: [desktop('eu'), web('a'), web('b'), web('c')],
  }), false);
  assert.equal(webViewerShouldSuggestDesktop({
    isDesktopApp: true,
    isSharing: false,
    peers: [desktop('eu'), web('a'), web('b')],
  }), false);
});

test('espectador Web em sala cheia só de navegador vê o convite', () => {
  assert.equal(webViewerShouldSuggestDesktop({
    isDesktopApp: false,
    isSharing: false,
    peers: [web('eu'), web('a'), web('b')],
  }), true);
});

test('sala com relay desktop ou com quem já transmite não mostra o aviso de espectador', () => {
  assert.equal(webViewerShouldSuggestDesktop({
    isDesktopApp: false,
    isSharing: false,
    peers: [web('eu'), desktop('a'), web('b')],
  }), false);
  assert.equal(webViewerShouldSuggestDesktop({
    isDesktopApp: false,
    isSharing: true,
    peers: [web('eu'), web('a'), web('b')],
  }), false);
  assert.equal(webViewerShouldSuggestDesktop({
    isDesktopApp: false,
    isSharing: false,
    peers: [web('eu'), web('a')],
  }), false);
});

test('sem relay o preset da Web não passa de 720p e 30 fps', () => {
  assert.deepEqual(clampWebPreset('1080', 60, true), { resolution: '720', frameRate: 30 });
  assert.deepEqual(clampWebPreset('2160', 30, true), { resolution: '720', frameRate: 30 });
  assert.deepEqual(clampWebPreset('480', 15, true), { resolution: '480', frameRate: 15 });
  assert.deepEqual(clampWebPreset('1080', 60, false), { resolution: '1080', frameRate: 60 });
});
