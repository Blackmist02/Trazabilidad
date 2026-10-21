import { useEffect, useState } from 'react';
import { HistoryScreen } from './components/HistoryScreen';
import { MetricsScreen } from './components/MetricsScreen';
import { ScanScreen } from './components/ScanScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { syncConfigured } from './lib/settings';
import { useApp } from './state/store';

type Tab = 'escanear' | 'historial' | 'metricas' | 'ajustes';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'escanear', label: 'Escanear', icon: 'M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M4 12h16' },
  { id: 'historial', label: 'Historial', icon: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01' },
  { id: 'metricas', label: 'Métricas', icon: 'M5 20V10M12 20V4M19 20v-7' },
  { id: 'ajustes', label: 'Ajustes', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.7 7.7 0 0 0-1.7-1L15 3.6h-4l-.4 2.5a7.7 7.7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.7 7.7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.7 7.7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5Z' },
];

// Navegación por hash (#/historial): funciona en GitHub Pages sin errores 404 al recargar.
function readTab(): Tab {
  const id = window.location.hash.replace(/^#\/?/, '');
  return TABS.some((t) => t.id === id) ? (id as Tab) : 'escanear';
}

export function App() {
  const [tab, setTab] = useState<Tab>(readTab);

  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function go(next: Tab) {
    if (next === tab) return;
    window.location.hash = `/${next}`;
    setTab(next);
    window.scrollTo(0, 0);
  }

  return (
    <div className="app">
      <StatusBar />
      <main className="content">
        {tab === 'escanear' && <ScanScreen />}
        {tab === 'historial' && <HistoryScreen />}
        {tab === 'metricas' && <MetricsScreen />}
        {tab === 'ajustes' && <SettingsScreen />}
      </main>
      <nav className="bottom-nav" aria-label="Secciones">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'is-active' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d={t.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function StatusBar() {
  const { settings, syncStatus, session, online, storageError, syncEnabled } = useApp();
  let label: string;
  let tone: 'neutral' | 'ok' | 'warn' | 'error';
  if (settings.mode === 'local') {
    label = 'Local · solo este dispositivo';
    tone = 'neutral';
  } else if (!syncConfigured(settings)) {
    label = 'Sincronización sin configurar';
    tone = 'warn';
  } else if (!session) {
    label = `Sin sesión · ${syncStatus.pending} pendientes`;
    tone = 'warn';
  } else if (!online || syncStatus.phase === 'offline') {
    label = `Sin conexión · ${syncStatus.pending} pendientes`;
    tone = 'warn';
  } else if (syncStatus.phase === 'error' || syncStatus.phase === 'unauthorized') {
    label = syncStatus.error ?? 'Error de sincronización';
    tone = 'error';
  } else if (syncStatus.phase === 'syncing') {
    label = 'Sincronizando…';
    tone = 'ok';
  } else {
    label = syncStatus.pending ? `${syncStatus.pending} pendientes` : 'Sincronizado';
    tone = syncEnabled && !syncStatus.pending ? 'ok' : 'warn';
  }
  return (
    <header className="status-bar">
      <div className="brand">
        <span className="brand-name">Trazabilidad</span>
        <span className="brand-sub">{settings.eventName ? `${settings.eventName} · ` : ''}{settings.standId}</span>
      </div>
      <span className={`pill pill-${tone}`} role="status">{label}</span>
      {storageError && <div className="notice notice-error full-row" role="alert">{storageError}</div>}
    </header>
  );
}
