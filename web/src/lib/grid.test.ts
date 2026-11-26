import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_GRID_MODE,
  GRID_MODES,
  GRID_MODE_KEY,
  gridClassForMode,
  gridFullLabel,
  isGridFull,
  isGridMode,
  limitNoticeForMode,
  loadGridMode,
  maxStreamsForMode,
  saveGridMode,
} from './grid.ts';
import type { StorageLike } from './session.ts';

/** Storage falso, para não depender do localStorage do Node. */
function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
  };
}

test('os modos da grade sao 1, 2 e 4', () => {
  assert.deepEqual([...GRID_MODES], [1, 2, 4]);
});

test('reconhece somente os modos validos', () => {
  assert.equal(isGridMode(1), true);
  assert.equal(isGridMode(2), true);
  assert.equal(isGridMode(4), true);
  assert.equal(isGridMode(3), false);
  assert.equal(isGridMode(0), false);
  assert.equal(isGridMode('2'), false);
  assert.equal(isGridMode(null), false);
});

test('o limite de transmissões vem do modo', () => {
  assert.equal(maxStreamsForMode(1), 1);
  assert.equal(maxStreamsForMode(2), 2);
  assert.equal(maxStreamsForMode(4), 4);
});

test('cada modo tem o layout de grade correspondente', () => {
  assert.equal(gridClassForMode(1), 'grid-cols-1');
  assert.equal(gridClassForMode(2), 'grid-cols-2');
  assert.equal(gridClassForMode(4), 'grid-cols-2 grid-rows-2');
});

test('sem preferencia salva, usa o modo padrao', () => {
  assert.equal(loadGridMode(fakeStorage()), DEFAULT_GRID_MODE);
  assert.equal(loadGridMode(null), DEFAULT_GRID_MODE);
});

test('o modo salvo e recuperado', () => {
  const storage = fakeStorage();
  saveGridMode(2, storage);
  assert.equal(storage.getItem(GRID_MODE_KEY), '2');
  assert.equal(loadGridMode(storage), 2);
});

test('modo salvo invalido volta para o padrao', () => {
  assert.equal(loadGridMode(fakeStorage({ [GRID_MODE_KEY]: '3' })), DEFAULT_GRID_MODE);
  assert.equal(loadGridMode(fakeStorage({ [GRID_MODE_KEY]: 'lixo' })), DEFAULT_GRID_MODE);
});

test('o aviso de limite usa o plural certo', () => {
  assert.equal(limitNoticeForMode(1), 'Máximo de 1 transmissão simultânea');
  assert.equal(limitNoticeForMode(2), 'Máximo de 2 transmissões simultâneas');
  assert.equal(limitNoticeForMode(4), 'Máximo de 4 transmissões simultâneas');
});

test('a grade fica cheia quando o numero de lives watching bate o modo', () => {
  assert.equal(isGridFull(0, 4), false);
  assert.equal(isGridFull(3, 4), false);
  assert.equal(isGridFull(4, 4), true);
  assert.equal(isGridFull(5, 4), true);
  assert.equal(isGridFull(1, 1), true);
  assert.equal(isGridFull(2, 2), true);
});

test('o aviso de grade cheia mostra o modo', () => {
  assert.equal(gridFullLabel(1), 'Grade cheia (modo 1)');
  assert.equal(gridFullLabel(2), 'Grade cheia (modo 2)');
  assert.equal(gridFullLabel(4), 'Grade cheia (modo 4)');
});
