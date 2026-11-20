import { useState, useEffect } from 'react';
import type { StreamInfo } from '../lib/types';
import VideoPlayer from './VideoPlayer';

interface VideoGridProps {
  streams: StreamInfo[];
  localStream: MediaStream | null;
  localNickname: string;
}

interface StreamEntry {
  id: string;
  stream: MediaStream;
  nickname: string;
  isLocal: boolean;
}

export default function VideoGrid({ streams, localStream, localNickname }: VideoGridProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Monta lista unificada de todas as streams
  const allStreams: StreamEntry[] = [];

  if (localStream) {
    allStreams.push({ id: '__local__', stream: localStream, nickname: localNickname, isLocal: true });
  }

  for (const s of streams) {
    allStreams.push({ id: s.peerId, stream: s.stream, nickname: s.nickname, isLocal: false });
  }

  // Auto-seleciona a primeira stream se nenhuma selecionada ou se a selecionada saiu
  useEffect(() => {
    if (allStreams.length === 0) {
      setSelectedId(null);
      return;
    }
    const exists = allStreams.some(s => s.id === selectedId);
    if (!exists) {
      // Prefere a primeira remota, senão a local
      const remote = allStreams.find(s => !s.isLocal);
      setSelectedId(remote?.id ?? allStreams[0].id);
    }
  }, [allStreams.length, streams.length, selectedId]);

  if (allStreams.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-dark-200/60">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <p className="text-lg">Nenhuma tela sendo compartilhada</p>
          <p className="text-sm mt-1">Clique em &quot;Compartilhar Tela&quot; para começar</p>
        </div>
      </div>
    );
  }

  // Se só tem uma stream, mostra ela em tela cheia sem thumbnails
  if (allStreams.length === 1) {
    const s = allStreams[0];
    return (
      <div className="flex-1 flex flex-col p-3">
        <div className="flex-1 min-h-0">
          <VideoPlayer stream={s.stream} nickname={s.nickname} isLocal={s.isLocal} />
        </div>
      </div>
    );
  }

  const main = allStreams.find(s => s.id === selectedId) ?? allStreams[0];
  const others = allStreams.filter(s => s.id !== main.id);

  return (
    <div className="flex-1 flex flex-col p-3 gap-3 min-h-0">
      {/* Vídeo principal */}
      <div className="flex-1 min-h-0">
        <VideoPlayer
          key={main.id}
          stream={main.stream}
          nickname={main.nickname}
          isLocal={main.isLocal}
        />
      </div>

      {/* Thumbnails dos outros participantes */}
      <div className="flex gap-2 overflow-x-auto pb-1 flex-shrink-0">
        {others.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            className="relative flex-shrink-0 w-40 h-24 md:w-48 md:h-28 rounded-lg overflow-hidden border-2 border-dark-800 hover:border-boteco-500 transition-colors group/thumb focus:outline-none focus:border-boteco-400"
            title={`Assistir ${s.nickname}`}
          >
            <video
              ref={(el) => { if (el && el.srcObject !== s.stream) el.srcObject = s.stream; }}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {/* Nome + badge */}
            <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 pulse-dot" />
                <span className="text-white text-xs font-medium truncate">
                  {s.nickname} {s.isLocal && '(você)'}
                </span>
              </div>
            </div>
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-boteco-500/0 group-hover/thumb:bg-boteco-500/10 transition-colors flex items-center justify-center">
              <svg className="w-8 h-8 text-white opacity-0 group-hover/thumb:opacity-80 transition-opacity drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
