import {
  blockedVoiceMessage,
  discordSlashPost,
  ensureVoiceRoom,
  entryLinks,
  normalizeWebOrigin,
  parseJoinButtonId,
  sameVoiceChannel,
} from './discord-rooms.mjs';

/**
 * Bot opcional. Sem `DISCORD_BOT_TOKEN` e `DISCORD_CLIENT_ID` o servidor
 * de sinalização segue igual.
 *
 * @param {{
 *   rooms: Map<string, object>,
 *   holdEmptyRoom?: (room: object) => void,
 *   issueVoiceTicket?: (room: object) => string,
 * }} options
 */
export async function startDiscordBot({ rooms, holdEmptyRoom, issueVoiceTicket }) {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  if (!token || !clientId) {
    console.log('[discord] bot desligado (sem DISCORD_BOT_TOKEN ou DISCORD_CLIENT_ID)');
    return;
  }

  let discord;
  try {
    discord = await import('discord.js');
  } catch {
    console.error('[discord] discord.js indisponível; sinalização segue sem o bot');
    return;
  }

  const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
  } = discord;

  const command = new SlashCommandBuilder()
    .setName('telinha')
    .setDescription('Abrir a Telinha do Botecão desta call')
    .addBooleanOption((option) => option
      .setName('privada')
      .setDescription('Não mostrar o botão no chat público')
      .setRequired(false));

  try {
    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(Routes.applicationCommands(clientId), { body: [command.toJSON()] });
  } catch {
    console.error('[discord] não foi possível registrar /telinha; o resto do servidor segue');
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  async function replyEphemeral(interaction, payload) {
    await interaction.reply({ ...payload, ephemeral: true });
  }

  async function onSlash(interaction) {
    const requestedPrivate = interaction.options.getBoolean('privada') === true;
    const voiceChannelId = interaction.guild?.voiceStates?.cache?.get(interaction.user.id)?.channelId
      || interaction.member?.voice?.channelId
      || null;

    if (!voiceChannelId) {
      await replyEphemeral(interaction, {
        content: 'Entre em um canal de voz e use /telinha de novo. A sala fica ligada a essa call.',
      });
      return;
    }

    const { room, created } = ensureVoiceRoom(rooms, voiceChannelId, requestedPrivate);
    if (created) holdEmptyRoom?.(room);

    const post = discordSlashPost(voiceChannelId, requestedPrivate, room);
    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle(post.title)
      .setDescription(post.description);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(post.customId)
        .setLabel(post.label)
        .setStyle(ButtonStyle.Primary),
    );

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: post.ephemeral,
    });
  }

  async function onJoinButton(interaction) {
    const voiceChannelId = parseJoinButtonId(interaction.customId);
    if (!voiceChannelId) {
      await replyEphemeral(interaction, { content: 'Este botão não abre mais uma sala.' });
      return;
    }

    const memberChannelId = interaction.member?.voice?.channelId ?? null;
    if (!sameVoiceChannel(memberChannelId, voiceChannelId)) {
      await replyEphemeral(interaction, { content: blockedVoiceMessage(voiceChannelId) });
      return;
    }

    const { room, created } = ensureVoiceRoom(rooms, voiceChannelId, false);
    if (created) holdEmptyRoom?.(room);
    if (!room.discordRestricted || typeof issueVoiceTicket !== 'function') {
      await replyEphemeral(interaction, { content: 'Não foi possível abrir a Telinha agora.' });
      return;
    }

    const ticket = issueVoiceTicket(room);
    const links = entryLinks({
      origin: normalizeWebOrigin(process.env.PUBLIC_WEB_URL),
      code: room.code,
      ticket,
    });
    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle('Sua entrada na Telinha')
      .setDescription(
        `O convite vale 45 segundos e só uma vez.\n[Assistir no navegador](${links.web})\nApp: ${links.app}`,
      );

    await replyEphemeral(interaction, { embeds: [embed] });
  }

  client.on('error', () => {});
  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isButton()) {
        await onJoinButton(interaction);
        return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === 'telinha') {
        await onSlash(interaction);
      }
    } catch {
      if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Não foi possível abrir a Telinha agora.',
          ephemeral: true,
        }).catch(() => {});
      }
    }
  });

  try {
    await client.login(token);
    console.log('[discord] /telinha no ar');
  } catch {
    console.error('[discord] login falhou; sinalização segue sem o bot');
  }
}
