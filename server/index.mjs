import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';

// ── Config ──────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000', 10);
const MAX_ROOMS = 256;
const MAX_CONNECTIONS = 512;
const HEARTBEAT_INTERVAL = 30_000; // 30s
const PEER_TTL = 90_000; // 90s sem heartbeat = desconecta

// Sala fixa: existe desde o boot e nunca é removida.
// ATENÇÃO: web/src/lib/constants.ts define o mesmo código — os dois precisam
// ficar em sincronia.
const FIXED_ROOM_CODE = 'BOTECO';

// ── Chat ────────────────────────────────────────────────
const CHAT_MAX_LENGTH = 500;        // caracteres por mensagem
const CHAT_HISTORY_LIMIT = 50;      // mensagens guardadas por sala
const CHAT_RATE_LIMIT_MS = 500;     // intervalo mínimo entre mensagens do mesmo peer

let nextChatId = 1;

// ── State ───────────────────────────────────────────────
/** @type {Map<string, Room>} code → Room */
const rooms = new Map();

/** @type {Map<WebSocket, PeerInfo>} */
const peers = new Map();

let nextPeerId = 1;

/**
 * @typedef {{ id: string, ws: WebSocket, nickname: string, roomCode: string|null, isSharing: boolean, lastSeen: number, lastChatAt: number }} PeerInfo
 * @typedef {{ id: string, from: string, nickname: string, text: string, ts: number }} ChatEntry
 * @typedef {{ code: string, password: string|null, peers: Map<string, PeerInfo>, createdAt: number, isFixed: boolean, history: ChatEntry[] }} Room
 */

// ── Helpers ─────────────────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I/1/O/0
  let code;
  do {
    code = Array.from(randomBytes(6), b => chars[b % chars.length]).join('');
    // nunca colide com a sala fixa (o charset já exclui O, mas garantimos)
  } while (rooms.has(code) || code === FIXED_ROOM_CODE);
  return code;
}

/**
 * Sanitiza texto de chat: remove caracteres de controle (menos `\n`),
 * apara espaços e corta no limite. Texto vazio vira string vazia.
 */
function sanitizeChatText(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '')
    .trim()
    .slice(0, CHAT_MAX_LENGTH);
}

function send(ws, msg) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(room, msg, excludeId = null) {
  for (const peer of room.peers.values()) {
    if (peer.id !== excludeId) {
      send(peer.ws, msg);
    }
  }
}

function removeFromRoom(peer) {
  if (!peer.roomCode) return;
  const room = rooms.get(peer.roomCode);
  if (!room) return;

  room.peers.delete(peer.id);

  // notifica os outros
  broadcast(room, { type: 'peer-left', peerId: peer.id });

  // se quem saiu estava compartilhando, notifica
  if (peer.isSharing) {
    broadcast(room, { type: 'sharing-stopped', peerId: peer.id });
  }

  // sala vazia: limpa o histórico e remove a sala — exceto a sala fixa,
  // que nunca é removida (ela existe desde o boot)
  if (room.peers.size === 0) {
    room.history = [];
    if (!room.isFixed) {
      rooms.delete(peer.roomCode);
      console.log(`[sala] removida: ${peer.roomCode}`);
    }
  }

  peer.roomCode = null;
  peer.isSharing = false;
}

// ── HTTP server ─────────────────────────────────────────
const httpServer = createServer((req, res) => {
  // health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: rooms.size,
      peers: peers.size,
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// ── WebSocket server ────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  if (peers.size >= MAX_CONNECTIONS) {
    send(ws, { type: 'error', message: 'Servidor lotado. Tente novamente mais tarde.' });
    ws.close();
    return;
  }

  const peerId = `p${nextPeerId++}`;
  /** @type {PeerInfo} */
  const peer = {
    id: peerId,
    ws,
    nickname: '',
    roomCode: null,
    isSharing: false,
    lastSeen: Date.now(),
    lastChatAt: 0,
  };
  peers.set(ws, peer);
  console.log(`[peer] conectado: ${peerId}`);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    peer.lastSeen = Date.now();

    switch (msg.type) {
      // ── Criar sala ──
      case 'create-room': {
        if (rooms.size >= MAX_ROOMS) {
          send(ws, { type: 'error', message: 'Limite de salas atingido.' });
          return;
        }
        // sai de sala anterior
        removeFromRoom(peer);

        const code = generateCode();
        peer.nickname = (msg.nickname || 'Anônimo').slice(0, 30);
        peer.roomCode = code;

        /** @type {Room} */
        const room = {
          code,
          password: msg.password || null,
          peers: new Map([[peerId, peer]]),
          createdAt: Date.now(),
          isFixed: false,
          history: [],
        };
        rooms.set(code, room);

        send(ws, {
          type: 'room-created',
          code,
          peerId,
          hasPassword: !!room.password,
        });
        console.log(`[sala] criada: ${code} por ${peer.nickname}`);
        break;
      }

      // ── Entrar na sala ──
      case 'join-room': {
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) {
          send(ws, { type: 'error', message: 'Sala não encontrada.' });
          return;
        }
        if (room.password && room.password !== msg.password) {
          send(ws, { type: 'error', message: 'Senha incorreta.' });
          return;
        }
        // sai de sala anterior
        removeFromRoom(peer);

        peer.nickname = (msg.nickname || 'Anônimo').slice(0, 30);
        peer.roomCode = code;
        room.peers.set(peerId, peer);

        // envia lista de peers atuais
        const peerList = [];
        for (const p of room.peers.values()) {
          if (p.id !== peerId) {
            peerList.push({ id: p.id, nickname: p.nickname, isSharing: p.isSharing });
          }
        }

        send(ws, {
          type: 'room-joined',
          code,
          peerId,
          peers: peerList,
        });

        // histórico de chat da sala (últimas 50 mensagens)
        send(ws, {
          type: 'chat-history',
          messages: room.history.slice(),
        });

        // notifica os outros
        broadcast(room, {
          type: 'peer-joined',
          peer: { id: peerId, nickname: peer.nickname },
        }, peerId);

        console.log(`[sala] ${peer.nickname} entrou em ${code}`);
        break;
      }

      // ── Sair da sala ──
      case 'leave-room': {
        removeFromRoom(peer);
        send(ws, { type: 'left-room' });
        break;
      }

      // ── Compartilhamento ──
      case 'start-sharing': {
        if (!peer.roomCode) return;
        peer.isSharing = true;
        const room = rooms.get(peer.roomCode);
        if (room) {
          broadcast(room, { type: 'sharing-started', peerId: peer.id, nickname: peer.nickname }, peer.id);
        }
        console.log(`[share] ${peer.nickname} começou a compartilhar em ${peer.roomCode}`);
        break;
      }

      case 'stop-sharing': {
        if (!peer.roomCode) return;
        peer.isSharing = false;
        const room = rooms.get(peer.roomCode);
        if (room) {
          broadcast(room, { type: 'sharing-stopped', peerId: peer.id }, peer.id);
        }
        break;
      }

      // ── Chat da sala ──
      case 'chat-message': {
        if (!peer.roomCode) return;
        const room = rooms.get(peer.roomCode);
        if (!room) return;

        const text = sanitizeChatText(msg.text);
        if (!text) return; // texto vazio é ignorado

        const now = Date.now();
        // rate limit: descarta silenciosamente mensagens enviadas menos de
        // CHAT_RATE_LIMIT_MS após a última do mesmo peer
        if (peer.lastChatAt && now - peer.lastChatAt < CHAT_RATE_LIMIT_MS) {
          peer.lastChatAt = now;
          return;
        }
        peer.lastChatAt = now;

        /** @type {ChatEntry} */
        const entry = {
          id: `m${nextChatId++}`,
          from: peer.id,
          nickname: peer.nickname || 'Anônimo',
          text,
          ts: now,
        };

        // guarda no histórico da sala (últimas 50)
        room.history.push(entry);
        if (room.history.length > CHAT_HISTORY_LIMIT) {
          room.history.splice(0, room.history.length - CHAT_HISTORY_LIMIT);
        }

        broadcast(room, {
          type: 'chat-message',
          from: entry.from,
          nickname: entry.nickname,
          text: entry.text,
          ts: entry.ts,
        });
        break;
      }

      // ── Sinalização WebRTC (relay) ──
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        if (!peer.roomCode || !msg.to) return;
        const room = rooms.get(peer.roomCode);
        if (!room) return;
        const target = room.peers.get(msg.to);
        if (!target) return;

        const relay = { type: msg.type, from: peer.id };
        if (msg.sdp) relay.sdp = msg.sdp;
        if (msg.candidate) relay.candidate = msg.candidate;
        send(target.ws, relay);
        break;
      }

      // ── Solicitar stream ──
      case 'request-stream': {
        if (!peer.roomCode || !msg.sharerId) return;
        const room = rooms.get(peer.roomCode);
        if (!room) return;
        const sharer = room.peers.get(msg.sharerId);
        if (!sharer) return;
        send(sharer.ws, { type: 'stream-requested', from: peer.id, nickname: peer.nickname });
        break;
      }

      // ── Heartbeat ──
      case 'heartbeat': {
        send(ws, { type: 'heartbeat-ack' });
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    removeFromRoom(peer);
    peers.delete(ws);
    console.log(`[peer] desconectado: ${peerId}`);
  });

  ws.on('error', () => {
    removeFromRoom(peer);
    peers.delete(ws);
  });
});

// ── Limpeza de peers inativos ───────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [ws, peer] of peers) {
    if (now - peer.lastSeen > PEER_TTL) {
      console.log(`[gc] removendo peer inativo: ${peer.id}`);
      removeFromRoom(peer);
      peers.delete(ws);
      ws.close();
    }
  }
}, HEARTBEAT_INTERVAL);

// ── Start ───────────────────────────────────────────────
// Sala fixa: criada no boot, sem senha e nunca removida.
rooms.set(FIXED_ROOM_CODE, {
  code: FIXED_ROOM_CODE,
  password: null,
  peers: new Map(),
  createdAt: Date.now(),
  isFixed: true,
  history: [],
});
console.log(`[sala] fixa disponível: ${FIXED_ROOM_CODE}`);

httpServer.listen(PORT, () => {
  console.log(`\n  🍺 Telinha do Botecão - Servidor de Sinalização`);
  console.log(`  ➜ Rodando em http://localhost:${PORT}`);
  console.log(`  ➜ Health check: http://localhost:${PORT}/health\n`);
});
