import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, validateSupabaseKey, validateSupabaseUrl } from './settings';

function jwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.firma`;
}

describe('validación de claves Supabase', () => {
  it('acepta claves públicas', () => {
    expect(validateSupabaseKey('sb_publishable_abc123')).toBeNull();
    expect(validateSupabaseKey(jwt({ role: 'anon' }))).toBeNull();
  });

  it('rechaza claves secretas y service_role', () => {
    expect(validateSupabaseKey('sb_secret_abc')).toMatch(/secreta/);
    expect(validateSupabaseKey(jwt({ role: 'service_role' }))).toMatch(/service_role/);
    expect(validateSupabaseKey('')).not.toBeNull();
    expect(validateSupabaseKey('cualquier-cosa')).not.toBeNull();
  });

  it('exige URL https', () => {
    expect(validateSupabaseUrl('https://abc.supabase.co')).toBeNull();
    expect(validateSupabaseUrl('http://abc.supabase.co')).not.toBeNull();
    expect(validateSupabaseUrl('no-url')).not.toBeNull();
  });
});

describe('normalizeSettings', () => {
  it('corrige valores inválidos', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, timeZone: 'Marte/Base', cooldownSeconds: 999, standId: '  ' });
    expect(s.timeZone).toBe('America/Santiago');
    expect(s.cooldownSeconds).toBe(60);
    expect(s.standId).toBe('stand-1');
  });
});

describe('loadSettings', () => {
  function memoryStorage(value: object): Storage {
    const data = new Map([['trazabilidad.settings.v1', JSON.stringify(value)]]);
    return { getItem: (k: string) => data.get(k) ?? null } as Storage;
  }

  it('una conexión vacía guardada no oculta el proyecto por defecto', () => {
    const s = loadSettings(memoryStorage({ supabaseUrl: '', supabaseKey: '', standId: 'stand-9' }));
    expect(s.supabaseUrl).toBe(DEFAULT_SETTINGS.supabaseUrl);
    expect(s.supabaseKey).toBe(DEFAULT_SETTINGS.supabaseKey);
    expect(s.standId).toBe('stand-9');
  });

  it('respeta una conexión propia guardada en el dispositivo', () => {
    const s = loadSettings(memoryStorage({ supabaseUrl: 'https://otro.supabase.co', supabaseKey: 'sb_publishable_x' }));
    expect(s.supabaseUrl).toBe('https://otro.supabase.co');
    expect(s.supabaseKey).toBe('sb_publishable_x');
  });
});
