import { useEffect, useRef, useState } from 'react';
import { describeCapture, readTrackSettings } from '../lib/diagnostics/index';

interface LocalPreviewProps {
  stream: MediaStream | null;
  nickname: string;
}

/**
 * Preview local de quem transmite: mostra a própria captura antes/durante
 * a live e a resolução real da track. Medida ausente fica "n/d".
 */
export default function LocalPreview({ stream, nickname }: LocalPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [capture, setCapture] = useState('n/d');

  // Liga a stream local no <video> (sem áudio, para não ecoar a própria voz)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => { /* autoplay bloqueado: o preview volta no próximo gesto */ });
    }
  }, [stream]);

  // Resolução e fps medidos na track — nada é estimado
  useEffect(() => {
    if (!stream) {
      setCapture('n/d');
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      setCapture('n/d');
      return;
    }
    const read = () => {
      let settings = null;
      try {
        settings = readTrackSettings(track.getSettings() as Record<string, unknown>);
      } catch {
        settings = null;
      }
      setCapture(describeCapture(settings));
    };
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [stream]);

  if (!stream) return null;

  return (
    <div className="absolute bottom-4 right-4 z-30 w-56 sm:w-64 rounded-2xl overflow-hidden border border-[#1f222e] bg-[#111318]/95 backdrop-blur-xl shadow-2xl">
      <div className="relative aspect-video bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-contain"
        />
        <div className="absolute inset-0 crt-scanlines pointer-events-none opacity-20" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_45%,rgba(0,0,0,0.6)_100%)] pointer-events-none" />
        <span className="absolute top-1.5 left-2 flex items-center gap-1.5 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] font-label-mono uppercase tracking-wider text-red-400">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          ao vivo
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-t border-[#1f222e]">
        <span className="text-[11px] text-on-surface font-medium truncate">
          Sua transmissão <span className="text-outline">· {nickname}</span>
        </span>
        <span className="font-label-mono text-[10px] text-primary shrink-0">{capture}</span>
      </div>
    </div>
  );
}
