import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { VisitStore } from '../data/db';
import { downloadImage, supabaseRemote } from '../data/remote';
import { getSupabase } from '../data/supabaseClient';
import { resetPullCursor, retryDelayMs, syncOnce, type SyncPhase } from '../data/sync';
import { loadSettings, normalizeSettings, saveSettings, syncConfigured, type Settings } from '../lib/settings';
import { applyEdit, type Visit, type VisitChangesInput } from '../lib/visits';

export interface SyncStatus {
  phase: SyncPhase;
  pending: number;
  lastAt: string | null;
  error: string | null;
}

interface AppContextValue {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  visits: Visit[];
  loading: boolean;
  storageError: string | null;
  /** Guarda la visita y, si la hay, la imagen de la credencial. */
  addVisit: (visit: Visit, image?: { data: ArrayBuffer; type: string } | null) => Promise<void>;
  /** Imagen de la credencial de una visita como blob (local o descargada de Supabase), o null. */
  getVisitImage: (visit: Visit) => Promise<Blob | null>;
  editVisit: (id: string, changes: VisitChangesInput) => Promise<Visit | null>;
  clearLocal: (options: { keepPending: boolean }) => Promise<number>;
  queueLocalForUpload: () => Promise<number>;
  online: boolean;
  syncEnabled: boolean;
  syncStatus: SyncStatus;
  syncNow: () => Promise<void>;
  resync: () => Promise<void>;
  supabase: SupabaseClient | null;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: (clearCache: boolean) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp fuera de AppProvider');
  return ctx;
}

export function AppProvider({ children, store: injectedStore }: { children: ReactNode; store?: VisitStore }) {
  const store = useMemo(() => injectedStore ?? new VisitStore(), [injectedStore]);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [session, setSession] = useState<Session | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ phase: 'idle', pending: 0, lastAt: null, error: null });

  const configured = settings.mode === 'sync' && syncConfigured(settings);
  const supabase = useMemo(
    () => (configured ? getSupabase(settings.supabaseUrl, settings.supabaseKey) : null),
    [configured, settings.supabaseUrl, settings.supabaseKey],
  );
  const syncEnabled = !!supabase && !!session;

  const refresh = useCallback(async () => {
    try {
      const all = await store.all();
      setVisits(all);
      setSyncStatus((s) => ({ ...s, pending: all.filter((v) => v.sync_state === 'pending').length }));
      setStorageError(null);
    } catch {
      setStorageError('No se pudo acceder al almacenamiento local del navegador (IndexedDB). En modo privado los datos pueden no guardarse.');
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Sesión de Supabase.
  useEffect(() => {
    if (!supabase) {
      setSession(null);
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => active && setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  // Motor de sincronización con reintentos.
  const syncing = useRef(false);
  const attempt = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncNow = useCallback(async () => {
    if (!supabase || !session || syncing.current) return;
    syncing.current = true;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    setSyncStatus((s) => ({ ...s, phase: 'syncing', error: null }));
    const result = await syncOnce({
      store,
      remote: supabaseRemote(supabase),
      standId: settings.standId,
      isOnline: () => navigator.onLine,
    });
    syncing.current = false;
    setSyncStatus({ phase: result.phase, pending: result.pending, lastAt: result.at, error: result.error });
    if (result.pushed || result.pulled) await refresh();
    if (result.phase === 'offline' || result.phase === 'error') {
      const delay = retryDelayMs(attempt.current++);
      retryTimer.current = setTimeout(() => void syncNow(), delay);
    } else {
      attempt.current = 0;
    }
  }, [supabase, session, store, settings.standId, refresh]);

  useEffect(() => {
    if (!syncEnabled) return;
    void syncNow();
    const interval = setInterval(() => void syncNow(), 30_000);
    return () => {
      clearInterval(interval);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [syncEnabled, syncNow]);

  useEffect(() => {
    if (online && syncEnabled) {
      attempt.current = 0;
      void syncNow();
    }
  }, [online, syncEnabled, syncNow]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = normalizeSettings({ ...prev, ...patch });
      saveSettings(next);
      return next;
    });
  }, []);

  const addVisit = useCallback(
    async (visit: Visit, image?: { data: ArrayBuffer; type: string } | null) => {
      if (image) await store.putWithImage(visit, image);
      else await store.put(visit);
      // Pide al navegador que no borre el almacenamiento por falta de espacio.
      void navigator.storage?.persist?.().catch(() => undefined);
      await refresh();
      if (syncEnabled) void syncNow();
    },
    [store, refresh, syncEnabled, syncNow],
  );

  const getVisitImage = useCallback(
    async (visit: Visit) => {
      const local = await store.getImage(visit.id);
      if (local) return new Blob([local.data], { type: local.type });
      if (!visit.image_path || !supabase || !session) return null;
      const remote = await downloadImage(supabase, visit.image_path);
      // Se guarda en el dispositivo para verla sin conexión; se borra con la copia local.
      await store.putImage({ id: visit.id, data: remote.data, type: remote.type, uploaded: true });
      return new Blob([remote.data], { type: remote.type });
    },
    [store, supabase, session],
  );

  const editVisit = useCallback(
    async (id: string, changes: VisitChangesInput) => {
      const current = await store.get(id);
      if (!current) return null;
      const next = applyEdit(current, changes);
      if (next !== current) {
        await store.put(next);
        await refresh();
        if (syncEnabled) void syncNow();
      }
      return next;
    },
    [store, refresh, syncEnabled, syncNow],
  );

  const clearLocal = useCallback(
    async (options: { keepPending: boolean }) => {
      const removed = await store.clear({ keepPending: options.keepPending });
      await resetPullCursor(store);
      await refresh();
      return removed;
    },
    [store, refresh],
  );

  const queueLocalForUpload = useCallback(async () => {
    const all = await store.all();
    const local = all.filter((v) => v.sync_state === 'local').map((v) => ({ ...v, sync_state: 'pending' as const }));
    await store.putMany(local);
    await refresh();
    if (syncEnabled) void syncNow();
    return local.length;
  }, [store, refresh, syncEnabled, syncNow]);

  const resync = useCallback(async () => {
    await resetPullCursor(store);
    await syncNow();
  }, [store, syncNow]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!supabase) return 'Supabase no está configurado.';
      try {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (!error) return null;
        if (/invalid login/i.test(error.message)) return 'Correo o contraseña incorrectos.';
        return 'No se pudo iniciar sesión. Revisa la conexión e inténtalo de nuevo.';
      } catch {
        return 'No se pudo conectar con Supabase.';
      }
    },
    [supabase],
  );

  const signOut = useCallback(
    async (clearCache: boolean) => {
      if (supabase) await supabase.auth.signOut().catch(() => undefined);
      if (clearCache) {
        // Solo se borran las copias ya sincronizadas: lo pendiente se conserva para no perder datos.
        await store.clear({ onlyStates: ['synced'] });
        await resetPullCursor(store);
        await refresh();
      }
    },
    [supabase, store, refresh],
  );

  const value: AppContextValue = {
    settings,
    updateSettings,
    visits,
    loading,
    storageError,
    addVisit,
    getVisitImage,
    editVisit,
    clearLocal,
    queueLocalForUpload,
    online,
    syncEnabled,
    syncStatus,
    syncNow,
    resync,
    supabase,
    session,
    signIn,
    signOut,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
