/**
 * Chave de conexão por papel.
 *
 * Uma conexão entre duas pessoas pode existir nos dois sentidos ao mesmo tempo
 * (eu transmito e eu assisto). Antes, tudo era indexado só pelo peerId e a
 * segunda criação derrubava a primeira. A chave separa os papéis:
 * `sender:<peerId>` (eu mando) e `receiver:<peerId>` (eu recebo).
 */

/** Papel da conexão em relação a este par de peers. */
export type LinkRole = 'sender' | 'receiver';

/** Chave interna de uma conexão: papel + peer. */
export const linkKey = (role: LinkRole, peerId: string): string => `${role}:${peerId}`;

/**
 * Desfaz a chave. Devolve null quando a chave não é válida (papel desconhecido
 * ou peer vazio) — nunca inventa um papel.
 */
export const parseLinkKey = (key: string): { role: LinkRole; peerId: string } | null => {
  if (typeof key !== 'string') return null;
  const separator = key.indexOf(':');
  if (separator <= 0) return null;
  const role = key.slice(0, separator);
  if (role !== 'sender' && role !== 'receiver') return null;
  const peerId = key.slice(separator + 1);
  if (!peerId) return null;
  return { role, peerId };
};

/**
 * Papel do outro lado da mesma conexão. O `linkRole` que viaja no
 * `ice-candidate` é sempre o oposto do papel de quem envia.
 */
export const oppositeRole = (role: LinkRole): LinkRole => (role === 'sender' ? 'receiver' : 'sender');

/** Papel recebido do servidor: só 'sender' e 'receiver' valem. */
export const asLinkRole = (value: unknown): LinkRole | null =>
  value === 'sender' || value === 'receiver' ? value : null;
