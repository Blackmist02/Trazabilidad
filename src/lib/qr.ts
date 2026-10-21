/**
 * Interpretación del contenido de un QR.
 *
 * Reglas:
 * - Nunca se visita una URL ni se envía el contenido a servicios externos.
 * - Solo se propone un nombre cuando aparece de forma explícita y estructurada
 *   (vCard FN/N, MECARD N:, JSON con clave de nombre, parámetro de URL "name"/"nombre").
 *   El operador siempre lo confirma antes de guardar.
 * - Un código opaco (p. ej. "BDFFE48F81E448617430250Enp") no contiene nombre:
 *   se guarda como identificador y se pide el nombre manualmente.
 */

export type QrKind = 'identifier' | 'url' | 'vcard' | 'mecard' | 'json' | 'text';

export type NameSource = 'vcard' | 'mecard' | 'json' | 'url-param' | null;

export interface ParsedQr {
  kind: QrKind;
  /** Contenido original, solo recortado de espacios en los extremos. */
  raw: string;
  /** Identificador normalizado para detectar repeticiones, o null si no es fiable. */
  identifier: string | null;
  /** Nombre explícito encontrado en el contenido, o null. */
  suggestedName: string | null;
  nameSource: NameSource;
  /** Para URLs: host, para mostrarlo al operador sin abrir el enlace. */
  urlHost: string | null;
  warnings: string[];
}

export const MAX_PAYLOAD_LENGTH = 2048;
export const MAX_IDENTIFIER_LENGTH = 512;
export const MAX_NAME_LENGTH = 120;

// Identificador alfanumérico: letras, dígitos y separadores comunes, sin espacios.
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-/#]{2,255}$/;
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const NAME_PARAM_KEYS = ['name', 'nombre', 'fullname', 'full_name', 'attendee_name', 'nombre_completo'];
const JSON_NAME_KEYS = ['attendee_name', 'name', 'nombre', 'fullName', 'full_name', 'nombre_completo'];
const JSON_ID_KEYS = ['id', 'uid', 'code', 'codigo', 'ticket', 'ticket_id', 'badge', 'badge_id', 'attendee_id'];

// Caracteres de control (excepto tab/salto de línea) que no deben almacenarse.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeText(value: string): string {
  return value.replace(CONTROL_RE, '').normalize('NFC');
}

/** Limpia y valida un nombre; devuelve null si queda vacío. */
export function cleanName(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = sanitizeText(value).replace(/\s+/g, ' ').trim();
  if (!v) return null;
  return v.slice(0, MAX_NAME_LENGTH);
}

function plausibleName(value: string | null | undefined): string | null {
  const v = cleanName(value);
  if (!v) return null;
  // Debe contener al menos una letra y no parecer un identificador opaco.
  if (!/\p{L}/u.test(v)) return null;
  if (!/\s/.test(v) && /\d/.test(v)) return null;
  return v;
}

function decodeVcardValue(v: string): string {
  return v.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ').replace(/\\\\/g, '\\');
}

function parseVcard(raw: string): { name: string | null; uid: string | null } {
  // Desplegar líneas continuadas (RFC 6350 §3.2).
  const lines = raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  let fn: string | null = null;
  let n: string | null = null;
  let uid: string | null = null;
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).split(';')[0].toUpperCase();
    const value = line.slice(idx + 1);
    if (key === 'FN') fn = decodeVcardValue(value);
    else if (key === 'N') {
      const [family = '', given = '', additional = ''] = value.split(';').map(decodeVcardValue);
      n = [given, additional, family].filter(Boolean).join(' ');
    } else if (key === 'UID') uid = value.trim();
  }
  return { name: plausibleName(fn) ?? plausibleName(n), uid: uid || null };
}

function parseMecard(raw: string): string | null {
  const body = raw.slice(raw.indexOf(':') + 1);
  const m = /(?:^|;)N:([^;]*)/.exec(body);
  if (!m) return null;
  // MECARD usa "Apellido,Nombre".
  const [family, given] = m[1].split(',');
  return plausibleName(given ? `${given} ${family}` : family);
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

export function parseQr(input: string): ParsedQr {
  const raw = sanitizeText(input ?? '').trim();
  const result: ParsedQr = {
    kind: 'text',
    raw,
    identifier: null,
    suggestedName: null,
    nameSource: null,
    urlHost: null,
    warnings: [],
  };

  if (!raw) {
    result.warnings.push('El código está vacío.');
    return result;
  }
  if (raw.length > MAX_PAYLOAD_LENGTH) {
    result.warnings.push(`El contenido supera ${MAX_PAYLOAD_LENGTH} caracteres; se guardará truncado.`);
    result.raw = raw.slice(0, MAX_PAYLOAD_LENGTH);
  }

  // vCard
  if (/^BEGIN:VCARD/i.test(raw)) {
    const { name, uid } = parseVcard(raw);
    result.kind = 'vcard';
    result.suggestedName = name;
    result.nameSource = name ? 'vcard' : null;
    result.identifier = uid ? uid.slice(0, MAX_IDENTIFIER_LENGTH) : null;
    if (!uid) result.warnings.push('La tarjeta no incluye un identificador único (UID).');
    return result;
  }

  // MECARD
  if (/^MECARD:/i.test(raw)) {
    const name = parseMecard(raw);
    result.kind = 'mecard';
    result.suggestedName = name;
    result.nameSource = name ? 'mecard' : null;
    result.warnings.push('La tarjeta no incluye un identificador único.');
    return result;
  }

  // URL: se analiza localmente, nunca se visita.
  if (URL_RE.test(raw)) {
    try {
      const url = new URL(raw);
      result.kind = 'url';
      result.urlHost = url.host || null;
      // El identificador es la URL normalizada (minúsculas en esquema y host; sin fragmento).
      url.hash = '';
      result.identifier = url.toString().slice(0, MAX_IDENTIFIER_LENGTH);
      for (const key of NAME_PARAM_KEYS) {
        const name = plausibleName(url.searchParams.get(key));
        if (name) {
          result.suggestedName = name;
          result.nameSource = 'url-param';
          break;
        }
      }
      return result;
    } catch {
      // No es una URL válida: continúa como texto.
    }
  }

  // JSON
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const obj = JSON.parse(raw) as unknown;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const rec = obj as Record<string, unknown>;
        result.kind = 'json';
        const name = plausibleName(pickString(rec, JSON_NAME_KEYS));
        result.suggestedName = name;
        result.nameSource = name ? 'json' : null;
        const id = pickString(rec, JSON_ID_KEYS);
        result.identifier = id ? id.trim().slice(0, MAX_IDENTIFIER_LENGTH) : null;
        if (!id) result.warnings.push('El contenido no incluye un identificador reconocible.');
        return result;
      }
    } catch {
      // No es JSON válido.
    }
  }

  // Identificador alfanumérico (caso habitual en credenciales). Se conserva
  // la capitalización: puede ser significativa.
  if (IDENTIFIER_RE.test(raw)) {
    result.kind = 'identifier';
    result.identifier = raw;
    return result;
  }

  // Texto libre en una línea razonablemente corta: se usa tal cual como identificador.
  result.kind = 'text';
  if (!/[\r\n]/.test(raw) && raw.length <= 256) {
    result.identifier = raw.replace(/\s+/g, ' ');
  } else {
    result.warnings.push('El contenido es texto libre: no hay un identificador fiable para detectar repeticiones.');
  }
  return result;
}

export const QR_KIND_LABEL: Record<QrKind, string> = {
  identifier: 'Identificador',
  url: 'URL',
  vcard: 'Tarjeta vCard',
  mecard: 'Tarjeta MECARD',
  json: 'Datos JSON',
  text: 'Texto',
};

export const NAME_SOURCE_LABEL: Record<Exclude<NameSource, null>, string> = {
  vcard: 'campo FN/N de la vCard',
  mecard: 'campo N de la tarjeta MECARD',
  json: 'campo de nombre en el contenido',
  'url-param': 'parámetro de nombre en la URL',
};
