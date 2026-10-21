import { uuid } from './id';
import { cleanName, MAX_IDENTIFIER_LENGTH, MAX_PAYLOAD_LENGTH, type ParsedQr, type QrKind, sanitizeText } from './qr';
import { localDateKey } from './time';

export const MAX_NOTES_LENGTH = 500;

/**
 * Estado de sincronización del registro en este dispositivo:
 * - local: modo local, nunca se envía a un servidor.
 * - pending: debe enviarse a Supabase (alta o modificación pendiente).
 * - synced: confirmado por el servidor.
 */
export type SyncState = 'local' | 'pending' | 'synced';

/** Origen del nombre: escrito por el operador, leído del QR, leído por OCR de la credencial o tomado de una visita anterior. */
export type NameSource = 'manual' | 'qr' | 'ocr' | 'previous';

export const NAME_SOURCE_TEXT: Record<NameSource, string> = {
  manual: 'Escrito por el operador',
  qr: 'Contenido del QR',
  ocr: 'Texto impreso en la credencial (OCR)',
  previous: 'Visita anterior del mismo código',
};

export interface VisitEdit {
  at: string;
  field: 'attendee_name' | 'notes';
  old_value: string | null;
  new_value: string | null;
}

export interface Visit {
  id: string;
  attendee_name: string | null;
  /** null cuando no hay nombre. */
  name_source: NameSource | null;
  qr_payload: string | null;
  qr_identifier: string | null;
  qr_kind: QrKind | 'manual';
  visited_at: string; // ISO 8601 UTC
  event_date: string; // YYYY-MM-DD en la zona horaria del evento
  stand_id: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  edits: VisitEdit[];
  sync_state: SyncState;
  /** true si hay cambios locales (nombre/notas) aún no enviados al servidor. */
  dirty: boolean;
}

export function isIdentified(v: Pick<Visit, 'attendee_name'>): boolean {
  return !!v.attendee_name;
}

export function cleanNotes(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = sanitizeText(value).trim();
  return v ? v.slice(0, MAX_NOTES_LENGTH) : null;
}

export function cleanStandId(value: string): string {
  return sanitizeText(value).trim().slice(0, 64);
}

export interface NewVisitInput {
  parsed: ParsedQr | null;
  /** Identificador introducido a mano cuando no hay QR legible. */
  manualIdentifier?: string | null;
  attendeeName: string | null;
  /** Por defecto 'manual'. */
  nameSource?: NameSource;
  notes: string | null;
  /** Momento de la lectura: lo fija la app, nunca el operador. */
  scannedAt: Date;
  standId: string;
  timeZone: string;
  storePayload: boolean;
  syncMode: boolean;
}

export function createVisit(input: NewVisitInput): Visit {
  const now = new Date().toISOString();
  const visitedAt = input.scannedAt.toISOString();
  const { parsed } = input;
  let identifier: string | null = null;
  let payload: string | null = null;
  let kind: Visit['qr_kind'] = 'manual';
  if (parsed) {
    identifier = parsed.identifier;
    kind = parsed.kind;
    // Si el contenido coincide con el identificador no hace falta duplicarlo.
    if (input.storePayload && parsed.raw && parsed.raw !== parsed.identifier) {
      payload = parsed.raw.slice(0, MAX_PAYLOAD_LENGTH);
    }
  } else if (input.manualIdentifier) {
    const id = sanitizeText(input.manualIdentifier).trim();
    identifier = id ? id.slice(0, MAX_IDENTIFIER_LENGTH) : null;
  }
  const name = cleanName(input.attendeeName);
  return {
    id: uuid(),
    attendee_name: name,
    name_source: name ? (input.nameSource ?? 'manual') : null,
    qr_payload: payload,
    qr_identifier: identifier,
    qr_kind: kind,
    visited_at: visitedAt,
    event_date: localDateKey(input.scannedAt, input.timeZone),
    stand_id: cleanStandId(input.standId) || 'stand',
    notes: cleanNotes(input.notes),
    created_at: now,
    updated_at: now,
    edits: [],
    sync_state: input.syncMode ? 'pending' : 'local',
    dirty: false,
  };
}

/**
 * Aplica una corrección conservando el valor anterior en el historial de cambios.
 * Devuelve el mismo objeto si no hay cambios.
 */
export function applyEdit(
  visit: Visit,
  changes: { attendee_name?: string | null; notes?: string | null },
  at = new Date(),
): Visit {
  const edits: VisitEdit[] = [];
  const next: Visit = { ...visit };
  if (changes.attendee_name !== undefined) {
    const name = cleanName(changes.attendee_name);
    if (name !== visit.attendee_name) {
      edits.push({ at: at.toISOString(), field: 'attendee_name', old_value: visit.attendee_name, new_value: name });
      next.attendee_name = name;
      next.name_source = name ? 'manual' : null;
    }
  }
  if (changes.notes !== undefined) {
    const notes = cleanNotes(changes.notes);
    if (notes !== visit.notes) {
      edits.push({ at: at.toISOString(), field: 'notes', old_value: visit.notes, new_value: notes });
      next.notes = notes;
    }
  }
  if (!edits.length) return visit;
  next.edits = [...visit.edits, ...edits];
  next.updated_at = at.toISOString();
  if (visit.sync_state !== 'local') {
    next.dirty = true;
    next.sync_state = 'pending';
  }
  return next;
}

export interface PreviousVisits {
  /** Visitas con el mismo identificador en la misma fecha del evento. */
  sameDay: Visit[];
  /** Todas las visitas con el mismo identificador. */
  all: Visit[];
  last: Visit | null;
}

/** Busca registros previos del mismo código. Sin identificador no se puede afirmar nada. */
export function findPreviousVisits(visits: Visit[], identifier: string | null, eventDate: string): PreviousVisits {
  if (!identifier) return { sameDay: [], all: [], last: null };
  const all = visits
    .filter((v) => v.qr_identifier === identifier)
    .sort((a, b) => b.visited_at.localeCompare(a.visited_at));
  return { all, sameDay: all.filter((v) => v.event_date === eventDate), last: all[0] ?? null };
}

/** Último nombre conocido para un identificador (para proponerlo al operador). */
export function knownNameFor(previous: PreviousVisits): string | null {
  return previous.all.find((v) => v.attendee_name)?.attendee_name ?? null;
}
