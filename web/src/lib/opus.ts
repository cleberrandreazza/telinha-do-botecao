/**
 * Negocia preferências de recepção Opus até 320 kbps e anuncia a capacidade
 * estéreo da origem somente quando a track informa a quantidade de canais.
 * Os parâmetros SDP não garantem que o bitrate efetivo atinja 320 kbps.
 */
export const OPUS_MAX_AVERAGE_BITRATE = 320_000;

function configureOpusSdp(sdp: string, sourceChannels?: number | null, preferStereo = true): string {
  const opusMatch = sdp.match(/^a=rtpmap:(\d+)\s+opus\/48000\/2\s*$/im);
  if (!opusMatch) return sdp;

  const payloadType = opusMatch[1];
  const fmtpRegex = new RegExp(`^a=fmtp:${payloadType}\\s+([^\\r\\n]*)$`, 'im');
  const fmtpMatch = sdp.match(fmtpRegex);

  const updates = new Map<string, string>([
    ['stereo', preferStereo ? '1' : '0'],
    ['maxaveragebitrate', String(OPUS_MAX_AVERAGE_BITRATE)],
  ]);

  // RFC 7587 define sprop-stereo como indicação exclusiva do transmissor.
  // Não declare estéreo se a track capturada for mono ou se o navegador
  // não expuser a quantidade de canais.
  if (typeof sourceChannels === 'number' && Number.isFinite(sourceChannels)) {
    if (sourceChannels === 1) updates.set('sprop-stereo', '0');
    else if (sourceChannels >= 2) updates.set('sprop-stereo', '1');
  }

  if (fmtpMatch) {
    const params = new Map<string, string>();
    for (const part of fmtpMatch[1].split(';')) {
      const item = part.trim();
      if (!item) continue;
      const eq = item.indexOf('=');
      if (eq === -1) params.set(item.toLowerCase(), '');
      else params.set(item.slice(0, eq).trim().toLowerCase(), item.slice(eq + 1).trim());
    }
    for (const [key, value] of updates) params.set(key, value);
    const merged = [...params.entries()]
      .map(([key, value]) => (value === '' ? key : `${key}=${value}`))
      .join(';');
    return sdp.replace(fmtpMatch[0], `a=fmtp:${payloadType} ${merged}`);
  }

  const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
  const defaults = new Map<string, string>([
    ['minptime', '10'],
    ['useinbandfec', '1'],
    ...updates,
  ]);
  const line = `a=fmtp:${payloadType} ${[...defaults.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .join(';')}`;
  return sdp.replace(opusMatch[0], `${opusMatch[0]}${newline}${line}`);
}

/**
 * SDP gerado por quem compartilha: preferências locais de recepção e,
 * quando conhecido, capacidade estéreo da track capturada.
 */
export function configureOpusSenderSdp(sdp: string, sourceChannels?: number | null): string {
  return configureOpusSdp(sdp, sourceChannels);
}

/**
 * SDP gerado pelo espectador: declara o que ele aceita receber, sem afirmar
 * que o próprio espectador envia áudio estéreo. Se a origem anuncia mono,
 * solicita mono para evitar upmix artificial no transmissor.
 */
export function configureOpusReceiverSdp(sdp: string, sourceLikelyStereo?: boolean | null): string {
  return configureOpusSdp(sdp, null, sourceLikelyStereo !== false);
}
