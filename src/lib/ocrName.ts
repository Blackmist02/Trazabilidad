/**
 * Interpretación del texto impreso en una credencial.
 *
 * Formato esperado (indicado por la organización del evento):
 *   1.ª línea: nombre y apellido
 *   2.ª línea: institución de procedencia
 *   3.ª línea: cargo o rol en la institución
 * Encima puede haber una cabecera (nombre del evento). El QR suele ir justo encima del bloque
 * (p. ej. Edifica 2026), así que primero se lee la franja bajo el QR; si no, se busca en toda la imagen.
 *
 * Todo lo que se obtiene es una sugerencia: el operador siempre la confirma.
 */

export interface OcrLine {
  text: string;
  /** 0–100 */
  confidence: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface NameCandidate {
  name: string;
  score: number;
}

export interface BadgeReading {
  /** Candidatos a nombre, del más al menos probable. */
  names: NameCandidate[];
  institution: string | null;
  role: string | null;
  /** Zona de la imagen con nombre, institución y cargo (para releerla ampliada). */
  block: Box | null;
  /** Altura de la línea del nombre en píxeles. */
  nameHeight: number;
}

export const MAX_AFFILIATION_LENGTH = 120;
const MIN_CONFIDENCE = 50;

// Palabras habituales en credenciales que no forman parte de un nombre de persona.
const NON_NAME_WORDS = [
  'visitante', 'visitantes', 'expositor', 'expositora', 'expositores', 'staff', 'prensa', 'asistente', 'participante',
  'general', 'vip', 'credencial', 'acreditacion', 'acreditado', 'acreditada', 'organizador', 'organizadora',
  'organizacion', 'speaker', 'ponente', 'invitado', 'invitada', 'delegado', 'delegada', 'estudiante', 'profesional',
  'pase', 'entrada', 'acceso', 'evento', 'feria', 'congreso', 'cumbre', 'summit', 'expo', 'stand', 'empresa', 'cargo',
  'nombre', 'apellido', 'apellidos', 'gerente', 'director', 'directora', 'jefe', 'jefa', 'ejecutivo', 'ejecutiva',
  'ingeniero', 'ingeniera', 'analista', 'coordinador', 'coordinadora', 'manager', 'ceo', 'cto', 'cfo', 'founder',
  'universidad', 'instituto', 'colegio', 'ministerio', 'gobierno', 'municipalidad', 'chile', 'santiago', 'ltda', 'spa',
  'limitada', 'sociedad', 'anonima', 'group', 'grupo', 'inc', 'corp', 'www', 'http', 'https', 'com', 'cl', 'org', 'qr',
  'dia', 'dias', 'octubre', 'noviembre', 'diciembre', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'media', 'partner', 'sponsor', 'auspiciador', 'tecnologia', 'innovacion', 'internacional',
  'nacional', 'conferencia', 'seminario', 'workshop', 'premium', 'pass', 'all', 'access', 'full', 'badge', 'attendee',
  'visitor', 'exhibitor', 'press', 'presenta', 'auspicia', 'patrocina', 'organiza', 'coorganiza', 'socio', 'estrategico', 'clinica', 'hospital', 'fundacion', 'corporacion', 'servicio', 'subsecretaria',
  'facultad', 'departamento', 'escuela', 'centro', 'banco', 'consultora', 'constructora', 'minera', 'compania',
];

// Partículas de apellidos y nombres compuestos.
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'das', 'do', 'dos', 'di', 'van', 'von', 'der', 'le', 'mc']);

const LETTERS_RE = /^[\p{L}][\p{L}'’.-]*$/u;
const VOWEL_RE = /[aeiouyáéíóúàèìòùäëïöüâêîôû]/i;

export function normalizeWord(w: string): string {
  return w
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export function buildStopwords(extra: string[]): Set<string> {
  const set = new Set(NON_NAME_WORDS);
  for (const phrase of extra) {
    for (const w of phrase.split(/\s+/)) {
      const n = normalizeWord(w);
      if (n.length >= 3) set.add(n);
    }
  }
  return set;
}

function countLetters(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

/**
 * El OCR a veces lee en minúscula alguna letra de un texto en mayúsculas ("PÉREZ soTO").
 * Si la gran mayoría de las letras son mayúsculas, se considera todo en mayúsculas.
 */
export function fixOcrCase(text: string): string {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 4) return text;
  const upper = letters.filter((c) => c !== c.toLowerCase()).length;
  return upper / letters.length >= 0.7 && upper < letters.length ? text.toLocaleUpperCase('es') : text;
}

/** Nombre con cada palabra (salvo partículas) en mayúscula inicial. */
function wellCapitalized(name: string): boolean {
  return name.split(' ').every((w, i) => (i > 0 && PARTICLES.has(normalizeWord(w))) || /^\p{Lu}/u.test(w));
}

/** Limpia una línea y devuelve sus palabras si puede ser el nombre de una persona. */
export function nameWords(input: string, stopwords: Set<string>): string[] | null {
  const text = fixOcrCase(input);
  // Números, correos, URLs, fechas o códigos: no es un nombre.
  if (/[0-9@/:#_=+*<>{}[\]|\\$%&]/.test(text)) return null;
  // Punto seguido de letra: dominio o abreviatura de empresa ("evento.cl", "S.A.").
  if (/\.\p{L}/u.test(text)) return null;
  const cleaned = text
    .replace(/[“”"«»()¡!¿?,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-.'’]+|[-.'’]+$/g, '');
  if (!cleaned) return null;
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length < 1 || words.length > 6) return null;
  let letters = 0;
  for (const w of words) {
    if (!LETTERS_RE.test(w)) return null;
    const norm = normalizeWord(w);
    if (stopwords.has(norm)) return null;
    if (PARTICLES.has(norm)) continue;
    if (norm.length < 2) return null; // letras sueltas: ruido o palabra cortada
    if (norm.length >= 3 && !VOWEL_RE.test(w)) return null; // "LLLL", "Hrkt"…
    // Mayúsculas y minúsculas mezcladas de forma extraña ("pÉrEz") indican ruido.
    // Se revisa cada parte de los apellidos compuestos ("Pérez-Cotapos", "O'Connor").
    const oddCase = w.split(/[-'’]/).some((part) => {
      const rest = part.replace(/^(Mc|Mac)/, '').slice(1);
      return rest !== rest.toLowerCase() && rest !== rest.toUpperCase();
    });
    if (oddCase) return null;
    letters += norm.length;
  }
  if (letters < 3) return null;
  if (words.every((w) => PARTICLES.has(normalizeWord(w)))) return null;
  return words;
}

/** "MARÍA JOSÉ DE LA FUENTE" → "María José de la Fuente". Respeta capitalización mixta ya correcta. */
export function formatName(words: string[]): string {
  const allUpper = words.every((w) => w === w.toUpperCase());
  const allLower = words.every((w) => w === w.toLowerCase());
  if (!allUpper && !allLower) return words.join(' ');
  return words
    .map((w, i) => {
      const lower = w.toLocaleLowerCase('es');
      if (i > 0 && PARTICLES.has(normalizeWord(w))) return lower;
      return lower.replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('es'));
    })
    .join(' ');
}

/** Limpia la línea de institución o cargo; null si parece ruido. */
export function cleanAffiliation(text: string | null | undefined): string | null {
  if (!text) return null;
  const v = text
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[|[\]{}<>_=*~^`\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-–—.,:;'’"·•]+|[-–—,:;'’"·•]+$/g, '')
    .trim();
  if (countLetters(v) < 2) return null;
  // Demasiados símbolos extraños respecto de letras en la lectura original: ruido del OCR.
  // La puntuación habitual de instituciones ("S.A.", "I+D", "Bci & Co.") no cuenta como ruido.
  const noise = (text.match(/[^\p{L}\p{N}\s.,&'’()/+-]/gu) ?? []).length;
  if (noise > countLetters(text) * 0.4) return null;
  return v.slice(0, MAX_AFFILIATION_LENGTH);
}

export interface Row {
  text: string;
  confidence: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
}

/**
 * Descarta ruido y une los fragmentos que el OCR separa dentro de una misma fila
 * (palabras muy espaciadas). Devuelve las filas de arriba abajo.
 */
export function groupRows(lines: OcrLine[], minConfidence = MIN_CONFIDENCE): Row[] {
  const useful = lines
    .filter((l) => l.confidence >= minConfidence && countLetters(l.text) >= 2)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: { parts: OcrLine[]; top: number; bottom: number }[] = [];
  for (const l of useful) {
    const h = l.bottom - l.top;
    const row = rows.find((r) => {
      const overlap = Math.min(r.bottom, l.bottom) - Math.max(r.top, l.top);
      return overlap > 0.5 * Math.min(h, r.bottom - r.top);
    });
    if (row) {
      row.parts.push(l);
      row.top = Math.min(row.top, l.top);
      row.bottom = Math.max(row.bottom, l.bottom);
    } else {
      rows.push({ parts: [l], top: l.top, bottom: l.bottom });
    }
  }
  return rows
    .map((r) => {
      const parts = [...r.parts].sort((a, b) => a.left - b.left);
      return {
        text: parts.map((p) => p.text.trim()).join(' '),
        confidence: Math.min(...parts.map((p) => p.confidence)),
        top: r.top,
        bottom: r.bottom,
        left: Math.min(...parts.map((p) => p.left)),
        right: Math.max(...parts.map((p) => p.right)),
        height: Math.max(1, Math.max(...parts.map((p) => p.bottom - p.top))),
      };
    })
    .sort((a, b) => a.top - b.top);
}

/**
 * Filas de un recorte leído línea a línea (PSM 6): tesseract ya entrega cada línea completa,
 * así que no se unen. Unirlas por solapamiento vertical mezclaría el nombre con la institución
 * cuando las letras del nombre (g, j, p…) bajan hasta la línea siguiente.
 */
export function lineRows(lines: OcrLine[], minConfidence = MIN_CONFIDENCE): Row[] {
  return lines
    .filter((l) => l.confidence >= minConfidence && countLetters(l.text) >= 2)
    .sort((a, b) => a.top - b.top)
    .map((l) => ({ ...l, text: l.text.trim(), height: Math.max(1, l.bottom - l.top) }));
}

/** ¿La fila `b` sigue a la fila `a` como parte del mismo bloque de texto? */
function follows(a: Row, b: Row): boolean {
  const gap = b.top - a.bottom;
  const ref = Math.max(a.height, b.height);
  const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  return gap > -0.3 * ref && gap < 1.6 * ref && overlap > 0;
}

function wordCountFactor(n: number): number {
  if (n === 1) return 0.45;
  if (n <= 4) return 1;
  return 0.75;
}

/**
 * Analiza las líneas de una lectura completa de la credencial: elige la línea del
 * nombre (la primera del bloque nombre/institución/cargo) y toma las dos siguientes.
 */
export function analyzeBadge(lines: OcrLine[], extraStopwords: string[] = []): BadgeReading {
  const stop = buildStopwords(extraStopwords);
  const rows = groupRows(lines);
  const scored: { row: number; words: string[]; score: number }[] = [];

  rows.forEach((row, i) => {
    let words = nameWords(row.text, stop);
    let penalty = 1;
    if (!words) {
      // Última palabra cortada por el OCR ("Francisco Javier M"): sirve para ubicar el bloque;
      // la relectura ampliada recupera el nombre completo.
      const trimmed = row.text.replace(/\s+\S{1,2}$/u, '');
      if (trimmed !== row.text) words = nameWords(trimmed, stop);
      if (!words) return;
      penalty = 0.7;
    }
    // Estructura: debajo del nombre deben venir institución y cargo.
    const below = rows[i + 1] && follows(row, rows[i + 1]) ? (rows[i + 2] && follows(rows[i + 1], rows[i + 2]) ? 2 : 1) : 0;
    const structure = below === 2 ? 1.6 : below === 1 ? 1.15 : 0.6;
    const realWords = words.filter((w) => !PARTICLES.has(normalizeWord(w))).length;
    scored.push({ row: i, words, score: row.height * (row.confidence / 100) * wordCountFactor(realWords) * structure * penalty });
  });
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return { names: [], institution: null, role: null, block: null, nameHeight: 0 };

  // Alternativas: sin las líneas de institución y cargo, y solo si son razonablemente probables.
  const names: NameCandidate[] = [];
  for (const s of scored) {
    if (s !== best && (s.row === best.row + 1 || s.row === best.row + 2 || s.score < 0.4 * best.score)) continue;
    const name = formatName(s.words);
    if (!names.some((n) => n.name === name)) names.push({ name, score: s.score });
  }
  const nameRow = rows[best.row];
  const instRow = rows[best.row + 1] && follows(nameRow, rows[best.row + 1]) ? rows[best.row + 1] : null;
  const roleRow = instRow && rows[best.row + 2] && follows(instRow, rows[best.row + 2]) ? rows[best.row + 2] : null;
  const blockRows = [nameRow, instRow, roleRow].filter((r): r is Row => !!r);
  return {
    names: names.slice(0, 4),
    institution: cleanAffiliation(instRow?.text),
    role: cleanAffiliation(roleRow?.text),
    block: {
      top: Math.min(...blockRows.map((r) => r.top)),
      bottom: Math.max(...blockRows.map((r) => r.bottom)),
      left: Math.min(...blockRows.map((r) => r.left)),
      right: Math.max(...blockRows.map((r) => r.right)),
    },
    nameHeight: nameRow.height,
  };
}

/**
 * Combina la lectura completa con la relectura ampliada del bloque (línea a línea,
 * en orden: nombre, institución, cargo). La relectura tiene prioridad si su primera
 * línea es un nombre válido.
 */
export function mergeBlockReading(first: BadgeReading, blockLines: OcrLine[], extraStopwords: string[] = []): BadgeReading {
  // Filas legibles del recorte, en orden: nombre, institución, cargo.
  const rows = lineRows(blockLines).filter((r) => cleanAffiliation(r.text));
  if (!rows.length) return first;
  const words = nameWords(rows[0].text, buildStopwords(extraStopwords));
  if (!words) return first; // la primera línea no parece un nombre: se mantiene la primera lectura
  let name = formatName(words);
  // Si solo difieren en mayúsculas, se prefiere la versión bien capitalizada.
  const same = first.names.find((n) => n.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'));
  if (same && !wellCapitalized(name) && wellCapitalized(same.name)) name = same.name;
  // Se descartan lecturas que son una versión cortada del nombre elegido ("Francisco Javier").
  const chosen = new Set(name.toLocaleLowerCase('es').split(' '));
  const others = first.names.filter(
    (n) => n.name !== name && !n.name.toLocaleLowerCase('es').split(' ').every((w) => chosen.has(w)),
  );
  const names = [{ name, score: Infinity }, ...others].slice(0, 4);
  return {
    ...first,
    names,
    institution: cleanAffiliation(rows[1]?.text) ?? first.institution,
    role: cleanAffiliation(rows[2]?.text) ?? first.role,
  };
}

/** Compatibilidad: solo los candidatos a nombre. */
export function extractNameCandidates(lines: OcrLine[], extraStopwords: string[] = []): NameCandidate[] {
  return analyzeBadge(lines, extraStopwords).names;
}

export type Point = [number, number];

/** Centros de los patrones de ubicación del QR, en píxeles del fotograma (los entrega zxing). */
export interface QrLocation {
  bottomLeft: Point;
  topLeft: Point;
  topRight: Point;
}

export interface QrCrop {
  width: number;
  height: number;
  /** Matriz para `ctx.setTransform(a, b, c, d, e, f)`: lleva el fotograma al recorte. */
  matrix: [number, number, number, number, number, number];
}

/**
 * Franja bajo el QR, alineada con sus ejes (corrige giro e inclinación de la credencial).
 * Unidades: lado del QR, desde su centro. Escala: el lado del QR mide `qrPixels` en el recorte,
 * con lo que el nombre queda con un alto legible para el OCR.
 */
export const QR_CROP_PIXELS = 150;

export function belowQrCrop(qr: QrLocation, { left = -3, right = 3, top = 0.45, bottom = 2.5, qrPixels = QR_CROP_PIXELS } = {}): QrCrop | null {
  const { bottomLeft: bl, topLeft: tl, topRight: tr } = qr;
  const ux = tr[0] - tl[0], uy = tr[1] - tl[1];
  const vx = bl[0] - tl[0], vy = bl[1] - tl[1];
  const du = Math.hypot(ux, uy), dv = Math.hypot(vx, vy);
  if (du < 8 || dv < 8 || Math.max(du, dv) > 2 * Math.min(du, dv)) return null;
  // Entre centros de los patrones hay N − 7 módulos de N: el lado completo es ~1,4 veces esa distancia.
  const side = ((du + dv) / 2) * 1.4;
  const s = qrPixels / side; // píxeles del recorte por píxel del fotograma
  const cx = (tr[0] + bl[0]) / 2, cy = (tr[1] + bl[1]) / 2;
  // Recorte → fotograma: src = t + A·dst, con A = [u/(|u|·s), v/(|v|·s)].
  const a = ux / du / s, c = uy / du / s, b = vx / dv / s, d = vy / dv / s;
  const tx = cx + (ux / du) * left * side + (vx / dv) * top * side;
  const ty = cy + (uy / du) * left * side + (vy / dv) * top * side;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return null;
  // Inversa (fotograma → recorte) en el orden de setTransform: x' = m0·x + m2·y + m4, y' = m1·x + m3·y + m5.
  const m0 = d / det, m2 = -b / det, m1 = -c / det, m3 = a / det;
  return {
    width: Math.round((right - left) * qrPixels),
    height: Math.round((bottom - top) * qrPixels),
    matrix: [m0, m1, m2, m3, -(m0 * tx + m2 * ty), -(m1 * tx + m3 * ty)],
  };
}

/**
 * Lectura de la franja bajo el QR: la primera fila con forma de nombre (se tolera una fila de ruido
 * antes, p. ej. el borde del QR) y las dos siguientes como institución y cargo.
 * El nombre debe empezar antes de `maxNameTop` (justo bajo el QR): así una fila de auspiciadores
 * más abajo no se toma por un nombre en credenciales con otro formato.
 */
export function readBelowQr(lines: OcrLine[], extraStopwords: string[] = [], maxNameTop = Infinity): BadgeReading {
  const empty: BadgeReading = { names: [], institution: null, role: null, block: null, nameHeight: 0 };
  const rows = lineRows(lines).filter((r) => cleanAffiliation(r.text));
  const stop = buildStopwords(extraStopwords);
  for (let i = 0; i < Math.min(2, rows.length); i++) {
    if (rows[i].top > maxNameTop) break;
    const words = nameWords(rows[i].text, stop);
    if (!words) continue;
    // Una fila baja seguida de otra mucho más alta con forma de nombre es ruido (borde del QR).
    const next = rows[i + 1];
    if (i === 0 && next && next.height > 1.5 * rows[i].height && next.top <= maxNameTop && nameWords(next.text, stop)) continue;
    return {
      names: [{ name: formatName(words), score: Infinity }],
      institution: cleanAffiliation(rows[i + 1]?.text),
      role: cleanAffiliation(rows[i + 2]?.text),
      block: null,
      nameHeight: rows[i].height,
    };
  }
  return empty;
}
