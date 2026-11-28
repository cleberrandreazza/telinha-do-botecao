import {
  ensureVoiceRoom,
  entryLinks,
  normalizeWebOrigin,
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
      .setDescription('Manter esta sala marcada como privada')
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
    if (!room.discordRestricted || typeof issueVoiceTicket !== 'function') {
      await replyEphemeral(interaction, { content: 'Não foi possível abrir a Telinha agora.' });
      return;
    }

    // Cada execução do slash gera um ticket próprio, sem botão intermediário.
    const ticket = issueVoiceTicket(room);
    const links = entryLinks({
      origin: normalizeWebOrigin(process.env.PUBLIC_WEB_URL),
      redirectOrigin: process.env.PUBLIC_APP_REDIRECT_URL || process.env.RENDER_EXTERNAL_URL,
      code: room.code,
      ticket,
    });
    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle('Sua sala do Telinha está pronta!')
      .setDescription('Escolha como deseja entrar. Este convite vale 45 segundos e só pode ser usado uma vez.');

    const buttons = [
      new ButtonBuilder()
        .setLabel('Entrar pelo navegador')
        .setStyle(ButtonStyle.Link)
        .setURL(links.web),
    ];
    if (links.appWeb) {
      buttons.unshift(
        new ButtonBuilder()
          .setLabel('Abrir no aplicativo')
          .setStyle(ButtonStyle.Link)
          .setURL(links.appWeb),
      );
    }

    await replyEphemeral(interaction, {
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(...buttons)],
    });
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
