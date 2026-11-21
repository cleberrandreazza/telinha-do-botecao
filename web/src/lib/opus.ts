/**
 * Pede Opus estéreo a 128 kbps. Não mexe no vídeo.
 * Se o Opus não estiver no SDP, o texto volta igual.
 * Parâmetros já presentes são atualizados, não duplicados.
 */
export function mungeOpusStereo(sdp: string): string {
  const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/);
  if (!opusMatch) return sdp;
  const payloadType = opusMatch[1];
  const fmtpRegex = new RegExp(`a=fmtp:${payloadType} ([^\\r\\n]*)`);
  const fmtpMatch = sdp.match(fmtpRegex);
  const stereo: Record<string, string> = {
    stereo: '1',
    'sprop-stereo': '1',
    maxaveragebitrate: '128000',
  };
  if (fmtpMatch) {
    const params = new Map<string, string>();
    for (const part of fmtpMatch[1].split(';')) {
      const item = part.trim();
      if (!item) continue;
      const eq = item.indexOf('=');
      if (eq === -1) params.set(item, '');
      else params.set(item.slice(0, eq), item.slice(eq + 1));
    }
    for (const [key, value] of Object.entries(stereo)) params.set(key, value);
    const merged = [...params.entries()].map(([key, value]) => (value === '' ? key : `${key}=${value}`)).join(';');
    return sdp.replace(fmtpMatch[0], `a=fmtp:${payloadType} ${merged}`);
  }
  const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
  const line = `a=fmtp:${payloadType} minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000`;
  return sdp.replace(opusMatch[0], `${opusMatch[0]}${newline}${line}`);
}
