import { useState } from 'react';

export interface StreamConfig {
  resolution: '2160' | '1080' | '720' | '480';
  frameRate: 30 | 15 | 5;
  audio: boolean;
}

const RESOLUTIONS = [
  { value: '2160', label: '4K (2160p)', desc: 'Máxima qualidade' },
  { value: '1080', label: 'Full HD (1080p)', desc: 'Recomendado' },
  { value: '720', label: 'HD (720p)', desc: 'Economiza banda' },
  { value: '480', label: 'SD (480p)', desc: 'Conexão lenta' },
] as const;

const FRAMERATES = [
  { value: 30, label: '30 FPS', desc: 'Fluido' },
  { value: 15, label: '15 FPS', desc: 'Moderado' },
  { value: 5, label: '5 FPS', desc: 'Só apresentação' },
] as const;

interface StreamSettingsProps {
  onStart: (config: StreamConfig) => void;
  onCancel: () => void;
}

export default function StreamSettings({ onStart, onCancel }: StreamSettingsProps) {
  const [resolution, setResolution] = useState<StreamConfig['resolution']>('1080');
  const [frameRate, setFrameRate] = useState<StreamConfig['frameRate']>(30);
  const [audio, setAudio] = useState(true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-900 border border-dark-800 rounded-2xl w-full max-w-md mx-4 p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-white mb-1">Configurar transmissão</h2>
        <p className="text-dark-200/60 text-sm mb-5">Ajuste antes de compartilhar sua tela</p>

        {/* Resolução */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-dark-200 mb-2">Resolução</label>
          <div className="grid grid-cols-2 gap-2">
            {RESOLUTIONS.map((r) => (
              <button
                key={r.value}
                onClick={() => setResolution(r.value)}
                className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                  resolution === r.value
                    ? 'border-boteco-500 bg-boteco-600/20 text-boteco-400'
                    : 'border-dark-800 bg-dark-800/50 text-dark-200 hover:border-dark-800/80'
                }`}
              >
                <span className="block text-sm font-medium">{r.label}</span>
                <span className="block text-xs opacity-60">{r.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Frame rate */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-dark-200 mb-2">Taxa de quadros</label>
          <div className="grid grid-cols-3 gap-2">
            {FRAMERATES.map((f) => (
              <button
                key={f.value}
                onClick={() => setFrameRate(f.value)}
                className={`px-3 py-2 rounded-lg border text-center transition-colors ${
                  frameRate === f.value
                    ? 'border-boteco-500 bg-boteco-600/20 text-boteco-400'
                    : 'border-dark-800 bg-dark-800/50 text-dark-200 hover:border-dark-800/80'
                }`}
              >
                <span className="block text-sm font-medium">{f.label}</span>
                <span className="block text-xs opacity-60">{f.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Áudio */}
        <div className="mb-6">
          <button
            onClick={() => setAudio(!audio)}
            className="flex items-center justify-between w-full px-3 py-3 rounded-lg border border-dark-800 bg-dark-800/50 hover:border-dark-800/80 transition-colors"
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-dark-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {audio ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zm7-7l8 8m0-8l-8 8" />
                )}
              </svg>
              <div className="text-left">
                <span className="block text-sm font-medium text-dark-200">Compartilhar áudio</span>
                <span className="block text-xs text-dark-200/60">Áudio do sistema/aba</span>
              </div>
            </div>
            <div className={`w-10 h-6 rounded-full transition-colors flex items-center ${audio ? 'bg-boteco-500 justify-end' : 'bg-dark-800 justify-start'}`}>
              <div className="w-4 h-4 mx-1 rounded-full bg-white shadow" />
            </div>
          </button>
        </div>

        {/* Botões */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-lg border border-dark-800 text-dark-200 hover:text-white hover:border-dark-800/80 transition-colors text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={() => onStart({ resolution, frameRate, audio })}
            className="flex-1 px-4 py-2.5 rounded-lg bg-boteco-600 hover:bg-boteco-500 text-white transition-colors text-sm font-medium"
          >
            Compartilhar
          </button>
        </div>
      </div>
    </div>
  );
}
