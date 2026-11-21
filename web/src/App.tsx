import { useState, useRef, useCallback, useEffect } from 'react';
import { SignalingClient } from './lib/signaling';
import { WebRTCManager } from './lib/webrtc';
import { getSignalingUrl } from './lib/utils';
import type { AppScreen, PeerInfo, StreamInfo, ServerMessage } from './lib/types';
import Home from './components/Home';
import Room from './components/Room';
import StreamSettings from './components/StreamSettings';
import type { StreamConfig } from './lib/webrtc';
import type { AudioPlaybackReport, DiagnosticsSnapshot, PlaybackSample } from './lib/diagnostics/index';
import { isMockMode, generateMockData, generateMockStreamsDelayed } from './lib/mock';

export default function App() {
  // ── Estado da aplicação ──
  const [screen, setScreen] = useState<AppScreen>('home');
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // ── Estado da sala ──
  const [roomCode, setRoomCode] = useState('');
  const [myPeerId, setMyPeerId] = useState('');
  const [nickname, setNickname] = useState('');
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [audioNotice, setAudioNotice] = useState<string | null>(null);

  // ── Refs para manter instâncias estáveis ──
  const signalRef = useRef<SignalingClient | null>(null);
  const rtcRef = useRef<WebRTCManager | null>(null);
  const peersRef = useRef<PeerInfo[]>([]);
  const nickRef = useRef<string>('');

  // Sync refs
  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);
  useEffect(() => {
    nickRef.current = nickname;
  }, [nickname]);

  // ── Callbacks de stream ──
  const handleNewStream = useCallback((info: StreamInfo) => {
    // Encontra o nickname do peer
    const peer = peersRef.current.find(p => p.id === info.peerId);
    info.nickname = peer?.nickname || 'Desconhecido';

    setStreams(prev => {
      // Remove stream anterior do mesmo peer se existir
      const filtered = prev.filter(s => s.peerId !== info.peerId);
      return [...filtered, info];
    });
  }, []);

  const handleStreamEnd = useCallback((peerId: string) => {
    setStreams(prev => prev.filter(s => s.peerId !== peerId));
  }, []);

  // ── Handler de mensagens do servidor ──
  const handleSignalMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'room-created': {
        const selfPeer: PeerInfo = { id: msg.peerId, nickname: nickRef.current, isSharing: false };
        setRoomCode(msg.code);
        setMyPeerId(msg.peerId);
        setPeers([selfPeer]);
        setScreen('room');
        setError(null);
        setConnecting(false);
        rtcRef.current?.setMyPeerId(msg.peerId);
        break;
      }

      case 'room-joined': {
        const selfJoined: PeerInfo = { id: msg.peerId, nickname: nickRef.current, isSharing: false };
        const peersWithSelf = msg.peers.some((p: PeerInfo) => p.id === msg.peerId)
          ? msg.peers
          : [...msg.peers, selfJoined];
        setRoomCode(msg.code);
        setMyPeerId(msg.peerId);
        setPeers(peersWithSelf);
        setScreen('room');
        setError(null);
        setConnecting(false);
        rtcRef.current?.setMyPeerId(msg.peerId);

        // Solicita streams de quem já está compartilhando
        for (const peer of msg.peers) {
          if (peer.isSharing) {
            rtcRef.current?.requestStream(peer.id);
          }
        }
        break;
      }

      case 'peer-joined':
        setPeers(prev => [...prev, msg.peer]);
        break;

      case 'peer-left':
        setPeers(prev => prev.filter(p => p.id !== msg.peerId));
        setStreams(prev => prev.filter(s => s.peerId !== msg.peerId));
        break;

      case 'sharing-started':
        setPeers(prev =>
          prev.map(p => p.id === msg.peerId ? { ...p, isSharing: true } : p)
        );
        // Solicita o stream automaticamente
        rtcRef.current?.requestStream(msg.peerId);
        break;

      case 'sharing-stopped':
        setPeers(prev =>
          prev.map(p => p.id === msg.peerId ? { ...p, isSharing: false } : p)
        );
        setStreams(prev => prev.filter(s => s.peerId !== msg.peerId));
        break;

      case 'left-room':
        resetRoom();
        break;

      case 'error':
        setError(msg.message);
        setConnecting(false);
        break;
    }
  }, []);

  // ── Conexão e setup ──
  const ensureConnected = async (): Promise<SignalingClient> => {
    if (signalRef.current?.connected) {
      return signalRef.current;
    }

    const signal = new SignalingClient(getSignalingUrl());

    // Setup WebRTC manager
    const rtc = new WebRTCManager(signal, handleNewStream, handleStreamEnd);
    rtc.startListening();

    // Listen to signaling messages for room management
    signal.onMessage(handleSignalMessage);

    await signal.connect();

    signalRef.current = signal;
    rtcRef.current = rtc;

    return signal;
  };

  // ── Ações ──
  const handleCreateRoom = async (nick: string, password?: string) => {
    setError(null);
    setConnecting(true);
    setNickname(nick);

    try {
      const signal = await ensureConnected();
      signal.send({ type: 'create-room', nickname: nick, password });
    } catch (err) {
      setError('Não foi possível conectar ao servidor. Verifique se o servidor está rodando.');
      setConnecting(false);
    }
  };

  const handleJoinRoom = async (code: string, nick: string, password?: string) => {
    setError(null);
    setConnecting(true);
    setNickname(nick);

    try {
      const signal = await ensureConnected();
      signal.send({ type: 'join-room', code, nickname: nick, password });
    } catch (err) {
      setError('Não foi possível conectar ao servidor. Verifique se o servidor está rodando.');
      setConnecting(false);
    }
  };

  const handleOpenSettings = () => {
    setShowSettings(true);
  };

  const handleStartSharing = async (config?: StreamConfig) => {
    setShowSettings(false);
    try {
      const stream = await rtcRef.current?.startScreenShare(config);
      if (stream) {
        setLocalStream(stream);
        setIsSharing(true);
        setAudioNotice(rtcRef.current?.getAudioNotice() ?? null);
        // Atualiza o próprio peer na lista
        setPeers(prev => prev.map(p => p.id === myPeerId ? { ...p, isSharing: true } : p));

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const prior = videoTrack.onended;
          videoTrack.onended = (event) => {
            if (typeof prior === 'function') prior.call(videoTrack, event);
            setLocalStream(null);
            setIsSharing(false);
            setAudioNotice(null);
            setPeers(prev => prev.map(p => p.id === myPeerId ? { ...p, isSharing: false } : p));
          };
        }
      }
    } catch (err: any) {
      // Usuário cancelou o dialog de compartilhamento
      if (err.name !== 'NotAllowedError') {
        setError('Erro ao compartilhar tela: ' + err.message);
      }
    }
  };

  const handleStopSharing = () => {
    rtcRef.current?.stopScreenShare();
    setLocalStream(null);
    setIsSharing(false);
    setAudioNotice(null);
    // Atualiza o próprio peer na lista
    setPeers(prev => prev.map(p => p.id === myPeerId ? { ...p, isSharing: false } : p));
  };

  const handleLeaveRoom = () => {
    signalRef.current?.send({ type: 'leave-room' });
    rtcRef.current?.destroy();
    resetRoom();
  };

  const resetRoom = () => {
    setScreen('home');
    setRoomCode('');
    setMyPeerId('');
    setPeers([]);
    setStreams([]);
    setLocalStream(null);
    setIsSharing(false);
    setError(null);
    setConnecting(false);

    // Cleanup
    rtcRef.current?.destroy();
    signalRef.current?.disconnect();
    signalRef.current = null;
    rtcRef.current = null;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      rtcRef.current?.destroy();
      signalRef.current?.disconnect();
    };
  }, []);

  // ── Mock mode: ?mock na URL ──
  useEffect(() => {
    if (!isMockMode()) return;
    const mock = generateMockData();
    setRoomCode(mock.roomCode);
    setMyPeerId(mock.myPeerId);
    setNickname(mock.nickname);
    setPeers(mock.peers);
    setStreams([]); // Start with no streams — loading state
    setScreen('room');

    // Streams arrive after 5 seconds (simulates WebRTC connection)
    const timer = generateMockStreamsDelayed((readyStreams, peerIds) => {
      setStreams(readyStreams);
      // Flip isSharing on peers whose streams just arrived
      setPeers(prev => prev.map(p => peerIds.includes(p.id) ? { ...p, isSharing: true } : p));
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  const subscribeStats = useCallback((peerId: string, cb: (snapshot: DiagnosticsSnapshot) => void) => {
    return rtcRef.current?.subscribeStats(peerId, cb) ?? (() => {});
  }, []);
  const pushPlayback = useCallback((peerId: string, sample: PlaybackSample) => {
    return rtcRef.current?.pushPlayback(peerId, sample) ?? false;
  }, []);
  const pushAudioPlayback = useCallback((peerId: string, report: AudioPlaybackReport) => {
    return rtcRef.current?.pushAudioPlayback(peerId, report) ?? false;
  }, []);
  const exportDiagnostics = useCallback((peerId: string) => {
    rtcRef.current?.downloadDiagnostics(peerId);
  }, []);
  const subscribeSenderDiagnostics = useCallback((cb: () => void) => {
    return rtcRef.current?.subscribeDiagnostics(cb) ?? (() => {});
  }, []);
  const getSenderSnapshots = useCallback(() => rtcRef.current?.getSenderSnapshots() ?? [], []);
  const exportSenderDiagnostics = useCallback((connectionId: string) => {
    rtcRef.current?.downloadDiagnosticsByConnection(connectionId);
  }, []);

  // ── Render ──
  return (
    <>
      {screen === 'home' && (
        <Home
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          error={error}
          connecting={connecting}
        />
      )}

      {screen === 'room' && (
        <Room
          code={roomCode}
          myPeerId={myPeerId}
          nickname={nickname}
          peers={peers}
          streams={streams}
          localStream={localStream}
          isSharing={isSharing}
          onStartSharing={handleOpenSettings}
          onStopSharing={handleStopSharing}
          onLeaveRoom={handleLeaveRoom}
          subscribeStats={subscribeStats}
          pushPlayback={pushPlayback}
          pushAudioPlayback={pushAudioPlayback}
          audioNotice={audioNotice}
          exportDiagnostics={exportDiagnostics}
          subscribeSenderDiagnostics={subscribeSenderDiagnostics}
          getSenderSnapshots={getSenderSnapshots}
          exportSenderDiagnostics={exportSenderDiagnostics}
        />
      )}
      {showSettings && (
        <StreamSettings
          onStart={handleStartSharing}
          onCancel={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
