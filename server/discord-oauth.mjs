import { randomBytes } from 'node:crypto';
import { normalizeWebOrigin } from './discord-rooms.mjs';

const STATE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 365 * 24 * 60 * 60_000;
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
  if (!response.ok) throw new Error(body.error_description || body.message || `Discord API HTTP ${response.status}`);
  return body;
}

export function createDiscordOAuth({ store, webOrigin, getVoiceMembership }) {
  const frontendOrigin = normalizeWebOrigin(webOrigin);
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
  const redirectUri = process.env.DISCORD_REDIRECT_URI?.trim();

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
      const target = new URL(`/abrir/${encodeURIComponent(roomCode)}`, frontendOrigin);
      target.searchParams.set('source', 'discord');
      target.searchParams.set('discord_session', session);
      redirect(res, target.toString());
    } catch (error) {
      console.error('[discord-oauth] callback falhou:', error.message);
      sendText(res, 502, 'Não foi possível concluir a autorização Discord. Tente novamente.');
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const entry = /^\/discord\/entry\/([A-HJ-NP-Z2-9]{6})$/.exec(url.pathname);
    if (req.method === 'GET' && entry) return begin(entry[1], res);
    if (req.method === 'GET' && url.pathname === '/discord/callback') return callback(req, res);
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
      try {
        const refreshed = await discordRequest('/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: authorization.refreshToken,
          }),
        });
        if (!refreshed.refresh_token) throw new Error('Discord não retornou refresh token.');
        await store.saveAuthorization({
          discordUserId: session.discordUserId,
          username: authorization.username,
          refreshToken: refreshed.refresh_token,
          scope: refreshed.scope || authorization.scope,
        });
      } catch (error) {
        console.warn('[discord-oauth] falha ao renovar autorização:', error.message);
        if (/invalid_grant|revoked|expired/i.test(error.message)) {
          await store.deleteAuthorization(session.discordUserId);
          await store.deleteWebSession(token);
        }
        return null;
      }

      const membership = await getVoiceMembership(session.discordUserId, roomCode);
      if (!membership?.allowed) return null;
      return { ...session, guildId: membership.guildId, voiceChannelId: membership.voiceChannelId };
    },
    async consumeSession() {
      // A sessão é reutilizável; não é convite nem ticket de uso único.
    },
  };
}
