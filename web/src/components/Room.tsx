import { useState } from 'react';
import { formatCode, copyToClipboard } from '../lib/utils';
import type { PeerInfo, StreamInfo } from '../lib/types';
import VideoGrid from './VideoGrid';

interface RoomProps {
  code: string;
  myPeerId: string;
  nickname: string;
  peers: PeerInfo[];
  streams: StreamInfo[];
  localStream: MediaStream | null;
  isSharing: boolean;
  onStartSharing: () => void;
  onStopSharing: () => void;
  onLeaveRoom: () => void;
}

export default function Room({
  code,
  myPeerId,
  nickname,
  peers,
  streams,
  localStream,
  isSharing,
  onStartSharing,
  onStopSharing,
  onLeaveRoom,
}: RoomProps) {
  const [copied, setCopied] = useState(false);
  const [showPeers, setShowPeers] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-dark-900 border-b border-dark-800">
        <div className="flex items-center gap-4">
          {/* Logo mini */}
          <h1 className="text-lg font-bold hidden sm:block">
            <span className="text-boteco-400">Telinha</span>
            <span className="text-dark-200/60"> do </span>
            <span className="text-boteco-500">Botecão</span>
          </h1>

          {/* Room code */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-1.5 bg-dark-800 hover:bg-dark-800/80 rounded-lg border border-dark-800 hover:border-boteco-500 transition-colors group"
            title="Clique para copiar"
          >
            <span className="text-boteco-400 font-mono font-bold tracking-wider">
              {formatCode(code)}
            </span>
            <span className="text-dark-200/60 text-xs group-hover:text-boteco-400 transition-colors">
              {copied ? '✓ copiado!' : 'copiar'}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Peers counter */}
          <button
            onClick={() => setShowPeers(!showPeers)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 rounded-lg text-sm text-dark-200 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>{peers.length + 1}</span>
          </button>

          {/* Share button */}
          {isSharing ? (
            <button
              onClick={onStopSharing}
              className="flex items-center gap-2 px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
              Parar
            </button>
          ) : (
            <button
              onClick={onStartSharing}
              className="flex items-center gap-2 px-4 py-1.5 bg-boteco-600 hover:bg-boteco-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Compartilhar Tela
            </button>
          )}

          {/* Leave button */}
          <button
            onClick={onLeaveRoom}
            className="p-1.5 text-dark-200 hover:text-red-400 rounded-lg transition-colors"
            title="Sair da sala"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </header>

      {/* Peers sidebar (mobile-friendly dropdown) */}
      {showPeers && (
        <div className="bg-dark-900 border-b border-dark-800 px-4 py-2">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-boteco-600/20 border border-boteco-600/30 rounded-full text-xs text-boteco-400">
              {nickname} (você)
            </span>
            {peers.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 px-2 py-1 bg-dark-800 rounded-full text-xs text-dark-200"
              >
                {p.isSharing && <span className="w-1.5 h-1.5 rounded-full bg-red-500 pulse-dot" />}
                {p.nickname}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Video grid */}
      <VideoGrid
        streams={streams}
        localStream={localStream}
        localNickname={nickname}
      />
    </div>
  );
}
