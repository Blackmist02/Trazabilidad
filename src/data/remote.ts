import type { SupabaseClient } from '@supabase/supabase-js';
import type { Visit } from '../lib/visits';

/** Fila de la tabla public.visits en Supabase (ver supabase/schema.sql). */
export interface RemoteVisitRow {
  id: string;
  attendee_name: string | null;
  qr_payload: string | null;
  qr_identifier: string | null;
  qr_kind: string;
  visited_at: string;
  event_date: string;
  stand_id: string;
  notes: string | null;
  created_at: string;
  updated_at?: string;
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
  update(id: string, changes: { attendee_name: string | null; notes: string | null }): Promise<void>;
  /** Filas del stand modificadas después de `since` (ISO) en orden ascendente. */
  fetchSince(standId: string, since: string | null, limit: number): Promise<RemoteVisitRow[]>;
}

export function toRemoteRow(v: Visit): RemoteVisitRow {
  return {
    id: v.id,
    attendee_name: v.attendee_name,
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
  };
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
  status?: number;
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
        .select('id,attendee_name,qr_payload,qr_identifier,qr_kind,visited_at,event_date,stand_id,notes,created_at,updated_at')
        .eq('stand_id', standId)
        .order('updated_at', { ascending: true })
        .limit(limit);
      if (since) q = q.gt('updated_at', since);
      const { data, error, status } = await q;
      if (error) throw classifyRemoteError(error, status);
      return (data ?? []) as RemoteVisitRow[];
    },
  };
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
