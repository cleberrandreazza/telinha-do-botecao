import { randomBytes } from 'node:crypto';
import { normalizeWebOrigin } from './discord-rooms.mjs';

const STATE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const LOGIN_CODE_TTL_MS = 2 * 60_000;
const DISCORD_API = 'https://discord.com/api/v10';

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end();
}

function sendText(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

async function discordRequest(path, options) {
  const response = await fetch(`${DISCORD_API}${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Discord ${path} HTTP ${response.status}: ${body.error_description || body.error || body.message || 'resposta sem descrição'}`);
  return body;
}

export function createDiscordOAuth({ store, webOrigin, getVoiceMembership }) {
  const frontendOrigin = normalizeWebOrigin(webOrigin);
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
  const redirectUri = process.env.DISCORD_REDIRECT_URI?.trim();
  const refreshLocks = new Map();
  const allowedExchangeOrigins = new Set([frontendOrigin, 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']);

  function configured() {
    return Boolean(clientId && clientSecret && redirectUri);
  }

  async function begin(roomCode, res) {
    if (!configured()) return sendText(res, 503, 'Integração Discord ainda não configurada.');
    const state = randomBytes(32).toString('base64url');
    await store.saveOAuthState(state, roomCode, Date.now() + STATE_TTL_MS);
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('state', state);
    redirect(res, url.toString());
  }

  async function callback(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return sendText(res, 400, 'Retorno OAuth inválido.');
    const roomCode = await store.consumeOAuthState(state);
    if (!roomCode) return sendText(res, 400, 'A autorização expirou. Volte ao Discord e tente novamente.');

    try {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });
      const tokens = await discordRequest('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const user = await discordRequest('/users/@me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!tokens.refresh_token || !user.id) throw new Error('Resposta OAuth incompleta.');
      await store.saveAuthorization({
        discordUserId: user.id,
        username: user.global_name || user.username || user.id,
        refreshToken: tokens.refresh_token,
        scope: tokens.scope || 'identify',
      });
      const session = randomBytes(32).toString('base64url');
      await store.createWebSession(user.id, session, Date.now() + SESSION_TTL_MS);
      const loginCode = randomBytes(32).toString('base64url');
      await store.createLoginCode(loginCode, session, roomCode, Date.now() + LOGIN_CODE_TTL_MS);
      const target = new URL(`/abrir/${encodeURIComponent(roomCode)}`, frontendOrigin);
      target.searchParams.set('source', 'discord');
      target.searchParams.set('discord_code', loginCode);
      redirect(res, target.toString());
    } catch (error) {
      console.error('[discord-oauth] callback falhou:', error.message);
      sendText(res, 502, 'Não foi possível concluir a autorização Discord. Tente novamente.');
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const entry = /^\/discord\/entry\/([A-HJ-NP-Z2-9]{6})$/.exec(url.pathname);
    if (req.method === 'GET' && entry) { await begin(entry[1], res); return true; }
    if (req.method === 'GET' && url.pathname === '/discord/callback') { await callback(req, res); return true; }
    if (url.pathname === '/discord/exchange') {
      const requestOrigin = req.headers.origin || '';
      if (allowedExchangeOrigins.has(requestOrigin)) res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
      if (req.method !== 'POST' || !allowedExchangeOrigins.has(requestOrigin)) return sendText(res, 403, 'Origem não autorizada.');
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return sendText(res, 413, 'Requisição muito grande.'); }
      let payload;
      try { payload = JSON.parse(raw); } catch { return sendText(res, 400, 'Requisição inválida.'); }
      const roomCode = typeof payload.roomCode === 'string' ? payload.roomCode.toUpperCase() : '';
      const loginCode = typeof payload.code === 'string' ? payload.code : '';
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(roomCode) || !/^[A-Za-z0-9_-]{40,64}$/.test(loginCode)) return sendText(res, 400, 'Código de acesso inválido.');
      const sessionToken = await store.consumeLoginCode(loginCode, roomCode);
      if (!sessionToken) return sendText(res, 401, 'Este link expirou ou já foi utilizado.');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Pragma': 'no-cache' });
      res.end(JSON.stringify({ sessionToken }));
      return true;
    }
    return false;
  }

  return {
    handle,
    async validateSession(token, roomCode) {
      const session = await store.getWebSession(token);
      if (!session) return null;

      // Atualiza o refresh token rotativo do Discord a cada nova entrada.
      // Isso também detecta quando o usuário revogou o acesso à aplicação.
      const authorization = await store.getAuthorization(session.discordUserId);
      if (!authorization) {
        await store.deleteWebSession(token);
        return null;
      }
      const refresh = async () => {
        const current = await store.getAuthorization(session.discordUserId);
        if (!current) return false;
        try {
          const refreshed = await discordRequest('/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              grant_type: 'refresh_token',
              refresh_token: current.refreshToken,
            }),
          });
          if (!refreshed.refresh_token) throw new Error('Discord não retornou refresh token.');
          await store.saveAuthorization({
            discordUserId: session.discordUserId,
            username: current.username,
            refreshToken: refreshed.refresh_token,
            scope: refreshed.scope || current.scope,
          });
          return true;
        } catch (error) {
          console.warn('[discord-oauth] falha ao renovar autorização:', error.message);
          if (/invalid_grant|revoked|expired/i.test(error.message)) {
            await store.deleteAuthorization(session.discordUserId);
          }
          return false;
        }
      };
      let refreshPromise = refreshLocks.get(session.discordUserId);
      if (!refreshPromise) {
        refreshPromise = refresh().finally(() => refreshLocks.delete(session.discordUserId));
        refreshLocks.set(session.discordUserId, refreshPromise);
      }
      if (!await refreshPromise) return null;

      const membership = await getVoiceMembership(session.discordUserId, roomCode);
      if (!membership?.allowed) return null;
      return { ...session, guildId: membership.guildId, voiceChannelId: membership.voiceChannelId };
    },
    async consumeSession() {
      // A sessão é reutilizável; não é convite nem ticket de uso único.
    },
  };
}
