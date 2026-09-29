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

/** Load the saved project and the audio it uses; unused audio is deleted. */
export async function loadStudio(): Promise<{ project: Project; buffers: StoredBuffer[] } | null> {
  const database = await db();
  const project = await result(database.transaction("project").objectStore("project").get(PROJECT_KEY)) as Project | undefined;
  if (!project) return null;
  const tx = database.transaction("buffers", "readwrite");
  const store = tx.objectStore("buffers");
  const all = await result(store.getAll()) as StoredBuffer[];
  const used = new Set(project.clips.map((c) => c.bufferId));
  for (const buffer of all) if (!used.has(buffer.id)) store.delete(buffer.id);
  await done(tx);
  return { project, buffers: all.filter((b) => used.has(b.id)) };
}

export async function clearStudio(): Promise<void> {
  const tx = (await db()).transaction(["project", "buffers"], "readwrite");
  tx.objectStore("project").clear();
  tx.objectStore("buffers").clear();
  await done(tx);
}
