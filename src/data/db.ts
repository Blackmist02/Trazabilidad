import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ImageData64 } from '../lib/imageData';
import type { Visit } from '../lib/visits';

interface TrazabilidadDB extends DBSchema {
  visits: {
    key: string;
    value: Visit;
    indexes: { by_visited_at: string; by_sync_state: string };
  };
  meta: {
    key: string;
    value: string;
  };
  images: {
    key: string;
    value: StoredImage;
  };
}

/**
 * Imagen del texto de la credencial de una visita. Se guarda como data URL (texto):
 * en Safari de iOS es más fiable que Blob o ArrayBuffer en IndexedDB.
 */
export interface StoredImage extends ImageData64 {
  /** id de la visita */
  id: string;
  /** true cuando ya está en Supabase Storage (o se descargó de allí). */
  uploaded: boolean;
}

/** Almacén local de registros en IndexedDB. Persiste entre sesiones del navegador en este dispositivo. */
export class VisitStore {
  private dbPromise: Promise<IDBPDatabase<TrazabilidadDB>>;

  constructor(name = 'trazabilidad') {
    this.dbPromise = openDB<TrazabilidadDB>(name, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const visits = db.createObjectStore('visits', { keyPath: 'id' });
          visits.createIndex('by_visited_at', 'visited_at');
          visits.createIndex('by_sync_state', 'sync_state');
          db.createObjectStore('meta');
        }
        if (oldVersion < 2) db.createObjectStore('images', { keyPath: 'id' });
      },
    });
  }

  async all(): Promise<Visit[]> {
    const db = await this.dbPromise;
    const list = await db.getAllFromIndex('visits', 'by_visited_at');
    return list.reverse();
  }

  async get(id: string): Promise<Visit | undefined> {
    return (await this.dbPromise).get('visits', id);
  }

  async put(visit: Visit): Promise<void> {
    await (await this.dbPromise).put('visits', visit);
  }

  async putMany(visits: Visit[]): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('visits', 'readwrite');
    await Promise.all([...visits.map((v) => tx.store.put(v)), tx.done]);
  }

  /** Guarda la visita y su imagen en una sola transacción. */
  async putWithImage(visit: Visit, image: ImageData64): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(['visits', 'images'], 'readwrite');
    await Promise.all([
      tx.objectStore('visits').put(visit),
      tx.objectStore('images').put({ id: visit.id, dataUrl: image.dataUrl, type: image.type, uploaded: false }),
      tx.done,
    ]);
  }

  async getImage(id: string): Promise<StoredImage | undefined> {
    return (await this.dbPromise).get('images', id);
  }

  async putImage(image: StoredImage): Promise<void> {
    await (await this.dbPromise).put('images', image);
  }

  /** Imágenes aún no subidas a Supabase. */
  async imagesToUpload(): Promise<StoredImage[]> {
    return (await (await this.dbPromise).getAll('images')).filter((i) => !i.uploaded);
  }

  async pending(): Promise<Visit[]> {
    return (await this.dbPromise).getAllFromIndex('visits', 'by_sync_state', 'pending');
  }

  async count(): Promise<number> {
    return (await this.dbPromise).count('visits');
  }

  /** Elimina registros. Con `keepPending` conserva los que aún no se han enviado al servidor. */
  async clear(options: { keepPending?: boolean; onlyStates?: Visit['sync_state'][] } = {}): Promise<number> {
    const db = await this.dbPromise;
    const tx = db.transaction(['visits', 'images'], 'readwrite');
    const images = tx.objectStore('images');
    let removed = 0;
    let cursor = await tx.objectStore('visits').openCursor();
    while (cursor) {
      const v = cursor.value;
      const keep = (options.keepPending && v.sync_state === 'pending') || (options.onlyStates && !options.onlyStates.includes(v.sync_state));
      if (!keep) {
        await cursor.delete();
        // La imagen local se borra con su visita (una imagen aún no subida solo existe aquí).
        await images.delete(v.id);
        removed++;
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return removed;
  }

  async getMeta(key: string): Promise<string | undefined> {
    return (await this.dbPromise).get('meta', key);
  }

  async setMeta(key: string, value: string): Promise<void> {
    await (await this.dbPromise).put('meta', value, key);
  }

  async deleteMeta(key: string): Promise<void> {
    await (await this.dbPromise).delete('meta', key);
  }
}
