// Studio autosave: the current project and its audio in IndexedDB. Data
// stays in this browser; nothing is uploaded.

import type { Project } from "./project";

const DB_NAME = "body-synth-studio";
const PROJECT_KEY = "current";

export interface StoredBuffer {
  id: string;
  sampleRate: number;
  channels: Float32Array[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("project");
      req.result.createObjectStore("buffers", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(project: Project): Promise<void> {
  const tx = (await db()).transaction("project", "readwrite");
  tx.objectStore("project").put(project, PROJECT_KEY);
  await done(tx);
}

export async function saveBuffer(buffer: StoredBuffer): Promise<void> {
  const tx = (await db()).transaction("buffers", "readwrite");
  tx.objectStore("buffers").put(buffer);
  await done(tx);
}

/**
 * Restore one consistent snapshot without changing another tab's pending takes.
 * Unreferenced audio remains until explicit New clears the saved project.
 */
export async function loadStudio(): Promise<{ project: Project; buffers: StoredBuffer[] } | null> {
  const tx = (await db()).transaction(["project", "buffers"], "readonly");
  const completed = done(tx);
  const restored = (async () => {
    const project = await result(tx.objectStore("project").get(PROJECT_KEY)) as Project | undefined;
    if (!project) return null;
    const store = tx.objectStore("buffers");
    const ids = new Set(project.clips.map((clip) => clip.bufferId));
    const loaded = await Promise.all([...ids].map(id => result(store.get(id)) as Promise<StoredBuffer | undefined>));
    return { project, buffers: loaded.filter((buffer): buffer is StoredBuffer => buffer !== undefined) };
  })();
  const [, saved] = await Promise.all([completed, restored]);
  return saved;
}

export async function clearStudio(): Promise<void> {
  const tx = (await db()).transaction(["project", "buffers"], "readwrite");
  tx.objectStore("project").clear();
  tx.objectStore("buffers").clear();
  await done(tx);
}
