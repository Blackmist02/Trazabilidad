import type { CsvSeparator } from './csv';
import { DEFAULT_TIMEZONE, isValidTimeZone } from './time';

export type StorageMode = 'local' | 'sync';
export type DuplicatePolicy = 'ask' | 'allow';

export interface Settings {
  eventName: string;
  standId: string;
  timeZone: string;
  mode: StorageMode;
  supabaseUrl: string;
  supabaseKey: string;
  /** ask: advertir y pedir confirmación si el código ya se registró hoy. allow: registrar indicando que es repetida. */
  duplicatePolicy: DuplicatePolicy;
  /** Segundos durante los que se ignora el mismo código tras leerlo. */
  cooldownSeconds: number;
  /** Conservar el contenido original del QR cuando no coincide con el identificador (p. ej. URLs). */
  storePayload: boolean;
  /** Leer el nombre impreso en la credencial con OCR en el dispositivo. */
  ocrEnabled: boolean;
  vibrate: boolean;
  sound: boolean;
  privacyNotice: string;
  csvSeparator: CsvSeparator;
}

const env = import.meta.env ?? {};

export const DEFAULT_SETTINGS: Settings = {
  eventName: '',
  standId: 'stand-1',
  timeZone: DEFAULT_TIMEZONE,
  mode: 'local',
  supabaseUrl: (env.VITE_SUPABASE_URL as string | undefined) ?? '',
  supabaseKey: (env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? '',
  duplicatePolicy: 'ask',
  cooldownSeconds: 5,
  storePayload: true,
  ocrEnabled: true,
  vibrate: true,
  sound: false,
  privacyNotice: 'Registramos tu nombre y la hora de tu visita a nuestro stand para medir la afluencia. No compartimos estos datos con terceros.',
  csvSeparator: ';',
};

const STORAGE_KEY = 'trazabilidad.settings.v1';

export function loadSettings(storage: Storage | undefined = safeStorage()): Settings {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings, storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Almacenamiento no disponible (modo privado): la configuración dura solo esta sesión.
  }
}

export function normalizeSettings(s: Settings): Settings {
  return {
    ...s,
    standId: s.standId.trim().slice(0, 64) || 'stand-1',
    eventName: s.eventName.trim().slice(0, 120),
    timeZone: isValidTimeZone(s.timeZone) ? s.timeZone : DEFAULT_TIMEZONE,
    cooldownSeconds: Math.min(60, Math.max(1, Math.round(Number(s.cooldownSeconds) || 5))),
    supabaseUrl: s.supabaseUrl.trim(),
    supabaseKey: s.supabaseKey.trim(),
    mode: s.mode === 'sync' ? 'sync' : 'local',
    duplicatePolicy: s.duplicatePolicy === 'allow' ? 'allow' : 'ask',
    csvSeparator: s.csvSeparator === ',' ? ',' : ';',
  };
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Valida que la clave de Supabase sea pública (publishable o anon).
 * Rechaza claves secretas o service_role: nunca deben llegar al navegador.
 */
export function validateSupabaseKey(key: string): string | null {
  const k = key.trim();
  if (!k) return 'Falta la clave pública de Supabase.';
  if (k.startsWith('sb_secret_')) return 'Esa es una clave secreta. Usa la «publishable key» (sb_publishable_…).';
  if (k.startsWith('sb_publishable_')) return null;
  const parts = k.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
      if (payload.role === 'service_role') return 'Esa es la clave service_role. Nunca la uses en el navegador; usa la clave anon/publishable.';
      if (payload.role === 'anon') return null;
    } catch {
      return 'La clave no tiene un formato válido.';
    }
  }
  return 'La clave no parece una clave pública de Supabase (sb_publishable_… o anon).';
}

export function validateSupabaseUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:') return 'La URL de Supabase debe usar https://.';
    return null;
  } catch {
    return 'URL de Supabase no válida.';
  }
}

export function syncConfigured(s: Settings): boolean {
  return validateSupabaseUrl(s.supabaseUrl) === null && validateSupabaseKey(s.supabaseKey) === null;
}
