import { ensureVoiceRoom, normalizeWebOrigin, restoreVoiceRoom } from './discord-rooms.mjs';

export async function startDiscordBot({ rooms, holdEmptyRoom, store, onVoiceMembership }) {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  if (!token || !clientId) {
    console.log('[discord] bot desligado (sem DISCORD_BOT_TOKEN ou DISCORD_CLIENT_ID)');
    return null;
  }

  const discord = await import('discord.js');
  const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = discord;
  const command = new SlashCommandBuilder()
    .setName('telinha')
    .setDescription('Criar ou abrir a Telinha vinculada a este canal de voz');

  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: [command.toJSON()] });

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  const voiceMembers = new Map();
  function updateMember(memberId, guildId, channelId) {
    if (channelId) voiceMembers.set(memberId, { guildId, channelId });
    else voiceMembers.delete(memberId);
    onVoiceMembership?.(memberId, channelId ? { guildId, channelId } : null);
  }

  client.on('voiceStateUpdate', (oldState, newState) => {
    const memberId = newState.id || oldState.id;
    const guildId = newState.guild.id;
    updateMember(memberId, guildId, newState.channelId);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'telinha') return;
    try {
      const voiceChannelId = interaction.guild?.voiceStates?.cache?.get(interaction.user.id)?.channelId
        || interaction.member?.voice?.channelId;
      if (!voiceChannelId || !interaction.guildId) {
        await interaction.reply({ content: 'Entre em um canal de voz e use /telinha novamente.', ephemeral: true });
        return;
      }

      updateMember(interaction.user.id, interaction.guildId, voiceChannelId);
      const persistedCode = await store.getVoiceRoom(interaction.guildId, voiceChannelId);
      const restored = persistedCode ? restoreVoiceRoom(rooms, persistedCode, voiceChannelId, interaction.guildId) : null;
      const ensured = restored ? { room: restored, created: false } : ensureVoiceRoom(rooms, voiceChannelId, interaction.guildId);
      const { room, created } = ensured;
      if (created) holdEmptyRoom?.(room);
      await store.saveVoiceRoom(interaction.guildId, voiceChannelId, room.code);

      const origin = normalizeWebOrigin(process.env.PUBLIC_WEB_URL);
      const url = `${origin}/abrir/${room.code}?source=discord`;
      const button = new ButtonBuilder().setLabel('Entrar na Telinha').setStyle(ButtonStyle.Link).setURL(url);
      const row = new ActionRowBuilder().addComponents(button);
      await interaction.reply({
        content: `Sala vinculada ao canal **${interaction.guild.channels.cache.get(voiceChannelId)?.name || 'voz'}**. Compartilhe este link com quem está na call. Cada pessoa autoriza o Discord uma vez; a entrada só funciona enquanto estiver neste canal. ${created ? '' : 'Reutilizando a sala existente.'}`,
        components: [row],
        ephemeral: true,
      });
    } catch (error) {
      console.error('[discord] comando /telinha falhou:', error.message);
      if (interaction.isRepliable() && !interaction.replied) {
        await interaction.reply({ content: 'Não foi possível abrir a Telinha agora.', ephemeral: true }).catch(() => {});
      }
    }
  });

  client.on('error', (error) => console.error('[discord] client error:', error.message));
  await client.login(token);
  for (const guild of client.guilds.cache.values()) {
    await guild.voiceStates.fetch().catch(() => {});
    for (const state of guild.voiceStates.cache.values()) {
      if (state.channelId && state.member?.user?.id) updateMember(state.member.user.id, guild.id, state.channelId);
    }
  }

  return {
    getVoiceMembership(discordUserId, roomCode) {
      const room = rooms.get(roomCode);
      const membership = voiceMembers.get(discordUserId);
      if (!room || !membership || membership.guildId !== room.guildId || membership.channelId !== room.voiceChannelId) {
        return { allowed: false };
      }
      return { allowed: true, guildId: room.guildId, voiceChannelId: room.voiceChannelId };
    },
  };
}
