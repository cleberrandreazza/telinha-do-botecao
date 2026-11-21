import { useState } from 'react';
import { loadSettings, type BotecaoSettings } from './SettingsModal';

export interface StreamConfig {
  resolution: '2160' | '1080' | '720' | '480';
  frameRate: 30 | 15 | 5;
  audio: boolean;
}

const RESOLUTIONS = [
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
  const [audio, setAudio] = useState(saved.shareAudio);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-container border border-outline-variant/30 rounded-2xl w-full max-w-md mx-4 p-5 shadow-2xl">
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

        {/* Audio toggle */}
        <div className="mb-5">
          <button
            onClick={() => setAudio(!audio)}
            className="flex items-center justify-between w-full px-3 py-2.5 rounded-xl border border-outline-variant/20 bg-surface-container-high/40 hover:bg-surface-container-high transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
                {audio ? 'volume_up' : 'volume_off'}
              </span>
              <div className="text-left">
                <span className="block text-sm font-body font-medium text-on-surface">Compartilhar áudio</span>
                <span className="block text-[11px] font-body text-outline">Aba ou sistema. Não usa microfone.</span>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                className="sr-only peer"
                checked={audio}
                onChange={(e) => setAudio(e.target.checked)}
              />
              <div className="w-11 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-container peer-checked:after:bg-on-primary" />
            </label>
          </button>
          <p className="mt-2 text-[11px] leading-snug text-outline">
            Aba do Chrome ou Edge: marque “Compartilhar áudio da guia”. Tela inteira: marque “Compartilhar áudio do sistema”. Uma janela, no Windows, em geral não entrega áudio — o seletor simplesmente não oferece a opção.
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
            onClick={() => onStart({ resolution, frameRate, audio })}
            className="flex-1 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary-container transition-all text-sm font-body font-semibold cursor-pointer shadow-sm"
          >
            Compartilhar
          </button>
        </div>
      </div>
    </div>
  );
}
