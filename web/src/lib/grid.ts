// ── Modo da grade de transmissões ────────────────────────
//
// A grade tem três modos: 1 (uma live ocupa o palco inteiro), 2 (duas lado
// a lado, altura total) e 4 (2x2). O modo escolhido é persistido no
// localStorage e também define o limite de transmissões simultâneas: quem
// assiste no modo 1 só pede uma live por vez.
//
// As funções daqui são puras (decidem) — a Room e o App aplicam.

import type { GridMode } from './types';
import type { StorageLike } from './session';

/** Modos disponíveis, na ordem em que aparecem no seletor. */
export const GRID_MODES: readonly GridMode[] = [1, 2, 4];

/** Modo usado quando não há preferência salva (ou quando a salva é inválida). */
export const DEFAULT_GRID_MODE: GridMode = 4;

/** Chave usada no localStorage. */
export const GRID_MODE_KEY = 'telinha-grid-mode';

/** Teto absoluto de transmissões simultâneas (o maior modo de grade). */
export const MAX_SIMULTANEOUS_STREAMS = 4;

/** O valor é um modo de grade válido? (protege o localStorage de lixo) */
export function isGridMode(value: unknown): value is GridMode {
  return value === 1 || value === 2 || value === 4;
}

/** Quantas transmissões cabem na grade no modo escolhido. */
export function maxStreamsForMode(mode: GridMode): number {
  return mode;
}

/**
 * Aviso de limite de transmissões simultâneas, no plural certo.
 *
 * "Máximo de 1 transmissão simultânea" / "Máximo de 4 transmissões
 * simultâneas" — o texto aparece quando alguém já assiste o número máximo.
 */
export function limitNoticeForMode(mode: GridMode): string {
  const limit = maxStreamsForMode(mode);
  return limit === 1
    ? 'Máximo de 1 transmissão simultânea'
    : `Máximo de ${limit} transmissões simultâneas`;
}

/**
 * A grade está cheia?
 *
 * "Cheia" = já existem lives sendo assistidas no mesmo número de slots que
 * o modo permite. Nesse caso o botão "Assistir" da lista lateral fica
 * desabilitado (o aviso vai para a faixa âmbar do palco).
 */
export function isGridFull(watchedCount: number, mode: GridMode): boolean {
  return watchedCount >= maxStreamsForMode(mode);
}

/** Texto do aviso do botão "Assistir" quando a grade está cheia. */
export function gridFullLabel(mode: GridMode): string {
  return `Grade cheia (modo ${mode})`;
}

/**
 * Classes do contêiner da grade para o modo.
 *
 * As classes precisam ser literais no fonte: o Tailwind só gera o CSS que
 * ele vê escrito (troca dinâmica de classe não funciona).
 */
export function gridClassForMode(mode: GridMode): string {
  switch (mode) {
    case 1:
      return 'grid-cols-1';
    case 2:
      return 'grid-cols-2';
    case 4:
      return 'grid-cols-2 grid-rows-2';
  }
}

/** Storage padrão: o `localStorage` do browser, ou `null` se indisponível. */
function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Carrega o modo salvo. Devolve o modo padrão quando não há nada salvo ou
 * quando o valor guardado não é um modo válido.
 */
export function loadGridMode(storage?: StorageLike | null): GridMode {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return DEFAULT_GRID_MODE;
  try {
    const raw = store.getItem(GRID_MODE_KEY);
    if (!raw) return DEFAULT_GRID_MODE;
    const parsed = Number(raw);
    return isGridMode(parsed) ? parsed : DEFAULT_GRID_MODE;
  } catch {
    return DEFAULT_GRID_MODE;
  }
}

/** Salva o modo escolhido. Falhas de storage são silenciosas. */
export function saveGridMode(mode: GridMode, storage?: StorageLike | null): void {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return;
  try {
    store.setItem(GRID_MODE_KEY, String(mode));
  } catch {
    // storage indisponível
  }
}
