import { validateTitle, type Recording } from './domain.js';

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error('The local storage transaction was interrupted.'));
    tx.onerror = () => reject(tx.error ?? new Error('Local storage failed.'));
  });
}
export class Library {
  private constructor(private readonly db: IDBDatabase) {}
  static async open(): Promise<Library> {
    const request = indexedDB.open('chripify-extension', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('recordings', { keyPath: 'id' });
      db.createObjectStore('chunks', { keyPath: ['recordingId', 'index'] }).createIndex(
        'recordingId',
        'recordingId'
      );
    };
    const db = await result(request);
    db.onversionchange = () => db.close();
    return new Library(db);
  }
  async create(recording: Recording): Promise<void> {
    const tx = this.db.transaction('recordings', 'readwrite');
    const done = finished(tx);
    tx.objectStore('recordings').add(recording);
    await done;
  }
  async append(id: string, index: number, blob: Blob): Promise<void> {
    const tx = this.db.transaction(['recordings', 'chunks'], 'readwrite');
    const done = finished(tx);
    const store = tx.objectStore('recordings');
    const request = store.get(id) as IDBRequest<Recording | undefined>;
    request.onsuccess = () => {
      const record = request.result;
      if (!record || record.state !== 'recording' || record.chunkCount !== index) {
        tx.abort();
        return;
      }
      tx.objectStore('chunks').add({ recordingId: id, index, blob });
      store.put({ ...record, chunkCount: index + 1, bytes: record.bytes + blob.size });
    };
    await done;
  }
  async list(): Promise<Recording[]> {
    return result(
      this.db.transaction('recordings').objectStore('recordings').getAll() as IDBRequest<
        Recording[]
      >
    );
  }
  async update(
    id: string,
    changes: Partial<Pick<Recording, 'title' | 'state' | 'durationMs'>>
  ): Promise<void> {
    if (changes.title !== undefined) changes = { ...changes, title: validateTitle(changes.title) };
    const tx = this.db.transaction('recordings', 'readwrite');
    const done = finished(tx);
    const store = tx.objectStore('recordings');
    const request = store.get(id) as IDBRequest<Recording | undefined>;
    request.onsuccess = () => {
      if (!request.result) {
        tx.abort();
        return;
      }
      store.put({ ...request.result, ...changes });
    };
    await done;
  }
  async recover(): Promise<void> {
    for (const recording of await this.list()) {
      if (recording.state === 'recording')
        await this.update(recording.id, { state: 'interrupted' });
    }
  }
  async blob(recording: Recording): Promise<Blob> {
    const tx = this.db.transaction('chunks');
    const request = tx
      .objectStore('chunks')
      .index('recordingId')
      .getAll(recording.id) as IDBRequest<Array<{ index: number; blob: Blob }>>;
    const chunks = await result(request);
    chunks.sort((a, b) => a.index - b.index);
    if (
      !chunks.length ||
      chunks.length !== recording.chunkCount ||
      chunks.reduce((bytes, chunk) => bytes + chunk.blob.size, 0) !== recording.bytes ||
      chunks.some((chunk, i) => chunk.index !== i)
    )
      throw new Error('Recording chunks are missing. This recording cannot be assembled safely.');
    return new Blob(
      chunks.map((c) => c.blob),
      { type: recording.mimeType }
    );
  }
  async delete(id: string): Promise<void> {
    const tx = this.db.transaction(['recordings', 'chunks'], 'readwrite');
    const done = finished(tx);
    const cursor = tx.objectStore('chunks').index('recordingId').openCursor(IDBKeyRange.only(id));
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (item) {
        item.delete();
        item.continue();
      }
    };
    tx.objectStore('recordings').delete(id);
    await done;
  }
}
