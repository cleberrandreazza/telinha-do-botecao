import { useState } from 'react';
import { cleanCode, formatCode } from '../lib/utils';

interface HomeProps {
  onCreateRoom: (nickname: string, password?: string) => void;
  onJoinRoom: (code: string, nickname: string, password?: string) => void;
  error: string | null;
  connecting: boolean;
}

export default function Home({ onCreateRoom, onJoinRoom, error, connecting }: HomeProps) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    onCreateRoom(nickname.trim(), password || undefined);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim() || !code.trim()) return;
    onJoinRoom(cleanCode(code), nickname.trim(), password || undefined);
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">
            <span className="text-boteco-400">Telinha</span>
            <span className="text-dark-200"> do </span>
            <span className="text-boteco-500">Botecão</span>
          </h1>
          <p className="text-dark-200 text-sm">
            Compartilhe sua tela sem travar, sem conta, sem custo
          </p>
        </div>

        {/* Tabs */}
        <div className="flex mb-6 bg-dark-900 rounded-lg p-1">
          <button
            onClick={() => setTab('create')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              tab === 'create'
                ? 'bg-boteco-600 text-white'
                : 'text-dark-200 hover:text-white'
            }`}
          >
            Criar Sala
          </button>
          <button
            onClick={() => setTab('join')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              tab === 'join'
                ? 'bg-boteco-600 text-white'
                : 'text-dark-200 hover:text-white'
            }`}
          >
            Entrar na Sala
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Create Room Form */}
        {tab === 'create' && (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm text-dark-200 mb-1">Seu apelido</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Ex: João do Boteco"
                maxLength={30}
                className="w-full px-4 py-3 bg-dark-900 border border-dark-800 rounded-lg text-white placeholder-dark-200/50 focus:border-boteco-500 focus:outline-none transition-colors"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm text-dark-200 mb-1">
                Senha <span className="text-dark-200/50">(opcional)</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Deixe vazio para sala aberta"
                className="w-full px-4 py-3 bg-dark-900 border border-dark-800 rounded-lg text-white placeholder-dark-200/50 focus:border-boteco-500 focus:outline-none transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={!nickname.trim() || connecting}
              className="w-full py-3 bg-boteco-600 hover:bg-boteco-500 disabled:bg-dark-800 disabled:text-dark-200 text-white font-medium rounded-lg transition-colors"
            >
              {connecting ? 'Criando...' : 'Criar Sala'}
            </button>
          </form>
        )}

        {/* Join Room Form */}
        {tab === 'join' && (
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-sm text-dark-200 mb-1">Código da sala</label>
              <input
                type="text"
                value={formatCode(code)}
                onChange={(e) => setCode(cleanCode(e.target.value))}
                placeholder="ABC-DEF"
                maxLength={7}
                className="w-full px-4 py-3 bg-dark-900 border border-dark-800 rounded-lg text-white text-center text-2xl font-mono tracking-widest placeholder-dark-200/50 focus:border-boteco-500 focus:outline-none transition-colors uppercase"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm text-dark-200 mb-1">Seu apelido</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Ex: Maria do Bar"
                maxLength={30}
                className="w-full px-4 py-3 bg-dark-900 border border-dark-800 rounded-lg text-white placeholder-dark-200/50 focus:border-boteco-500 focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-dark-200 mb-1">
                Senha <span className="text-dark-200/50">(se necessário)</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Senha da sala"
                className="w-full px-4 py-3 bg-dark-900 border border-dark-800 rounded-lg text-white placeholder-dark-200/50 focus:border-boteco-500 focus:outline-none transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={!nickname.trim() || code.length < 6 || connecting}
              className="w-full py-3 bg-boteco-600 hover:bg-boteco-500 disabled:bg-dark-800 disabled:text-dark-200 text-white font-medium rounded-lg transition-colors"
            >
              {connecting ? 'Entrando...' : 'Entrar na Sala'}
            </button>
          </form>
        )}

        {/* Footer */}
        <p className="text-center text-dark-200/40 text-xs mt-8">
          P2P via WebRTC · Sem servidor de vídeo · 100% gratuito
        </p>
      </div>
    </div>
  );
}
