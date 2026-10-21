/**
 * Selección del nombre impreso en una credencial a partir de las líneas que
 * devuelve el OCR. Las credenciales suelen imprimir el nombre con la letra más
 * grande; el resto (evento, empresa, tipo de pase) se descarta con reglas.
 * El resultado es solo una sugerencia: el operador siempre la confirma.
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

export interface NameCandidate {
  name: string;
  score: number;
}

// Palabras habituales en credenciales que no forman parte de un nombre.
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
  'visitor', 'exhibitor', 'press',
];

// Partículas de apellidos y nombres compuestos en español y otros idiomas.
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

function buildStopwords(extra: string[]): Set<string> {
  const set = new Set(NON_NAME_WORDS);
  for (const phrase of extra) {
    for (const w of phrase.split(/\s+/)) {
      const n = normalizeWord(w);
      if (n.length >= 3) set.add(n);
    }
  }
  return set;
}

/** Limpia una línea y devuelve sus palabras si puede ser (parte de) un nombre. */
export function nameWords(text: string, stopwords: Set<string>): string[] | null {
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
  if (words.length < 1 || words.length > 5) return null;
  let letters = 0;
  for (const w of words) {
    if (!LETTERS_RE.test(w)) return null;
    const norm = normalizeWord(w);
    if (stopwords.has(norm)) return null;
    if (PARTICLES.has(norm)) continue;
    if (norm.length < 2) return null; // letras sueltas: ruido del OCR
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
  // Al menos una palabra que no sea partícula.
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

interface Piece {
  words: string[];
  line: OcrLine;
  height: number;
}

function wordCountFactor(n: number): number {
  if (n === 1) return 0.45;
  if (n <= 4) return 1;
  return 0.7;
}

/**
 * Devuelve los candidatos a nombre ordenados de más a menos probable.
 * `extraStopwords`: textos conocidos que no son nombres (p. ej. el nombre del evento).
 */
export function extractNameCandidates(lines: OcrLine[], extraStopwords: string[] = [], minConfidence = 55): NameCandidate[] {
  const stop = buildStopwords(extraStopwords);
  const pieces: Piece[] = [];
  for (const line of lines) {
    if (line.confidence < minConfidence) continue;
    const words = nameWords(line.text, stop);
    if (!words) continue;
    pieces.push({ words, line, height: Math.max(1, line.bottom - line.top) });
  }

  const candidates = new Map<string, number>();
  const add = (words: string[], height: number, confidence: number, bonus = 1) => {
    const name = formatName(words);
    const score = height * (confidence / 100) * bonus * wordCountFactor(words.filter((w) => !PARTICLES.has(normalizeWord(w))).length);
    if (score > (candidates.get(name) ?? 0)) candidates.set(name, score);
  };

  pieces.sort((a, b) => a.line.top - b.line.top);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    add(p.words, p.height, p.line.confidence);
    // Nombre y apellido impresos en líneas consecutivas con el mismo tamaño de letra.
    const q = pieces[i + 1];
    if (!q) continue;
    const similarSize = Math.abs(p.height - q.height) <= 0.35 * Math.max(p.height, q.height);
    const gap = q.line.top - p.line.bottom;
    const close = gap >= -0.3 * p.height && gap <= 1.3 * Math.max(p.height, q.height);
    const overlap = Math.min(p.line.right, q.line.right) - Math.max(p.line.left, q.line.left) > 0;
    if (similarSize && close && overlap && p.words.length + q.words.length <= 5) {
      // Se favorece la unión: lo habitual es "Nombre" sobre "Apellidos" con la misma letra.
      add([...p.words, ...q.words], (p.height + q.height) / 2, Math.min(p.line.confidence, q.line.confidence), 1.25);
    }
  }

  return [...candidates.entries()]
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}
