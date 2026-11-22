// ── Constantes compartilhadas da sala ───────────────────

/**
 * Código da sala fixa: ela existe desde o boot do servidor, não precisa ser
 * criada e nunca é removida.
 *
 * ATENÇÃO: `server/index.mjs` define o MESMO código em `FIXED_ROOM_CODE`.
 * Os dois precisam ficar em sincronia — se mudar aqui, mude lá também.
 */
export const FIXED_ROOM_CODE = 'BOTECO';

/** Quantidade máxima de transmissões simultâneas em uma sala. */
export const MAX_SIMULTANEOUS_STREAMS = 4;
