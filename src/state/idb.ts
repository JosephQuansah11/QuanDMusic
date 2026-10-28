/**
 * Project storage in IndexedDB, so the app works fully offline and nothing
 * ever leaves the device.
 */

import type { Score } from '../core/score';

const DB_NAME = 'quandmusic';
const DB_VERSION = 1;
const PROJECT_STORE = 'projects';
const AUDIO_STORE = 'audio';

export interface StoredProject {
  id: string;
  name: string;
  updatedAt: number;
  score: Score;
}

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  source: Score['source'];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open storage'));
  });
}

function transaction<T>(store: string, mode: IDBTransactionMode, run: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = run(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Storage error'));
        tx.oncomplete = () => db.close();
      }),
  );
}

function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveProject(score: Score, id?: string): Promise<string> {
  if (typeof indexedDB === 'undefined') return id ?? newId();
  const projectId = id ?? newId();
  const record: StoredProject = {
    id: projectId,
    name: score.title,
    updatedAt: Date.now(),
    score,
  };
  await transaction(PROJECT_STORE, 'readwrite', (store) => store.put(record));
  return projectId;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  if (typeof indexedDB === 'undefined') return [];
  const all = await transaction<StoredProject[]>(PROJECT_STORE, 'readonly', (store) => store.getAll());
  return all
    .map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      source: project.score.source,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Score | null> {
  if (typeof indexedDB === 'undefined') return null;
  const record = await transaction<StoredProject | undefined>(PROJECT_STORE, 'readonly', (store) => store.get(id));
  return record?.score ?? null;
}

export async function deleteProject(id: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await transaction(PROJECT_STORE, 'readwrite', (store) => store.delete(id));
  await transaction(AUDIO_STORE, 'readwrite', (store) => store.delete(id)).catch(() => undefined);
}

export async function saveAudio(id: string, blob: Blob): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await transaction(AUDIO_STORE, 'readwrite', (store) => store.put(blob, id));
}

export async function loadAudio(id: string): Promise<Blob | null> {
  if (typeof indexedDB === 'undefined') return null;
  const blob = await transaction<Blob | undefined>(AUDIO_STORE, 'readonly', (store) => store.get(id));
  return blob ?? null;
}
