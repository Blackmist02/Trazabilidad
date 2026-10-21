import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: { url: string; key: string; client: SupabaseClient } | null = null;

/**
 * Cliente de Supabase con la clave pública (publishable/anon). Los permisos reales
 * los imponen las políticas RLS del servidor (supabase/schema.sql).
 */
export function getSupabase(url: string, key: string): SupabaseClient {
  if (cached && cached.url === url && cached.key === key) return cached.client;
  const client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'trazabilidad.auth' },
  });
  cached = { url, key, client };
  return client;
}
