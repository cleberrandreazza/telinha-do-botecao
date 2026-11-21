import type { PeerInfo, StreamInfo } from './types';

const MOCK_USERS = [
  { nickname: 'Matheus', color: '#e74c3c' },
  { nickname: 'Lucas',   color: '#3498db' },
  { nickname: 'Bia',     color: '#9b59b6' },
  { nickname: 'Thiago',  color: '#2ecc71' },
  { nickname: 'Carol',   color: '#f39c12' },
];

/** Create a fake MediaStream from a canvas with animated content */
function createFakeStream(label: string, color: string): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;

  let frame = 0;
  const draw = () => {
    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, color);
    grad.addColorStop(1, shiftColor(color, 40));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Animated circles
    for (let i = 0; i < 5; i++) {
      const x = canvas.width / 2 + Math.cos((frame + i * 72) * 0.02) * 300;
      const y = canvas.height / 2 + Math.sin((frame + i * 50) * 0.015) * 150;
      ctx.beginPath();
      ctx.arc(x, y, 40 + i * 10, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.08 + i * 0.03})`;
      ctx.fill();
    }

    // Grid lines (fake desktop)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Fake window
    const winX = 120;
    const winY = 100;
    const winW = canvas.width - 240;
    const winH = canvas.height - 200;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.roundRect(winX, winY, winW, winH, 12);
    ctx.fill();

    // Window title bar
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.roundRect(winX, winY, winW, 36, [12, 12, 0, 0]);
    ctx.fill();

    // Window dots
    const dots = ['#ff5f56', '#ffbd2e', '#27c93f'];
    dots.forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(winX + 20 + i * 20, winY + 18, 5, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    });

    // Label text
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Tela de ${label}`, canvas.width / 2, canvas.height / 2 - 10);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(`Mock Stream · 1280×720`, canvas.width / 2, canvas.height / 2 + 30);

    // Animated clock
    const now = new Date();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '16px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(now.toLocaleTimeString(), canvas.width - 40, canvas.height - 30);

    frame++;
    requestAnimationFrame(draw);
  };

  draw();

  return canvas.captureStream(30);
}

function shiftColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export interface MockData {
  peers: PeerInfo[];
  streams: StreamInfo[];
  myPeerId: string;
  roomCode: string;
  nickname: string;
}

export function isMockMode(): boolean {
  return new URLSearchParams(window.location.search).has('mock');
}

export function generateMockData(): MockData {
  const myPeerId = 'mock-self';
  const nickname = 'Você (Dev)';
  const roomCode = 'MOCK42';

  const peers: PeerInfo[] = [
    { id: myPeerId, nickname, isSharing: false },
    ...MOCK_USERS.map((u, i) => ({
      id: `mock-${i}`,
      nickname: u.nickname,
      isSharing: false, // Start not sharing — will flip when streams arrive
    })),
  ];

  // Streams start empty — will be filled after delay
  const streams: StreamInfo[] = [];

  return { peers, streams, myPeerId, roomCode, nickname };
}

/** Generate streams with a delay to simulate loading.
 *  Also returns the peerIds so App can flip isSharing on those peers. */
export function generateMockStreamsDelayed(
  onReady: (streams: StreamInfo[], peerIds: string[]) => void,
  delayMs: number = 5000,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    const peerIds: string[] = [];
    const streams: StreamInfo[] = MOCK_USERS.map((u, i) => {
      const peerId = `mock-${i}`;
      peerIds.push(peerId);
      return {
        peerId,
        stream: createFakeStream(u.nickname, u.color),
        nickname: u.nickname,
      };
    });
    onReady(streams, peerIds);
  }, delayMs);
}
