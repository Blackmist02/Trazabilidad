import type { SupabaseClient } from '@supabase/supabase-js';
import { bytesToDataUrl, dataUrlToBytes, type ImageData64 } from '../lib/imageData';
import type { Visit } from '../lib/visits';

/** Fila de la tabla public.visits en Supabase (ver supabase/schema.sql). */
export interface RemoteVisitRow {
  id: string;
  attendee_name: string | null;
  name_source?: string | null;
  attendee_institution?: string | null;
  attendee_role?: string | null;
  qr_payload: string | null;
  qr_identifier: string | null;
  qr_kind: string;
  visited_at: string;
  event_date: string;
  stand_id: string;
  notes: string | null;
  created_at: string;
  updated_at?: string;
  image_path?: string | null;
}

/** Bucket privado de Supabase Storage con las imágenes de las credenciales (ver supabase/schema.sql). */
export const IMAGE_BUCKET = 'badge-images';

export interface VisitChanges {
  attendee_name: string | null;
  name_source: string | null;
  attendee_institution: string | null;
  attendee_role: string | null;
  notes: string | null;
}

export type RemoteErrorKind = 'network' | 'unauthorized' | 'invalid' | 'server';

export class RemoteError extends Error {
  readonly kind: RemoteErrorKind;
  constructor(kind: RemoteErrorKind, message: string) {
    super(message);
    this.name = 'RemoteError';
    this.kind = kind;
  }
}

/** Operaciones remotas que necesita el motor de sincronización (inyectable para pruebas). */
export interface RemoteVisits {
  /** Inserta filas; los id ya existentes se ignoran (inserción idempotente). */
  insert(rows: RemoteVisitRow[]): Promise<void>;
  update(id: string, changes: VisitChanges): Promise<void>;
  /** Filas del stand modificadas después de `since` (ISO) en orden ascendente. */
  fetchSince(standId: string, since: string | null, limit: number): Promise<RemoteVisitRow[]>;
  /** Sube la imagen (reintentar no duplica: sobrescribe el mismo archivo) y la enlaza a la visita. */
  uploadImage(visitId: string, path: string, image: ImageData64): Promise<void>;
}

export function toRemoteRow(v: Visit): RemoteVisitRow {
  return {
    id: v.id,
    attendee_name: v.attendee_name,
    name_source: v.name_source,
    attendee_institution: v.attendee_institution ?? null,
    attendee_role: v.attendee_role ?? null,
    qr_payload: v.qr_payload,
    qr_identifier: v.qr_identifier,
    qr_kind: v.qr_kind,
    visited_at: v.visited_at,
    event_date: v.event_date,
    stand_id: v.stand_id,
    notes: v.notes,
    created_at: v.created_at,
  };
}

export function fromRemoteRow(row: RemoteVisitRow, local?: Visit): Visit {
  return {
    id: row.id,
    attendee_name: row.attendee_name,
    name_source: (row.name_source ?? (row.attendee_name ? 'manual' : null)) as Visit['name_source'],
    attendee_institution: row.attendee_institution ?? null,
    attendee_role: row.attendee_role ?? null,
    qr_payload: row.qr_payload,
    qr_identifier: row.qr_identifier,
    qr_kind: row.qr_kind as Visit['qr_kind'],
    visited_at: new Date(row.visited_at).toISOString(),
    event_date: row.event_date,
    stand_id: row.stand_id,
    notes: row.notes,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at ?? row.created_at).toISOString(),
    edits: local?.edits ?? [],
    sync_state: 'synced',
    dirty: false,
    // Una imagen local aún no subida conserva su ruta hasta que el servidor la tenga.
    image_path: row.image_path ?? local?.image_path ?? null,
  };
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
  status?: number;
}

/** ¿Falló la conexión en sí (sin respuesta del servidor)? */
export function isNetworkFailure(err: unknown): boolean {
  const e = (err ?? {}) as { name?: string; message?: string; originalError?: unknown };
  if (e.name === 'TypeError' || /fetch|network|Load failed/i.test(e.message ?? '')) return true;
  return e.originalError != null && isNetworkFailure(e.originalError);
}

/** Clasifica errores de Supabase/PostgREST sin incluir datos personales en el mensaje. */
export function classifyRemoteError(err: unknown, status?: number): RemoteError {
  if (err instanceof RemoteError) return err;
  const e = (err ?? {}) as PostgrestLikeError & { name?: string };
  const code = e.code ?? '';
  const st = status ?? e.status ?? 0;
  const msg = e.message ?? '';
  if (e.name === 'TypeError' || /fetch|network|Load failed/i.test(msg)) {
    return new RemoteError('network', 'Sin conexión con el servidor.');
  }
  if (st === 401 || st === 403 || code === '42501' || code === 'PGRST301' || code === 'PGRST303') {
    return new RemoteError('unauthorized', 'Sin permiso: inicia sesión con una cuenta de operador autorizada.');
  }
  if (code.startsWith('22') || code.startsWith('23') || st === 400) {
    return new RemoteError('invalid', `El servidor rechazó los datos (${code || st}).`);
  }
  if (!code && st === 0) return new RemoteError('network', 'Sin conexión con el servidor.');
  return new RemoteError('server', `Error del servidor (${code || st}).`);
}

export function supabaseRemote(client: SupabaseClient): RemoteVisits {
  return {
    async insert(rows) {
      if (!rows.length) return;
      const { error, status } = await client
        .from('visits')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw classifyRemoteError(error, status);
    },
    async update(id, changes) {
      const { error, status } = await client.from('visits').update(changes).eq('id', id);
      if (error) throw classifyRemoteError(error, status);
    },
    async fetchSince(standId, since, limit) {
      let q = client
        .from('visits')
        .select('id,attendee_name,name_source,attendee_institution,attendee_role,qr_payload,qr_identifier,qr_kind,visited_at,event_date,stand_id,notes,created_at,updated_at,image_path')
        .eq('stand_id', standId)
        .order('updated_at', { ascending: true })
        .limit(limit);
      if (since) q = q.gt('updated_at', since);
      const { data, error, status } = await q;
      if (error) throw classifyRemoteError(error, status);
      return (data ?? []) as RemoteVisitRow[];
    },
    async uploadImage(visitId, path, image) {
      const bytes = dataUrlToBytes(image.dataUrl);
      if (!bytes) throw new RemoteError('invalid', 'Imagen no válida.');
      const { error: upErr } = await client.storage
        .from(IMAGE_BUCKET)
        .upload(path, new Blob([bytes.data], { type: bytes.type }), { contentType: bytes.type, upsert: true });
      if (upErr) throw classifyRemoteError(upErr, Number((upErr as { statusCode?: string }).statusCode) || undefined);
      const { error, status } = await client.from('visits').update({ image_path: path }).eq('id', visitId);
      if (error) throw classifyRemoteError(error, status);
    },
  };
}

/** Descarga la imagen de una visita desde Supabase Storage. */
export async function downloadImage(client: SupabaseClient, path: string): Promise<ImageData64> {
  const { data, error } = await client.storage.from(IMAGE_BUCKET).download(path);
  if (error || !data) throw classifyRemoteError(error);
  const type = path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return { dataUrl: bytesToDataUrl(await data.arrayBuffer(), type), type };
}

export interface AuditEntry {
  changed_at: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
}

export async function fetchAudit(client: SupabaseClient, visitId: string): Promise<AuditEntry[]> {
  const { data, error, status } = await client
    .from('visit_audit')
    .select('changed_at,field,old_value,new_value')
    .eq('visit_id', visitId)
    .order('changed_at', { ascending: true });
  if (error) throw classifyRemoteError(error, status);
  return (data ?? []) as AuditEntry[];
}
