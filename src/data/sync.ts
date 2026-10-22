import type { Visit } from '../lib/visits';
import type { VisitStore } from './db';
import { classifyRemoteError, fromRemoteRow, isNetworkFailure, RemoteError, type RemoteVisits, toRemoteRow } from './remote';

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error' | 'unauthorized';

export interface SyncResult {
  phase: SyncPhase;
  pushed: number;
  pulled: number;
  pending: number;
  /** Imágenes subidas en esta pasada y las que siguen pendientes. */
  imagesPushed: number;
  imagesPending: number;
  error: string | null;
  at: string;
}

const LAST_PULL_KEY = 'lastPullUpdatedAt';
const BATCH = 50;
const PAGE = 500;

export interface SyncDeps {
  store: VisitStore;
  remote: RemoteVisits;
  standId: string;
  isOnline: () => boolean;
}

/**
 * Sincronización con Supabase:
 * 1. Envía registros pendientes (inserción idempotente por id: reintentar no duplica).
 * 2. Envía correcciones (nombre/notas); el servidor guarda la auditoría con un trigger.
 * 3. Sube las imágenes de las credenciales de visitas ya enviadas. Un fallo aquí no frena el resto:
 *    la imagen queda en el dispositivo y se reintenta en la siguiente pasada.
 * 4. Descarga cambios del mismo stand desde la última sincronización.
 * Los registros pendientes nunca se descartan: si algo falla quedan para el siguiente intento.
 */
export async function syncOnce(deps: SyncDeps): Promise<SyncResult> {
  const { store, remote, standId } = deps;
  const at = new Date().toISOString();
  let pushed = 0;
  let pulled = 0;
  let imagesPushed = 0;
  const imagesPending = async () => (await store.imagesToUpload()).length;

  if (!deps.isOnline()) {
    return { phase: 'offline', pushed, pulled, pending: (await store.pending()).length, imagesPushed, imagesPending: await imagesPending(), error: null, at };
  }

  try {
    const pending = (await store.pending()).sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      await remote.insert(batch.map(toRemoteRow));
      for (const v of batch) {
        if (v.dirty) await remote.update(v.id, {
          attendee_name: v.attendee_name,
          name_source: v.name_source,
          attendee_institution: v.attendee_institution ?? null,
          attendee_role: v.attendee_role ?? null,
          notes: v.notes,
        });
        await markSynced(store, v);
        pushed++;
      }
    }

    imagesPushed = await pushImages(store, remote);

    const since = (await store.getMeta(LAST_PULL_KEY)) ?? null;
    let cursor = since;
    for (;;) {
      const rows = await remote.fetchSince(standId, cursor, PAGE);
      for (const row of rows) {
        const local = await store.get(row.id);
        // Un cambio local pendiente tiene prioridad hasta que se envíe.
        if (local && local.sync_state === 'pending') continue;
        await store.put(fromRemoteRow(row, local));
        pulled++;
      }
      if (rows.length) {
        cursor = rows[rows.length - 1].updated_at ?? cursor;
        if (cursor) await store.setMeta(LAST_PULL_KEY, cursor);
      }
      if (rows.length < PAGE) break;
    }

    return { phase: 'idle', pushed, pulled, pending: (await store.pending()).length, imagesPushed, imagesPending: await imagesPending(), error: null, at };
  } catch (err) {
    const e = err instanceof RemoteError ? err : classifyRemoteError(err);
    const phase: SyncPhase = e.kind === 'network' ? 'offline' : e.kind === 'unauthorized' ? 'unauthorized' : 'error';
    return { phase, pushed, pulled, pending: (await store.pending()).length, imagesPushed, imagesPending: await imagesPending(), error: e.message, at };
  }
}

/** Sube las imágenes cuya visita ya está en el servidor. Solo un corte de red interrumpe la sincronización. */
async function pushImages(store: VisitStore, remote: RemoteVisits): Promise<number> {
  let pushed = 0;
  for (const image of await store.imagesToUpload()) {
    const visit = await store.get(image.id);
    if (!visit?.image_path || visit.sync_state !== 'synced') continue;
    try {
      await remote.uploadImage(visit.id, visit.image_path, image);
    } catch (err) {
      if (isNetworkFailure(err) || (err instanceof RemoteError && err.kind === 'network')) throw classifyRemoteError(err);
      continue; // p. ej. el bucket aún no existe: se reintenta más tarde
    }
    await store.putImage({ ...image, uploaded: true });
    pushed++;
  }
  return pushed;
}

/** Marca como sincronizado solo si el registro no cambió mientras se enviaba. */
async function markSynced(store: VisitStore, sent: Visit): Promise<void> {
  const current = await store.get(sent.id);
  if (!current || current.updated_at !== sent.updated_at) return;
  await store.put({ ...current, sync_state: 'synced', dirty: false });
}

export async function resetPullCursor(store: VisitStore): Promise<void> {
  await store.deleteMeta(LAST_PULL_KEY);
}

/** Espera antes del siguiente reintento: 5 s, 10 s, 20 s… hasta 2 min. */
export function retryDelayMs(attempt: number): number {
  return Math.min(120_000, 5_000 * 2 ** Math.max(0, attempt));
}
