import { useState } from 'react';
import type { AudioMode } from '../lib/diagnostics/audio';
import { loadSettings, type BotecaoSettings } from './SettingsModal';

export interface StreamConfig {
  resolution: '2160' | '1080' | '720' | '480';
  frameRate: 30 | 15 | 5;
  audio: boolean;
  audioMode: AudioMode;
}

const AUDIO_MODES: { value: AudioMode; label: string; desc: string }[] = [
  { value: 'off', label: 'Sem áudio', desc: 'Só vídeo.' },
  { value: 'source', label: 'Áudio da aba', desc: 'Padrão. Som da guia. Janela e tela inteira saem sem áudio global.' },
  { value: 'system', label: 'Áudio de todo o Windows', desc: 'Separado do padrão. Só quando a superfície for a tela inteira.' },
];

/** Lista de resoluções — reutilizada pelo ResolutionControl (troca durante a live). */
export const RESOLUTIONS = [
  { value: '2160', label: '4K', desc: '2160p' },
  { value: '1080', label: 'Full HD', desc: '1080p' },
  { value: '720', label: 'HD', desc: '720p' },
  { value: '480', label: 'SD', desc: '480p' },
] as const;

const FRAMERATES = [
  { value: 30, label: '30 FPS', desc: 'Fluido' },
  { value: 15, label: '15 FPS', desc: 'Moderado' },
  { value: 5, label: '5 FPS', desc: 'Slides' },
] as const;

/** Map SettingsModal resolution format to StreamConfig format */
function settingsResToStreamRes(res: BotecaoSettings['resolution']): StreamConfig['resolution'] {
  return res.replace('p', '') as StreamConfig['resolution'];
}

interface StreamSettingsProps {
  onStart: (config: StreamConfig) => void;
  onCancel: () => void;
}

export default function StreamSettings({ onStart, onCancel }: StreamSettingsProps) {
  // Load saved settings from localStorage
  const saved = loadSettings();
  const [resolution, setResolution] = useState<StreamConfig['resolution']>(settingsResToStreamRes(saved.resolution));
  const [frameRate, setFrameRate] = useState<StreamConfig['frameRate']>(saved.fps);
  const [audioMode, setAudioMode] = useState<AudioMode>(saved.audioMode);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-container border border-outline-variant/30 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto mx-4 p-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-[20px] text-primary">screen_share</span>
          </div>
          <div>
            <h2 className="text-base font-sans font-semibold text-on-surface">Configurar transmissão</h2>
            <p className="text-outline font-body text-xs">Ajuste antes de compartilhar sua tela</p>
          </div>
        </div>

        {/* Resolution */}
        <div className="mb-4">
          <label className="block text-xs font-body font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
            Resolução
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {RESOLUTIONS.map((r) => (
              <button
                key={r.value}
                onClick={() => setResolution(r.value)}
                className={`px-2 py-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                  resolution === r.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-outline-variant/20 bg-surface-container-high/40 text-on-surface hover:bg-surface-container-high hover:border-outline-variant/40'
                }`}
              >
                <span className="block text-sm font-sans font-semibold">{r.label}</span>
                <span className="block text-[10px] font-body opacity-60 mt-0.5">{r.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Frame rate */}
        <div className="mb-4">
          <label className="block text-xs font-body font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
            Taxa de quadros
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {FRAMERATES.map((f) => (
              <button
                key={f.value}
                onClick={() => setFrameRate(f.value)}
                className={`px-2 py-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                  frameRate === f.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-outline-variant/20 bg-surface-container-high/40 text-on-surface hover:bg-surface-container-high hover:border-outline-variant/40'
                }`}
              >
                <span className="block text-sm font-sans font-semibold">{f.label}</span>
                <span className="block text-[10px] font-body opacity-60 mt-0.5">{f.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5 flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-outline">Áudio</span>
          {AUDIO_MODES.map((opt) => {
            const active = audioMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAudioMode(opt.value)}
                className={`flex flex-col items-start w-full px-3 py-2.5 rounded-xl text-left transition-all cursor-pointer ${
                  active
                    ? 'border-2 border-primary bg-primary/10'
                    : 'border border-outline-variant/20 bg-surface-container-high/40 hover:bg-surface-container-high'
                }`}
              >
                <span className="block text-sm font-body font-medium text-on-surface">{opt.label}</span>
                <span className="block text-[11px] font-body text-outline">{opt.desc}</span>
              </button>
            );
          })}
          <p className="text-[11px] leading-snug text-outline">
            Aba: marque “Compartilhar áudio da guia”. Janela: o vídeo sai sem áudio. Tela inteira só leva o som do Windows no modo separado. Não usa microfone.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl border border-outline-variant/20 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all text-sm font-body font-medium cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={() => onStart({ resolution, frameRate, audio: audioMode !== 'off', audioMode })}
            className="flex-1 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary-container transition-all text-sm font-body font-semibold cursor-pointer shadow-sm"
          >
            Compartilhar
          </button>
        </div>
      </div>
    </div>
  );
}
