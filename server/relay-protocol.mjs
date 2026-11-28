/**
 * Campos opcionais do relay. Clientes antigos omitem tudo isto e seguem
 * no WebRTC direto. Nada aqui é obrigatório para entrar na sala.
 */

const PEER_ID_MAX = 64;

export function readIsDesktop(value) {
  return value === true;
}

export function publicPeer(peer) {
  return {
    id: peer.id,
    nickname: peer.nickname,
    isSharing: !!peer.isSharing,
    isDesktop: peer.isDesktop === true,
  };
}

/** Aviso de entrada: não inventa `isSharing`, só anuncia a capacidade nova. */
export function announcedPeer(peer) {
  return {
    id: peer.id,
    nickname: peer.nickname,
    isDesktop: peer.isDesktop === true,
  };
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function summarizeTelemetry(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const rttMs = finite(msg.rttMs);
  const jitterMs = finite(msg.jitterMs);
  const loss = finite(msg.loss);
  const uploadKbps = finite(msg.uploadKbps);
  const cpuPercent = finite(msg.cpuPercent);
  if (rttMs === null || jitterMs === null || loss === null || uploadKbps === null || cpuPercent === null) {
    return null;
  }
  const children = finite(msg.activeChildren);
  return {
    rttMs,
    jitterMs,
    loss,
    uploadKbps,
    cpuPercent,
    activeChildren: Math.max(0, Math.min(2, Math.floor(children ?? 0))),
    isDesktop: msg.isDesktop === true,
  };
}

function peerIdOrNull(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id.length > PEER_ID_MAX) return null;
  return id;
}

export function summarizePlan(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const primaryRelayId = peerIdOrNull(msg.primaryRelayId);
  const secondaryRelayId = peerIdOrNull(msg.secondaryRelayId);
  return {
    primaryRelayId,
    secondaryRelayId: secondaryRelayId && secondaryRelayId !== primaryRelayId ? secondaryRelayId : null,
    splitEvenOdd: msg.splitEvenOdd === true && !!primaryRelayId && !!secondaryRelayId,
    canLocalNodeRelay: msg.canLocalNodeRelay === true,
  };
}

export function relayLinkRole(value) {
  if (value === 'sender' || value === 'receiver' || value === 'relay') return value;
  return null;
}

export function relayPurpose(value) {
  return value === 'relay-fanout' ? value : null;
}
