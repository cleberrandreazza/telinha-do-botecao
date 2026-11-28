import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const TOKEN_ALGORITHM = 'aes-256-gcm';

function encryptionKey() {
  const raw = process.env.DISCORD_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error('DISCORD_TOKEN_ENCRYPTION_KEY não configurada');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('DISCORD_TOKEN_ENCRYPTION_KEY deve ser uma chave base64 de 32 bytes');
  return key;
}

export function encryptDiscordToken(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(TOKEN_ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptDiscordToken(value) {
  const [ivText, tagText, encryptedText] = String(value || '').split('.');
  if (!ivText || !tagText || !encryptedText) throw new Error('Token Discord armazenado em formato inválido');
  const decipher = createDecipheriv(TOKEN_ALGORITHM, encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function createDiscordStore(databaseUrl) {
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada');
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return {
    async initialize() {
      encryptionKey();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS discord_authorizations (
          discord_user_id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          encrypted_refresh_token TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT 'identify',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS discord_voice_rooms (
          guild_id TEXT NOT NULL,
          voice_channel_id TEXT NOT NULL,
          room_code TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (guild_id, voice_channel_id),
          UNIQUE (room_code)
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS discord_web_sessions (
          session_hash TEXT PRIMARY KEY,
          discord_user_id TEXT NOT NULL REFERENCES discord_authorizations(discord_user_id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS discord_web_sessions_expiry_idx ON discord_web_sessions (expires_at)');
      await pool.query(`CREATE TABLE IF NOT EXISTS discord_oauth_states (state_hash TEXT PRIMARY KEY, room_code TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`);
      await pool.query('CREATE INDEX IF NOT EXISTS discord_oauth_states_expiry_idx ON discord_oauth_states (expires_at)');
    },

    async saveOAuthState(state, roomCode, expiresAt) {
      const hash = createHash('sha256').update(state).digest('hex');
      await pool.query('INSERT INTO discord_oauth_states (state_hash, room_code, expires_at) VALUES ($1, $2, $3)', [hash, roomCode, new Date(expiresAt)]);
    },

    async consumeOAuthState(state) {
      const hash = createHash('sha256').update(String(state || '')).digest('hex');
      const result = await pool.query('DELETE FROM discord_oauth_states WHERE state_hash = $1 AND expires_at > NOW() RETURNING room_code', [hash]);
      return result.rows[0]?.room_code ?? null;
    },

    async createWebSession(discordUserId, rawToken, expiresAt) {
      const hash = createHash('sha256').update(rawToken).digest('hex');
      await pool.query('INSERT INTO discord_web_sessions (session_hash, discord_user_id, expires_at) VALUES ($1, $2, $3)', [hash, discordUserId, new Date(expiresAt)]);
    },

    async getWebSession(rawToken) {
      const hash = createHash('sha256').update(String(rawToken || '')).digest('hex');
      const result = await pool.query(`SELECT a.discord_user_id, a.username FROM discord_web_sessions s JOIN discord_authorizations a USING (discord_user_id) WHERE s.session_hash = $1 AND s.expires_at > NOW()`, [hash]);
      return result.rows[0] ? { discordUserId: result.rows[0].discord_user_id, username: result.rows[0].username } : null;
    },

    async deleteWebSession(rawToken) {
      const hash = createHash('sha256').update(String(rawToken || '')).digest('hex');
      await pool.query('DELETE FROM discord_web_sessions WHERE session_hash = $1', [hash]);
    },

    async deleteAuthorization(discordUserId) {
      await pool.query('DELETE FROM discord_authorizations WHERE discord_user_id = $1', [discordUserId]);
    },

    async getVoiceRoom(guildId, voiceChannelId) {
      const result = await pool.query('SELECT room_code FROM discord_voice_rooms WHERE guild_id = $1 AND voice_channel_id = $2', [guildId, voiceChannelId]);
      return result.rows[0]?.room_code ?? null;
    },

    async getVoiceRoomByCode(roomCode) {
      const result = await pool.query('SELECT guild_id, voice_channel_id FROM discord_voice_rooms WHERE room_code = $1', [roomCode]);
      const row = result.rows[0];
      return row ? { guildId: row.guild_id, voiceChannelId: row.voice_channel_id } : null;
    },

    async saveAuthorization({ discordUserId, username, refreshToken, scope = 'identify' }) {
      await pool.query(`
        INSERT INTO discord_authorizations (discord_user_id, username, encrypted_refresh_token, scope)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (discord_user_id) DO UPDATE SET
          username = EXCLUDED.username,
          encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
          scope = EXCLUDED.scope,
          updated_at = NOW()
      `, [discordUserId, username, encryptDiscordToken(refreshToken), scope]);
    },

    async getAuthorization(discordUserId) {
      const result = await pool.query(
        'SELECT discord_user_id, username, encrypted_refresh_token, scope FROM discord_authorizations WHERE discord_user_id = $1',
        [discordUserId],
      );
      const row = result.rows[0];
      return row ? { discordUserId: row.discord_user_id, username: row.username, refreshToken: decryptDiscordToken(row.encrypted_refresh_token), scope: row.scope } : null;
    },

    async saveVoiceRoom(guildId, voiceChannelId, roomCode) {
      await pool.query(`
        INSERT INTO discord_voice_rooms (guild_id, voice_channel_id, room_code)
        VALUES ($1, $2, $3)
        ON CONFLICT (guild_id, voice_channel_id) DO UPDATE SET room_code = EXCLUDED.room_code, updated_at = NOW()
      `, [guildId, voiceChannelId, roomCode]);
    },

    async deleteVoiceRoom(guildId, voiceChannelId) {
      await pool.query('DELETE FROM discord_voice_rooms WHERE guild_id = $1 AND voice_channel_id = $2', [guildId, voiceChannelId]);
    },

    async close() {
      await pool.end();
    },
  };
}
