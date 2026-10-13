import { config } from '@/lib/config';
import { buildSeed } from '@/mock-data';

/**
 * Versioned localStorage adapter for the shared demo workspace.
 *
 * One workspace document is shared by every demo user in this browser, so
 * switching accounts never forks the data. Large binaries are NOT stored here —
 * uploaded files go to IndexedDB (see blobStore.js) and generated images are
 * stored as small render descriptions.
 *
 * This is demo persistence only. It is not a database: clearing site data, using
 * another browser or another device will show a fresh demo workspace.
 */
const KEY = `${config.storageKey}.v${config.storageVersion}`;
const listeners = new Set();
let state = null;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      state = JSON.parse(raw);
      return;
    }
  } catch {
    // corrupted or unavailable storage — fall back to a fresh seed
  }
  state = buildSeed();
  persist();
  // remove data written by older schema versions
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(`${config.storageKey}.v`) && k !== KEY)
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    const e = new Error('Browser storage is full or unavailable. Your latest change could not be saved.');
    e.cause = err;
    throw e;
  }
}

export function getDb() {
  if (!state) load();
  return state;
}

/** Applies a mutation to the workspace and persists it. */
export function mutate(fn) {
  const db = getDb();
  const result = fn(db);
  persist();
  listeners.forEach((l) => l());
  return result;
}

export function resetDb() {
  state = buildSeed();
  persist();
  listeners.forEach((l) => l());
}

export function subscribeDb(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dbSizeBytes() {
  try {
    return new Blob([localStorage.getItem(KEY) || '']).size;
  } catch {
    return 0;
  }
}

// Keep tabs in sync: another tab saved the workspace → reload it here.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && e.newValue) {
      try {
        state = JSON.parse(e.newValue);
        listeners.forEach((l) => l());
      } catch {
        /* ignore */
      }
    }
  });
}
