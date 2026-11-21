// ── Perfil do usuário (persistido no localStorage) ──────

export interface UserProfile {
  nickname: string;
  avatarColor: string;
  avatarImage: string | null; // base64 data URL da foto
}

const STORAGE_KEY = 'telinha-profile';
const MAX_AVATAR_SIZE = 128; // px — tamanho máximo do avatar salvo

// Paleta de cores para avatares
const AVATAR_COLORS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c',
  '#3498db', '#9b59b6', '#e84393', '#fd79a8', '#6c5ce7',
  '#00cec9', '#ff7675', '#a29bfe', '#ffeaa7', '#55efc4',
];

/** Gera uma cor determinística a partir de uma string */
export function colorFromString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Extrai as iniciais de um nome (máx 2 letras) */
export function getInitials(name: string): string {
  if (!name.trim()) return '?';
  return name
    .trim()
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Gera um avatar SVG como data URL */
export function generateAvatarSvg(nickname: string, color?: string): string {
  const initials = getInitials(nickname);
  const bgColor = color || colorFromString(nickname);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="32" fill="${bgColor}"/>
    <text x="32" y="33" text-anchor="middle" dominant-baseline="central" fill="white" font-family="system-ui,sans-serif" font-size="22" font-weight="600">${initials}</text>
  </svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Avatar placeholder para quem não tem nickname */
export function getPlaceholderAvatar(): string {
  return generateAvatarSvg('?', '#555555');
}

/** Redimensiona uma imagem para caber no avatar (retorna base64 JPEG) */
export function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = MAX_AVATAR_SIZE;
        canvas.height = MAX_AVATAR_SIZE;
        const ctx = canvas.getContext('2d')!;

        // Crop quadrado centralizado
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;

        ctx.drawImage(img, sx, sy, size, size, 0, 0, MAX_AVATAR_SIZE, MAX_AVATAR_SIZE);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Carrega o perfil salvo */
export function loadProfile(): UserProfile | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      const profile = JSON.parse(data) as UserProfile;
      if (profile.nickname) return profile;
    }
  } catch {
    // localStorage indisponível ou corrompido
  }
  return null;
}

/** Salva o perfil */
export function saveProfile(nickname: string, avatarImage?: string | null): UserProfile {
  const existing = loadProfile();
  const profile: UserProfile = {
    nickname: nickname.trim(),
    avatarColor: colorFromString(nickname.trim()),
    avatarImage: avatarImage !== undefined ? avatarImage : (existing?.avatarImage || null),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // localStorage indisponível
  }
  return profile;
}

/** Remove o perfil */
export function clearProfile(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** Retorna a URL do avatar (foto > iniciais > placeholder) */
export function getAvatarUrl(profile: UserProfile | null, nickname?: string): string {
  if (profile?.avatarImage) return profile.avatarImage;
  const name = profile?.nickname || nickname || '';
  if (name.trim()) return generateAvatarSvg(name);
  return getPlaceholderAvatar();
}
