import { useState, type FormEvent } from 'react';
import { csvFileName, downloadCsv, visitsToCsv } from '../lib/csv';
import { syncConfigured, validateSupabaseKey, validateSupabaseUrl, type Settings } from '../lib/settings';
import { formatLocalDateTime, localDateKey } from '../lib/time';
import { useApp } from '../state/store';

export function SettingsScreen() {
  const app = useApp();
  const { settings, updateSettings, visits } = app;
  const [confirmText, setConfirmText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const localOnly = visits.filter((v) => v.sync_state === 'local').length;

  function exportAll() {
    const stamp = localDateKey(new Date(), settings.timeZone);
    downloadCsv(visitsToCsv(visits, settings.timeZone, settings.csvSeparator), csvFileName(settings.standId, `completo-${stamp}`));
  }

  async function clearData() {
    const removed = await app.clearLocal({ keepPending: true });
    setConfirmText('');
    setNotice(`Se eliminaron ${removed} registros de este dispositivo.`);
  }

  return (
    <section className="screen" aria-labelledby="settings-title">
      <header className="screen-header">
        <h1 id="settings-title">Configuración</h1>
      </header>
      {notice && <div className="notice notice-success" role="status">{notice}</div>}

      <div className="card">
        <h2 className="card-title">Evento y stand</h2>
        <TextField label="Nombre del evento" value={settings.eventName} onCommit={(v) => updateSettings({ eventName: v })} />
        <TextField label="Identificador del stand" value={settings.standId} onCommit={(v) => updateSettings({ standId: v })} help="Se guarda en cada registro. En modo sincronizado, los dispositivos del mismo stand comparten registros." />
        <TextField label="Zona horaria" value={settings.timeZone} onCommit={(v) => updateSettings({ timeZone: v })} help="Por defecto America/Santiago. Las horas se guardan en UTC y se muestran en esta zona." />
      </div>

      <div className="card">
        <h2 className="card-title">Lectura y duplicados</h2>
        <label className="field">
          <span>Si el código ya se registró hoy</span>
          <select value={settings.duplicatePolicy} onChange={(e) => updateSettings({ duplicatePolicy: e.target.value as Settings['duplicatePolicy'] })}>
            <option value="ask">Advertir y pedir confirmación</option>
            <option value="allow">Registrar indicando que es repetida</option>
          </select>
        </label>
        <label className="field">
          <span>Ignorar el mismo código durante (segundos)</span>
          <input type="number" min={1} max={60} inputMode="numeric" value={settings.cooldownSeconds} onChange={(e) => updateSettings({ cooldownSeconds: Number(e.target.value) })} />
          <small className="muted">Evita registros accidentales mientras la credencial sigue frente a la cámara.</small>
        </label>
        <Toggle label="Leer el nombre impreso en la credencial (OCR)" checked={settings.ocrEnabled} onChange={(v) => updateSettings({ ocrEnabled: v })} />
        <small className="muted">
          Al detectar el QR se analiza la misma imagen para proponer el nombre. Se procesa en el teléfono: la imagen no se
          envía a ningún servicio ni se guarda. La primera vez descarga ~6 MB desde esta misma app.
        </small>
        <Toggle label="Vibrar al leer (Android)" checked={settings.vibrate} onChange={(v) => updateSettings({ vibrate: v })} />
        <Toggle label="Sonido al leer" checked={settings.sound} onChange={(v) => updateSettings({ sound: v })} />
        <Toggle label="Conservar el contenido original del QR (URLs y textos)" checked={settings.storePayload} onChange={(v) => updateSettings({ storePayload: v })} />
      </div>

      <StorageCard />

      <div className="card">
        <h2 className="card-title">Exportación</h2>
        <label className="field">
          <span>Separador CSV</span>
          <select value={settings.csvSeparator} onChange={(e) => updateSettings({ csvSeparator: e.target.value as Settings['csvSeparator'] })}>
            <option value=";">Punto y coma (Excel en español)</option>
            <option value=",">Coma (Power BI, Python, estándar)</option>
          </select>
        </label>
        <button type="button" className="btn btn-primary full" onClick={exportAll} disabled={!visits.length}>
          Exportar todos los registros ({visits.length})
        </button>
        <small className="muted">Archivo UTF-8, generado en el dispositivo; no se envía a ningún servicio.</small>
      </div>

      <div className="card">
        <h2 className="card-title">Privacidad</h2>
        <label className="field">
          <span>Aviso para el visitante</span>
          <textarea rows={3} maxLength={300} value={settings.privacyNotice} onChange={(e) => updateSettings({ privacyNotice: e.target.value })} />
          <small className="muted">Se muestra al operador al confirmar cada visita para que informe al asistente.</small>
        </label>
        <p className="small muted">
          La app solo guarda nombre, código, fecha/hora, stand y observaciones. No usa GPS, no identifica el dispositivo y no
          envía los códigos a terceros. Consulta la política de retención en el archivo PRIVACY.md del repositorio.
        </p>
      </div>

      <div className="card danger-zone">
        <h2 className="card-title">Eliminar datos de este dispositivo</h2>
        <p className="small">
          Borra los registros guardados en este navegador. Los pendientes de sincronizar se conservan. Exporta antes un CSV si
          necesitas una copia. Escribe <strong>BORRAR</strong> para confirmar.
        </p>
        <div className="row">
          <input type="text" className="grow" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Escribe BORRAR para confirmar" />
          <button type="button" className="btn btn-danger" disabled={confirmText !== 'BORRAR'} onClick={() => void clearData()}>
            Eliminar
          </button>
        </div>
      </div>

      <p className="muted small center">
        {localOnly > 0 && settings.mode === 'sync' ? `${localOnly} registros creados en modo local no se sincronizan. ` : ''}
        Versión {__APP_VERSION__}
      </p>
    </section>
  );
}

function StorageCard() {
  const app = useApp();
  const { settings, updateSettings, syncStatus, session, online } = app;
  const [url, setUrl] = useState(settings.supabaseUrl);
  const [key, setKey] = useState(settings.supabaseKey);
  const [configError, setConfigError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const localOnly = app.visits.filter((v) => v.sync_state === 'local').length;

  function saveConfig(e: FormEvent) {
    e.preventDefault();
    const err = validateSupabaseUrl(url) ?? validateSupabaseKey(key);
    setConfigError(err);
    if (!err) updateSettings({ supabaseUrl: url, supabaseKey: key });
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setAuthError(await app.signIn(email, password));
    setPassword('');
    setBusy(false);
  }

  return (
    <div className="card">
      <h2 className="card-title">Almacenamiento</h2>
      <div className="segmented" role="radiogroup" aria-label="Modo de almacenamiento">
        <button type="button" role="radio" aria-checked={settings.mode === 'local'} className={settings.mode === 'local' ? 'is-on' : ''} onClick={() => updateSettings({ mode: 'local' })}>
          Local
        </button>
        <button type="button" role="radio" aria-checked={settings.mode === 'sync'} className={settings.mode === 'sync' ? 'is-on' : ''} onClick={() => updateSettings({ mode: 'sync' })}>
          Sincronizado
        </button>
      </div>

      {settings.mode === 'local' ? (
        <p className="small">
          Los registros se guardan <strong>solo en este navegador y dispositivo</strong> (IndexedDB). No hay sincronización ni copia
          de seguridad automática: exporta un CSV con frecuencia. Si borras los datos del navegador, se pierden.
        </p>
      ) : (
        <>
          <p className="small">
            Los registros se guardan primero en el dispositivo y se envían a Supabase. Solo las cuentas de operador autorizadas
            pueden consultarlos.
          </p>
          <form onSubmit={saveConfig}>
            <label className="field">
              <span>URL del proyecto Supabase</span>
              <input type="url" value={url} placeholder="https://xxxx.supabase.co" autoComplete="off" onChange={(e) => setUrl(e.target.value)} />
            </label>
            <label className="field">
              <span>Clave pública (publishable / anon)</span>
              <input type="text" value={key} placeholder="sb_publishable_…" autoComplete="off" spellCheck={false} onChange={(e) => setKey(e.target.value)} />
              <small className="muted">Nunca uses la clave service_role ni claves secretas.</small>
            </label>
            {configError && <div className="notice notice-error" role="alert">{configError}</div>}
            <button type="submit" className="btn btn-secondary full">Guardar conexión</button>
          </form>

          {!syncConfigured(settings) ? (
            <div className="notice notice-warning">Sincronización no configurada: los registros quedan pendientes en este dispositivo.</div>
          ) : session ? (
            <div className="sync-box">
              <p className="small">
                Sesión: <strong>{session.user.email}</strong>
              </p>
              <p className="small">
                Estado:{' '}
                {!online ? 'sin conexión (se reintentará)' : syncStatus.phase === 'syncing' ? 'sincronizando…' : syncStatus.phase === 'idle' ? 'al día' : syncStatus.error}
                {' · '}
                {syncStatus.pending} pendientes
                {syncStatus.lastAt ? ` · último intento ${formatLocalDateTime(syncStatus.lastAt, settings.timeZone)}` : ''}
              </p>
              <div className="row wrap">
                <button type="button" className="btn btn-secondary" onClick={() => void app.syncNow()}>Sincronizar ahora</button>
                <button type="button" className="btn btn-ghost" onClick={() => void app.resync()}>Descargar todo de nuevo</button>
              </div>
              {localOnly > 0 && (
                <button type="button" className="btn btn-ghost full" onClick={() => void app.queueLocalForUpload()}>
                  Subir {localOnly} registros creados en modo local
                </button>
              )}
              <div className="row wrap">
                <button type="button" className="btn btn-ghost" onClick={() => void app.signOut(false)}>Cerrar sesión</button>
                <button type="button" className="btn btn-ghost" onClick={() => void app.signOut(true)}>Cerrar sesión y borrar copia local</button>
              </div>
            </div>
          ) : (
            <form onSubmit={login} className="sync-box">
              <p className="small">Inicia sesión con la cuenta de operador creada por el administrador.</p>
              <label className="field">
                <span>Correo</span>
                <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label className="field">
                <span>Contraseña</span>
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              {authError && <div className="notice notice-error" role="alert">{authError}</div>}
              <button type="submit" className="btn btn-primary full" disabled={busy}>{busy ? 'Entrando…' : 'Iniciar sesión'}</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

function TextField({ label, value, onCommit, help }: { label: string; value: string; onCommit: (v: string) => void; help?: string }) {
  const [draft, setDraft] = useState(value);
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onCommit(draft)} />
      {help && <small className="muted">{help}</small>}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
