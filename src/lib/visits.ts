import { uuid } from './id';
import { MAX_AFFILIATION_LENGTH } from './ocrName';
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

/** Campos que el operador puede corregir después de registrar la visita. */
export type EditableField = 'attendee_name' | 'attendee_institution' | 'attendee_role' | 'notes';

export interface VisitEdit {
  at: string;
  field: EditableField;
  old_value: string | null;
  new_value: string | null;
}

export interface Visit {
  id: string;
  attendee_name: string | null;
  /** null cuando no hay nombre. */
  name_source: NameSource | null;
  /** Institución de procedencia (2.ª línea de la credencial). */
  attendee_institution: string | null;
  /** Cargo o rol en la institución (3.ª línea de la credencial). */
  attendee_role: string | null;
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
  /**
   * Imagen del texto de la credencial (ruta en Supabase Storage, p. ej. `<id>.webp`).
   * Sirve para revisar y corregir lo que leyó el OCR. null o ausente: sin imagen.
   */
  image_path?: string | null;
}

/** Ruta de la imagen de una visita según su tipo MIME. */
export function imagePathFor(id: string, type: string): string {
  return `${id}.${type === 'image/webp' ? 'webp' : 'jpg'}`;
}

export function isIdentified(v: Pick<Visit, 'attendee_name'>): boolean {
  return !!v.attendee_name;
}

export function cleanNotes(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = sanitizeText(value).trim();
  return v ? v.slice(0, MAX_NOTES_LENGTH) : null;
}

/** Institución o cargo: texto corto de una línea. */
export function cleanAffiliationField(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = sanitizeText(value).replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, MAX_AFFILIATION_LENGTH) : null;
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
  institution?: string | null;
  role?: string | null;
  notes: string | null;
  /** Momento de la lectura: lo fija la app, nunca el operador. */
  scannedAt: Date;
  standId: string;
  timeZone: string;
  storePayload: boolean;
  syncMode: boolean;
  /** Tipo MIME de la imagen de la credencial que se guardará con la visita, si la hay. */
  imageType?: string | null;
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
  const id = uuid();
  return {
    id,
    attendee_name: name,
    name_source: name ? (input.nameSource ?? 'manual') : null,
    attendee_institution: cleanAffiliationField(input.institution),
    attendee_role: cleanAffiliationField(input.role),
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
    image_path: input.imageType ? imagePathFor(id, input.imageType) : null,
  };
}

export type VisitChangesInput = Partial<Record<EditableField, string | null>>;

/**
 * Aplica una corrección conservando el valor anterior en el historial de cambios.
 * Devuelve el mismo objeto si no hay cambios.
 */
export function applyEdit(
  visit: Visit,
  changes: VisitChangesInput,
  at = new Date(),
): Visit {
  const edits: VisitEdit[] = [];
  const next: Visit = { ...visit };
  const cleaners: Record<EditableField, (v: string | null) => string | null> = {
    attendee_name: cleanName,
    attendee_institution: cleanAffiliationField,
    attendee_role: cleanAffiliationField,
    notes: cleanNotes,
  };
  for (const field of Object.keys(cleaners) as EditableField[]) {
    if (changes[field] === undefined) continue;
    const value = cleaners[field](changes[field] ?? null);
    const old = visit[field] ?? null;
    if (value === old) continue;
    edits.push({ at: at.toISOString(), field, old_value: old, new_value: value });
    next[field] = value;
    if (field === 'attendee_name') next.name_source = value ? 'manual' : null;
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

/** Última institución y cargo conocidos para un identificador. */
export function knownAffiliationFor(previous: PreviousVisits): { institution: string | null; role: string | null } {
  return {
    institution: previous.all.find((v) => v.attendee_institution)?.attendee_institution ?? null,
    role: previous.all.find((v) => v.attendee_role)?.attendee_role ?? null,
  };
}
