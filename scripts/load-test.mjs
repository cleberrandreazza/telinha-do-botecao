/**
 * Carga da sala pela sinalização, sem captura e sem decodificar vídeo.
 *
 *   node scripts/load-test.mjs --room ABCDEF --peers 30 --url ws://localhost:4000
 *
 * Os bots misturam relay desktop e Web, respondem offer/answer/ice com SDP
 * só de datachannel e montam o pacote de 16 KB em memória (não vai para a GPU).
 * Aos 15 s dois relays caem. O relatório mede o tempo até o host publicar
 * outro relay-plan e mostra a árvore que o UCB1 + Kalman montaria com a
 * telemetria enviada.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'server', 'package.json'));
const { WebSocket } = require('ws');

const MAX_PEERS = 50;
const DEFAULT_PEERS = 20;
const JOIN_TIMEOUT_MS = 8_000;
const PROBE_BYTES = 16_000;
const SQRT2 = Math.SQRT2;
const MAX_RELAY_CPU = 85;
const MIN_RELAY_UPLOAD_KBPS = 2_500;
const MAX_RELAY_CHILDREN = 2;

function parseArgs(argv) {
  const args = {
    room: '',
    peers: DEFAULT_PEERS,
    url: 'ws://localhost:4000',
    seconds: 30,
    chaosAt: 15,
    password: '',
    gaming: false,
    selfCheck: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--room') { args.room = String(next || ''); i += 1; }
    else if (arg === '--peers') { args.peers = Number(next); i += 1; }
    else if (arg === '--url') { args.url = String(next || ''); i += 1; }
    else if (arg === '--seconds') { args.seconds = Number(next); i += 1; }
    else if (arg === '--chaos-at') { args.chaosAt = Number(next); i += 1; }
    else if (arg === '--password') { args.password = String(next || ''); i += 1; }
    else if (arg === '--gaming') args.gaming = true;
    else if (arg === '--self-check') args.selfCheck = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Uso: node scripts/load-test.mjs --room <CODIGO> [--peers 20] [--url ws://localhost:4000] [--seconds 30]',
    '  --peers      espectadores simulados (padrão 20, máximo 50)',
    '  --chaos-at   segundo em que dois relays caem (padrão 15)',
    '  --gaming     ranking UCB no modo jogo (RTT). Sem a flag, usa cinema (jitter)',
    '  --self-check confere o ranking sem abrir WebSocket',
  ].join('\n');
}

function clampPeers(value) {
  if (!Number.isFinite(value)) return DEFAULT_PEERS;
  return Math.max(1, Math.min(MAX_PEERS, Math.floor(value)));
}

function profilesFor(count) {
  const desktopCount = Math.round(count * 0.6);
  const unstableCount = desktopCount >= 2 ? Math.min(2, desktopCount) : 0;
  const stableCount = desktopCount - unstableCount;
  const fiberCount = Math.ceil(stableCount / 2);
  const profiles = [];
  for (let i = 0; i < count; i += 1) {
    if (i < fiberCount) {
      profiles.push({
        kind: 'fiber',
        isDesktop: true,
        uploadKbps: 25_000,
        rttMs: 12 + i * 0.4,
        jitterMs: 3 + i * 0.15,
        loss: 0.002,
        cpuPercent: 18 + (i % 5),
        intervalMs: 2_000,
      });
    } else if (i < stableCount) {
      profiles.push({
        kind: 'medium',
        isDesktop: true,
        uploadKbps: 8_000,
        rttMs: 28 + (i - fiberCount),
        jitterMs: 8 + (i - fiberCount) * 0.4,
        loss: 0.01,
        cpuPercent: 40,
        intervalMs: 1_500,
      });
    } else if (i < desktopCount) {
      const slot = i - stableCount;
      const hot = slot % 2 === 0;
      profiles.push({
        kind: hot ? 'hot-cpu' : 'lossy',
        isDesktop: true,
        uploadKbps: hot ? 12_000 : 20_000,
        rttMs: hot ? 16 : 55,
        jitterMs: hot ? 6 : 24,
        loss: hot ? 0.01 : 0.08,
        cpuPercent: hot ? 92 : 36,
        intervalMs: 800,
      });
    } else {
      profiles.push({
        kind: 'web',
        isDesktop: false,
        uploadKbps: 3_000,
        rttMs: 45 + (i % 7),
        jitterMs: 14,
        loss: 0.02,
        cpuPercent: 100,
        intervalMs: 2_500,
      });
    }
  }
  return profiles;
}

class Kalman1D {
  constructor(initial) {
    this.estimate = Number.isFinite(initial) ? initial : 0;
    this.covariance = 1;
  }

  update(measurement) {
    const sample = Number.isFinite(measurement) ? measurement : this.estimate;
    this.covariance += 0.05;
    const gain = this.covariance / (this.covariance + 1);
    this.estimate += gain * (sample - this.estimate);
    this.covariance *= 1 - gain;
    return this.estimate;
  }
}

function ucb1(totalReward, pulls, totalPulls) {
  if (pulls === 0 || totalPulls === 0) return Number.POSITIVE_INFINITY;
  const mean = totalReward / pulls;
  return mean + SQRT2 * Math.sqrt(Math.log(totalPulls) / pulls);
}

function modeReward(gaming, rtt, jitter, loss) {
  const lossScore = 1 - Math.min(1, Math.max(0, loss));
  if (gaming) {
    const rttScore = 1 - Math.min(1, Math.max(0, rtt / 400));
    return 0.7 * rttScore + 0.3 * lossScore;
  }
  const jitterScore = 1 - Math.min(1, Math.max(0, jitter / 80));
  return 0.7 * jitterScore + 0.3 * lossScore;
}

function capable(sample) {
  return sample.isDesktop === true
    && sample.cpuPercent < MAX_RELAY_CPU
    && sample.uploadKbps >= MIN_RELAY_UPLOAD_KBPS
    && sample.activeChildren < MAX_RELAY_CHILDREN;
}

function maxHopsFor(viewerCount, totalPeers) {
  if (viewerCount <= 1) return 1;
  const log = Math.ceil(Math.log2(Math.max(2, totalPeers)));
  if (!Number.isFinite(log) || log < 0) return 2;
  return Math.min(6, Math.max(2, log + 1));
}

export function createEngine() {
  return { arms: new Map(), totalPulls: 0 };
}

export function observe(engine, sample) {
  if (!sample?.peerId) return;
  let arm = engine.arms.get(sample.peerId);
  if (!arm) {
    arm = {
      rtt: new Kalman1D(sample.rttMs),
      jitter: new Kalman1D(sample.jitterMs),
      gaming: 0,
      cinema: 0,
      pulls: 0,
      sample: { ...sample },
    };
    engine.arms.set(sample.peerId, arm);
  }
  const rtt = arm.rtt.update(sample.rttMs);
  const jitter = arm.jitter.update(sample.jitterMs);
  arm.sample = { ...sample, rttMs: rtt, jitterMs: jitter };
  arm.gaming += modeReward(true, rtt, jitter, sample.loss);
  arm.cinema += modeReward(false, rtt, jitter, sample.loss);
  arm.pulls += 1;
  engine.totalPulls += 1;
}

export function planTree(engine, hostId, gaming) {
  const viewers = [...engine.arms.values()].filter((arm) => arm.sample.peerId !== hostId);
  const ranked = viewers
    .filter((arm) => capable(arm.sample))
    .map((arm) => ({
      id: arm.sample.peerId,
      score: ucb1(gaming ? arm.gaming : arm.cinema, arm.pulls, Math.max(1, engine.totalPulls)),
      kind: arm.sample.kind,
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const viewerCount = viewers.length;
  const totalPeers = viewerCount + 1;
  const maxHops = maxHopsFor(viewerCount, totalPeers);
  const useTree = viewerCount >= 2 && ranked.length > 0;
  const hops = [];
  const children = new Map();
  const place = (peerId, parentId, hop) => {
    children.set(parentId, (children.get(parentId) || 0) + 1);
    hops.push({ peerId, parentId, hop });
  };
  const byId = new Map(viewers.map((arm) => [arm.sample.peerId, arm.sample]));
  if (!useTree) {
    for (const arm of viewers) place(arm.sample.peerId, hostId, 1);
  } else {
    const primary = ranked[0].id;
    place(primary, hostId, 1);
    const rest = ranked.slice(1).map((item) => item.id);
    const leaves = viewers
      .filter((arm) => arm.sample.peerId !== primary && arm.sample.isDesktop && !capable(arm.sample))
      .map((arm) => arm.sample.peerId)
      .sort();
    for (const peerId of rest.concat(leaves)) {
      const parent = hops
        .filter((hop) => {
          const sample = byId.get(hop.peerId);
          return sample && capable(sample)
            && hop.hop < maxHops
            && (children.get(hop.peerId) || 0) < MAX_RELAY_CHILDREN;
        })
        .sort((a, b) => a.hop - b.hop || a.peerId.localeCompare(b.peerId))[0];
      if (parent) place(peerId, parent.peerId, parent.hop + 1);
    }
    const web = viewers
      .filter((arm) => !arm.sample.isDesktop)
      .map((arm) => arm.sample.peerId)
      .sort();
    for (const id of web) place(id, hostId, 1);
  }
  const desktopStreams = hops.filter((hop) => hop.parentId === hostId && byId.get(hop.peerId)?.isDesktop).length;
  return {
    viewerCount,
    totalPeers,
    maxHops,
    useTree,
    primaryRelayId: useTree ? ranked[0].id : null,
    secondaryRelayId: useTree && ranked[1] ? ranked[1].id : null,
    hostDesktopStreams: useTree ? 1 : desktopStreams,
    ranked,
    hops,
    children,
    ignored: viewers
      .filter((arm) => arm.sample.isDesktop && !capable(arm.sample))
      .map((arm) => arm.sample),
  };
}

function syntheticAnswer() {
  return {
    type: 'answer',
    sdp: [
      'v=0',
      'o=- 0 1 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=ice-ufrag:loadtest',
      'a=ice-pwd:loadtestloadtestload',
      'a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
      'a=setup:active',
      'a=mid:0',
      'a=sctp-port:5000',
      'a=max-message-size:262144',
      '',
    ].join('\r\n'),
  };
}

function probePacket(seq) {
  const packet = new Uint8Array(PROBE_BYTES);
  const view = new DataView(packet.buffer);
  view.setUint8(0, 1);
  view.setUint16(2, seq & 0xffff);
  view.setUint32(4, Date.now() >>> 0);
  view.setUint8(8, 0);
  view.setUint8(9, 1);
  view.setUint16(10, PROBE_BYTES - 16);
  view.setUint32(12, seq >>> 0);
  return packet;
}

function selfCheck() {
  const engine = createEngine();
  const samples = [
    { peerId: 'fibra', kind: 'fiber', isDesktop: true, uploadKbps: 25000, rttMs: 12, jitterMs: 4, loss: 0.002, cpuPercent: 20, activeChildren: 0 },
    { peerId: 'medio', kind: 'medium', isDesktop: true, uploadKbps: 8000, rttMs: 28, jitterMs: 9, loss: 0.01, cpuPercent: 40, activeChildren: 0 },
    { peerId: 'quente', kind: 'hot-cpu', isDesktop: true, uploadKbps: 12000, rttMs: 16, jitterMs: 6, loss: 0.01, cpuPercent: 92, activeChildren: 0 },
    { peerId: 'perda', kind: 'lossy', isDesktop: true, uploadKbps: 20000, rttMs: 55, jitterMs: 24, loss: 0.08, cpuPercent: 36, activeChildren: 0 },
    { peerId: 'web', kind: 'web', isDesktop: false, uploadKbps: 3000, rttMs: 45, jitterMs: 14, loss: 0.02, cpuPercent: 100, activeChildren: 0 },
  ];
  for (let round = 0; round < 4; round += 1) {
    for (const sample of samples) observe(engine, sample);
  }
  const plan = planTree(engine, 'host', false);
  const problems = [];
  if (maxHopsFor(1, 2) !== 1) problems.push('1 espectador deveria ficar em 1 salto');
  if (plan.primaryRelayId !== 'fibra') problems.push(`primário foi ${plan.primaryRelayId}, esperado fibra`);
  if (plan.ranked.some((item) => item.id === 'quente')) problems.push('CPU a 92% entrou na eleição');
  if (plan.ignored.every((item) => item.peerId !== 'quente')) problems.push('CPU alta não foi marcada como ignorada');
  const fibra = plan.ranked.find((item) => item.id === 'fibra');
  const perda = plan.ranked.find((item) => item.id === 'perda');
  if (!fibra || !perda || fibra.score <= perda.score) problems.push('a perda de 8% não ficou atrás da fibra');
  const child = plan.hops.find((hop) => hop.peerId === 'medio' || hop.peerId === 'perda');
  if (!child || child.parentId === 'host') problems.push('o segundo desktop deveria sair do host e ir para o relay');
  const web = plan.hops.find((hop) => hop.peerId === 'web');
  if (!web || web.parentId !== 'host') problems.push('Web deveria continuar direto no host');
  if (plan.hostDesktopStreams !== 1) problems.push('o host deveria enviar 1 fluxo desktop');
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('self-check ok: UCB1 prefere fibra, ignora CPU a 92% e deixa a Web no host.');
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMs(value) {
  if (value === null || value === undefined) return 'não observado';
  return `${Math.round(value)} ms`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.selfCheck) {
    selfCheck();
    return;
  }
  if (!args.room.trim()) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const peers = clampPeers(args.peers);
  if (peers !== args.peers) {
    console.log(`Peers ajustado para ${peers} (máximo ${MAX_PEERS}).`);
  }
  const seconds = Number.isFinite(args.seconds) && args.seconds > 0 ? args.seconds : 30;
  const chaosAt = Number.isFinite(args.chaosAt) && args.chaosAt > 0 ? args.chaosAt : 15;
  const durationMs = Math.max(seconds, chaosAt + 5) * 1000;
  const room = args.room.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const profiles = profilesFor(peers);
  const engine = createEngine();
  const startedAt = performance.now();
  const stats = {
    sent: 0,
    received: 0,
    errors: [],
    timeouts: 0,
    joinMs: [],
    probes: 0,
    probeBytes: 0,
    dropped: [],
    dropAt: null,
    peerLeftAt: null,
    healedAt: null,
    healPlan: null,
    lastHostPlan: null,
    hostId: null,
    sharerId: null,
  };
  let stopped = false;
  const bots = [];

  const send = (ws, message) => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    if (ws.bufferedAmount > 262_144) return false;
    ws.send(JSON.stringify(message));
    stats.sent += 1;
    return true;
  };

  const noteError = (text) => {
    if (stats.errors.length < 8) stats.errors.push(text);
    else stats.errors.overflow = (stats.errors.overflow || 0) + 1;
  };

  function rememberHost(peer) {
    if (!peer || bots.some((bot) => bot.peerId === peer.id)) return;
    if (peer.isSharing) stats.sharerId = peer.id;
    if (!stats.hostId) stats.hostId = peer.isSharing ? peer.id : stats.hostId;
  }

  function onSignaling(bot, msg) {
    stats.received += 1;
    if (msg.type === 'room-joined') {
      bot.peerId = msg.peerId;
      bot.joinedAt = performance.now();
      stats.joinMs.push(bot.joinedAt - bot.joinSentAt);
      for (const peer of msg.peers || []) {
        rememberHost(peer);
        if (peer.isSharing) requestStream(bot, peer.id);
      }
      return;
    }
    if (msg.type === 'error') {
      noteError(`${bot.nickname}: ${msg.message || 'erro'}`);
      return;
    }
    if (msg.type === 'peer-joined') {
      rememberHost(msg.peer);
      return;
    }
    if (msg.type === 'sharing-started') {
      stats.sharerId = msg.peerId;
      stats.hostId = msg.peerId;
      requestStream(bot, msg.peerId);
      return;
    }
    if (msg.type === 'peer-left') {
      if (stats.dropAt && stats.dropped.includes(msg.peerId) && stats.peerLeftAt === null) {
        stats.peerLeftAt = performance.now();
      }
      return;
    }
    if (msg.type === 'relay-plan') {
      const fromBot = bots.some((item) => item.peerId && item.peerId === msg.from);
      if (!fromBot) {
        stats.lastHostPlan = { ...msg, at: performance.now() };
        if (!stats.hostId && msg.from) stats.hostId = msg.from;
        if (stats.dropAt && stats.healedAt === null) {
          const stillUsesDropped = stats.dropped.includes(msg.primaryRelayId) || stats.dropped.includes(msg.secondaryRelayId);
          if (!stillUsesDropped) {
            stats.healedAt = performance.now();
            stats.healPlan = msg;
          }
        }
      }
      return;
    }
    if (msg.type === 'peer-telemetry' && bot.index === 0 && msg.from && !bots.some((item) => item.peerId === msg.from)) {
      observe(engine, {
        peerId: msg.from,
        kind: msg.isDesktop ? 'remote-desktop' : 'remote-web',
        isDesktop: msg.isDesktop === true,
        uploadKbps: msg.uploadKbps,
        rttMs: msg.rttMs,
        jitterMs: msg.jitterMs,
        loss: msg.loss,
        cpuPercent: msg.cpuPercent,
        activeChildren: msg.activeChildren || 0,
      });
      return;
    }
    if (msg.type === 'offer') {
      const packet = probePacket(stats.probes + 1);
      stats.probes += 1;
      stats.probeBytes += packet.byteLength;
      const purpose = msg.purpose === 'relay-fanout' ? 'relay-fanout' : undefined;
      const linkRole = purpose ? 'relay' : 'receiver';
      send(bot.ws, { type: 'answer', to: msg.from, sdp: syntheticAnswer(), purpose, linkRole });
      send(bot.ws, {
        type: 'ice-candidate',
        to: msg.from,
        linkRole,
        candidate: { candidate: 'candidate:1 1 udp 2122260223 127.0.0.1 9 typ host', sdpMid: '0', sdpMLineIndex: 0 },
      });
      return;
    }
    if (msg.type === 'ice-candidate' && msg.from) {
      send(bot.ws, {
        type: 'ice-candidate',
        to: msg.from,
        linkRole: msg.linkRole === 'relay' ? 'relay' : 'receiver',
        candidate: { candidate: 'candidate:1 1 udp 2122260223 127.0.0.1 9 typ host', sdpMid: '0', sdpMLineIndex: 0 },
      });
    }
  }

  function requestStream(bot, sharerId) {
    if (!sharerId || sharerId === bot.peerId) return;
    send(bot.ws, { type: 'request-stream', sharerId });
  }

  function publishTelemetry(bot) {
    if (!bot.peerId) return;
    const profile = bot.profile;
    const sample = {
      peerId: bot.peerId,
      kind: profile.kind,
      isDesktop: profile.isDesktop,
      uploadKbps: profile.uploadKbps,
      rttMs: profile.rttMs,
      jitterMs: profile.jitterMs,
      loss: profile.loss,
      cpuPercent: profile.cpuPercent,
      activeChildren: 0,
    };
    observe(engine, sample);
    send(bot.ws, {
      type: 'peer-telemetry',
      rttMs: profile.rttMs,
      jitterMs: profile.jitterMs,
      loss: profile.loss,
      uploadKbps: profile.uploadKbps,
      cpuPercent: profile.cpuPercent,
      activeChildren: 0,
      isDesktop: profile.isDesktop,
    });
  }

  function connectBot(index, profile) {
    const nickname = `bot-${String(index + 1).padStart(2, '0')}`;
    const bot = { index, nickname, profile, peerId: null, ws: null, timers: [], joinSentAt: 0, joinedAt: null, alive: true };
    const ws = new WebSocket(args.url);
    bot.ws = ws;
    const failTimer = setTimeout(() => {
      if (!bot.joinedAt && bot.alive) {
        stats.timeouts += 1;
        noteError(`${nickname}: timeout ao entrar na sala`);
        ws.terminate();
      }
    }, JOIN_TIMEOUT_MS);
    bot.timers.push(failTimer);
    ws.on('open', () => {
      bot.joinSentAt = performance.now();
      const join = { type: 'join-room', code: room, nickname, isDesktop: profile.isDesktop };
      if (args.password) join.password = args.password;
      send(ws, join);
      const jitter = Math.floor(Math.random() * 200);
      const timer = setInterval(() => publishTelemetry(bot), profile.intervalMs + jitter);
      bot.timers.push(timer);
      const beat = setInterval(() => send(ws, { type: 'heartbeat' }), 20_000);
      bot.timers.push(beat);
    });
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        noteError(`${nickname}: mensagem inválida`);
        return;
      }
      onSignaling(bot, msg);
    });
    ws.on('error', (error) => {
      noteError(`${nickname}: ${error.message || 'falha no WebSocket'}`);
    });
    ws.on('close', () => {
      bot.alive = false;
    });
    bots.push(bot);
  }

  function dropRelays() {
    const hostId = stats.hostId || stats.sharerId || 'host';
    const plan = planTree(engine, hostId, args.gaming);
    const relayIds = [];
    for (const hop of plan.hops) {
      const kids = plan.children.get(hop.peerId) || 0;
      if (kids > 0) relayIds.push(hop.peerId);
    }
    if (plan.primaryRelayId && !relayIds.includes(plan.primaryRelayId)) relayIds.unshift(plan.primaryRelayId);
    if (plan.secondaryRelayId && !relayIds.includes(plan.secondaryRelayId)) relayIds.push(plan.secondaryRelayId);
    const victims = [];
    for (const peerId of relayIds) {
      const bot = bots.find((item) => item.alive && item.peerId === peerId);
      if (bot && !victims.includes(bot)) victims.push(bot);
      if (victims.length === 2) break;
    }
    for (const bot of bots) {
      if (victims.length === 2) break;
      if (!bot.alive || !bot.profile.isDesktop || bot.profile.kind === 'hot-cpu') continue;
      if (!victims.includes(bot)) victims.push(bot);
    }
    stats.dropAt = performance.now();
    for (const bot of victims) {
      stats.dropped.push(bot.peerId);
      bot.alive = false;
      for (const timer of bot.timers) clearInterval(timer);
      clearTimeout(bot.timers[0]);
      bot.ws.terminate();
      engine.arms.delete(bot.peerId);
    }
    console.log(`[caos] ${victims.map((bot) => bot.nickname).join(', ') || 'nenhum relay'} saiu aos ${Math.round(chaosAt)} s`);
  }

  function finish(reason) {
    if (stopped) return;
    stopped = true;
    clearTimeout(chaosTimer);
    clearTimeout(endTimer);
    clearInterval(progressTimer);
    for (const bot of bots) {
      for (const timer of bot.timers) clearInterval(timer);
      clearTimeout(bot.timers[0]);
      if (bot.ws && bot.ws.readyState === WebSocket.OPEN) bot.ws.close();
    }
    const elapsed = (performance.now() - startedAt) / 1000;
    const hostId = stats.hostId || stats.sharerId || 'host';
    const plan = planTree(engine, hostId, args.gaming);
    const connected = bots.filter((bot) => bot.alive && bot.joinedAt).length;
    const joined = stats.joinMs.length;
    const rate = elapsed > 0 ? (stats.sent + stats.received) / elapsed : 0;
    const lines = [];
    lines.push('');
    lines.push('Telinha — teste de carga');
    lines.push(`Sala ${room} · ${peers} bots · ${elapsed.toFixed(1)} s · ${args.url}`);
    lines.push(`Encerrado: ${reason}`);
    lines.push('');
    lines.push('Conexão');
    lines.push(`  Bots que entraram: ${joined}/${peers}`);
    lines.push(`  Ainda conectados: ${connected}`);
    lines.push(`  Tempo médio de entrada: ${formatMs(mean(stats.joinMs))}`);
    lines.push(`  Timeouts: ${stats.timeouts}`);
    lines.push(`  Erros: ${stats.errors.length + (stats.errors.overflow || 0)}`);
    for (const error of stats.errors) lines.push(`    - ${error}`);
    lines.push('');
    lines.push('WebSocket');
    lines.push(`  Mensagens enviadas: ${stats.sent}`);
    lines.push(`  Mensagens recebidas: ${stats.received}`);
    lines.push(`  Taxa no servidor: ${rate.toFixed(1)} msg/s`);
    lines.push(`  Pacotes de 16 KB respondidos (em memória, sem vídeo): ${stats.probes} · ${(stats.probeBytes / 1024).toFixed(0)} KB`);
    lines.push('');
    lines.push(`Árvore UCB1 + Kalman (${args.gaming ? 'jogo' : 'cinema'})`);
    lines.push(`  Host observado: ${hostId}`);
    lines.push(`  max_hops: ${plan.maxHops}`);
    lines.push(`  Espectadores no espelho: ${plan.viewerCount}`);
    lines.push(`  Fluxos desktop do host: ${plan.hostDesktopStreams}`);
    lines.push(`  Relay primário: ${plan.primaryRelayId || 'nenhum'}`);
    if (plan.primaryRelayId) {
      const nick = bots.find((bot) => bot.peerId === plan.primaryRelayId);
      const arm = engine.arms.get(plan.primaryRelayId);
      lines.push(`    perfil: ${nick?.profile.kind || arm?.sample.kind || 'n/d'}`);
    }
    const relays = [...plan.children.entries()].filter(([id, count]) => id !== hostId && count > 0);
    if (!relays.length) lines.push('  Nenhum relay com filhos.');
    for (const [id, count] of relays) {
      const bot = bots.find((item) => item.peerId === id);
      lines.push(`  ${bot?.nickname || id} (${bot?.profile.kind || 'remoto'}): ${count} filho(s)`);
    }
    if (plan.ignored.length) {
      lines.push(`  Ignorados pela capacidade: ${plan.ignored.map((item) => `${item.kind} cpu ${item.cpuPercent}%`).join(', ')}`);
    }
    const lossy = plan.ranked.find((item) => item.kind === 'lossy');
    const fiber = plan.ranked.find((item) => item.kind === 'fiber');
    if (fiber && lossy) {
      lines.push(`  UCB fibra ${fiber.score.toFixed(3)} > perda ${lossy.score.toFixed(3)}: o nó instável não foi o primário.`);
    }
    lines.push('');
    lines.push('Caos');
    if (!stats.dropAt) {
      lines.push('  A queda de relay não chegou a rodar.');
    } else {
      const names = stats.dropped.map((id) => bots.find((bot) => bot.peerId === id)?.nickname || id);
      lines.push(`  Relays derrubados: ${names.join(', ') || 'nenhum'}`);
      lines.push(`  Demais bots seguiram conectados: ${connected}`);
      lines.push(`  Host viu a saída (peer-left): ${stats.peerLeftAt ? formatMs(stats.peerLeftAt - stats.dropAt) : 'não observado'}`);
      lines.push(`  Host reorganizou a árvore (relay-plan): ${stats.healedAt ? formatMs(stats.healedAt - stats.dropAt) : 'não observado'}`);
      if (!stats.healedAt) {
        lines.push('  Sem relay-plan novo, o transmissor desktop não estava na sala ou ainda não recalculou.');
      }
    }
    lines.push('');
    console.log(lines.join('\n'));
    setTimeout(() => process.exit(0), 200);
  }

  console.log(`Entrando em ${room} com ${peers} bots (${profiles.filter((item) => item.isDesktop).length} desktop, ${profiles.filter((item) => !item.isDesktop).length} web)...`);
  profiles.forEach((profile, index) => connectBot(index, profile));
  const chaosTimer = setTimeout(dropRelays, chaosAt * 1000);
  const endTimer = setTimeout(() => finish('tempo esgotado'), durationMs);
  const progressTimer = setInterval(() => {
    const elapsed = (performance.now() - startedAt) / 1000;
    const joined = stats.joinMs.length;
    const alive = bots.filter((bot) => bot.alive && bot.joinedAt).length;
    const rate = elapsed > 0 ? (stats.sent + stats.received) / elapsed : 0;
    console.log(`[${elapsed.toFixed(0)}s] ${alive} ativos · ${joined}/${peers} entraram · ${rate.toFixed(0)} msg/s`);
  }, 5_000);
  process.on('SIGINT', () => finish('Ctrl+C'));
  process.on('SIGTERM', () => finish('encerrado'));
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
