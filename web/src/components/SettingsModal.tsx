import { useState, useEffect, useRef } from 'react';
import { getInitials } from '../lib/profile';

const STORAGE_KEY = 'botecao-settings';

export interface BotecaoSettings {
  displayName: string;
  avatarUrl: string | null;
  resolution: '2160p' | '1080p' | '720p' | '480p';
  fps: 30 | 15 | 5;
  shareAudio: boolean;
}

const DEFAULT_SETTINGS: BotecaoSettings = {
  displayName: '',
  avatarUrl: null,
  resolution: '1080p',
  fps: 30,
  shareAudio: true,
};

export function loadSettings(): BotecaoSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: BotecaoSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

const RES_OPTIONS: { key: BotecaoSettings['resolution']; label: string; badge: string; desc: string }[] = [
  { key: '2160p', label: '4K', badge: '2160p', desc: 'Máxima qualidade' },
  { key: '1080p', label: 'Full HD', badge: '1080p', desc: 'Recomendado' },
  { key: '720p', label: 'HD', badge: '720p', desc: 'Economiza banda' },
  { key: '480p', label: 'SD', badge: '480p', desc: 'Conexão lenta' },
];

const FPS_OPTIONS: { key: BotecaoSettings['fps']; label: string; desc: string }[] = [
  { key: 30, label: '30 FPS', desc: 'Fluido' },
  { key: 15, label: '15 FPS', desc: 'Moderado' },
  { key: 5, label: '5 FPS', desc: 'Só apresentação' },
];

interface SettingsModalProps {
  nickname: string;
  onClose: () => void;
  onSave: (settings: BotecaoSettings) => void;
}

export default function SettingsModal({ nickname, onClose, onSave }: SettingsModalProps) {
  const [settings, setSettings] = useState<BotecaoSettings>(() => {
    const loaded = loadSettings();
    if (!loaded.displayName) loaded.displayName = nickname;
    return loaded;
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = <K extends keyof BotecaoSettings>(key: K, value: BotecaoSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    saveSettings(settings);
    onSave(settings);
    onClose();
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      update('avatarUrl', ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveAvatar = () => {
    update('avatarUrl', null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const initials = getInitials(settings.displayName || nickname);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-container-lowest/80 backdrop-blur-md"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-[#18191c] border border-surface-container-highest shadow-2xl p-6 flex flex-col gap-5 animate-in">
        {/* Header */}
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2 text-on-surface">
            <span className="material-symbols-outlined text-primary text-[22px]">tune</span>
            <h2 className="font-headline-md text-headline-md font-semibold tracking-tight text-white">Configurações</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto max-h-[75vh] pr-0.5">
          {/* Privacy notice */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-container/60 border border-outline-variant/30 text-on-surface-variant">
            <span className="material-symbols-outlined text-[20px] text-primary shrink-0">security</span>
            <span className="font-body-sm text-[12px] leading-relaxed text-on-surface-variant">
              Todas as suas informações e preferências são salvas localmente no navegador, sem armazenamento em servidores.
            </span>
          </div>

          {/* Display name */}
          <div className="flex flex-col gap-1.5">
            <label className="font-label-md text-[11px] font-bold uppercase tracking-wider text-outline">NOME DE EXIBIÇÃO</label>
            <div className="relative flex items-center">
              <span className="material-symbols-outlined absolute left-3.5 text-outline text-[18px] pointer-events-none">badge</span>
              <input
                className="w-full bg-surface-container border border-surface-container-high focus:border-primary rounded-xl pl-10 pr-3.5 py-2.5 text-on-surface font-body-md text-body-md placeholder:text-outline focus:outline-none transition-colors shadow-inner"
                maxLength={30}
                placeholder={nickname}
                value={settings.displayName}
                onChange={(e) => update('displayName', e.target.value)}
                type="text"
              />
            </div>
          </div>

          {/* Profile photo */}
          <div className="flex flex-col gap-1.5">
            <span className="font-label-md text-[11px] font-bold uppercase tracking-wider text-outline">FOTO DE PERFIL</span>
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-container/60 border border-outline-variant/30">
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-full bg-surface-container-high border border-outline-variant/40 flex items-center justify-center font-headline-sm text-[14px] text-primary font-bold shadow-inner shrink-0 overflow-hidden"
                >
                  {settings.avatarUrl ? (
                    <img src={settings.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-body-md text-body-md text-on-surface font-medium leading-none">Avatar do Perfil</span>
                  <span className="font-body-sm text-[11px] text-outline font-label-mono">PNG, JPG ou GIF</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-variant text-on-surface border border-outline-variant/30 font-label-md text-[12px] font-medium transition-colors inline-flex items-center gap-1.5 shadow-sm">
                  <span className="material-symbols-outlined text-[16px] text-primary">photo_camera</span>
                  <span>Alterar foto</span>
                  <input
                    ref={fileInputRef}
                    accept="image/*"
                    className="sr-only"
                    type="file"
                    onChange={handleAvatarChange}
                  />
                </label>
                {settings.avatarUrl && (
                  <button
                    onClick={handleRemoveAvatar}
                    className="px-2.5 py-1.5 rounded-lg hover:bg-surface-container-high text-outline hover:text-error font-label-md text-[12px] transition-colors flex items-center gap-1 cursor-pointer"
                    title="Remover foto"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                    <span>Remover</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Resolution */}
          <div className="flex flex-col gap-2">
            <span className="font-label-md text-[11px] font-bold uppercase tracking-wider text-outline">RESOLUÇÃO</span>
            <div className="grid grid-cols-2 gap-2.5">
              {RES_OPTIONS.map((opt) => {
                const active = settings.resolution === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => update('resolution', opt.key)}
                    className={`flex flex-col items-start px-3.5 py-2.5 rounded-xl text-left transition-all cursor-pointer ${
                      active
                        ? 'bg-primary/10 border-2 border-primary shadow-sm'
                        : 'bg-surface-container border border-transparent hover:border-outline-variant'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className={`font-headline-sm text-body-lg font-medium ${active ? 'text-primary font-semibold' : 'text-on-surface'}`}>
                        {opt.label}
                      </span>
                      <span className={`text-[11px] font-label-mono ${active ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}>
                        {opt.badge}
                      </span>
                    </div>
                    <span className={`text-body-sm pt-0.5 ${active ? 'text-on-surface font-medium' : 'text-on-surface-variant'}`}>
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* FPS */}
          <div className="flex flex-col gap-2">
            <span className="font-label-md text-[11px] font-bold uppercase tracking-wider text-outline">TAXA DE QUADROS</span>
            <div className="grid grid-cols-3 gap-2.5">
              {FPS_OPTIONS.map((opt) => {
                const active = settings.fps === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => update('fps', opt.key)}
                    className={`flex flex-col items-center justify-center py-2.5 px-3 rounded-xl text-center transition-all cursor-pointer ${
                      active
                        ? 'bg-primary/10 border-2 border-primary shadow-sm'
                        : 'bg-surface-container border border-transparent hover:border-outline-variant'
                    }`}
                  >
                    <span className={`font-headline-sm text-body-lg font-medium ${active ? 'text-primary font-semibold' : 'text-on-surface'}`}>
                      {opt.label}
                    </span>
                    <span className={`text-[11px] pt-0.5 ${active ? 'text-primary font-medium' : 'text-on-surface-variant'}`}>
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Audio sharing toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-surface-container border border-outline-variant/20">
            <div className="flex flex-col gap-0.5">
              <span className="font-body-md text-body-md text-on-surface font-medium leading-tight">Compartilhar áudio</span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">Aba com áudio da guia, ou tela inteira com áudio do sistema. Janela no Windows normalmente fica sem áudio. Não captura microfone.</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={settings.shareAudio}
                onChange={(e) => update('shareAudio', e.target.checked)}
              />
              <div className="w-11 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-container peer-checked:after:bg-on-primary" />
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-outline-variant/30">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-on-surface-variant hover:text-white font-label-lg text-label-lg transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-lg bg-primary-container hover:bg-secondary-container text-on-primary-container font-label-lg text-label-lg font-semibold shadow-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">check</span>
            <span>Salvar</span>
          </button>
        </div>
      </div>
    </div>
  );
}
