import { useMemo, useState } from 'react';
import { csvFileName, downloadCsv, visitsToCsv } from '../lib/csv';
import { normalizeName } from '../lib/metrics';
import { formatDateKey, formatLocalTime, localDateKey } from '../lib/time';
import type { Visit } from '../lib/visits';
import { useApp } from '../state/store';
import { VisitDetail } from './VisitDetail';

const PAGE = 100;

export function filterVisits(visits: Visit[], query: string, date: string, onlyPending: boolean): Visit[] {
  const q = normalizeName(query);
  return visits.filter((v) => {
    if (date && v.event_date !== date) return false;
    if (onlyPending && v.attendee_name) return false;
    if (!q) return true;
    return (
      (v.attendee_name && normalizeName(v.attendee_name).includes(q)) ||
      (v.qr_identifier && v.qr_identifier.toLowerCase().includes(q)) ||
      (v.notes && normalizeName(v.notes).includes(q))
    );
  });
}

export function HistoryScreen() {
  const { visits, settings, loading } = useApp();
  const today = localDateKey(new Date(), settings.timeZone);
  const [query, setQuery] = useState('');
  const [date, setDate] = useState(today);
  const [onlyPending, setOnlyPending] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const dates = useMemo(() => [...new Set(visits.map((v) => v.event_date))].sort().reverse(), [visits]);
  const filtered = useMemo(() => filterVisits(visits, query, date, onlyPending), [visits, query, date, onlyPending]);
  const todays = useMemo(() => visits.filter((v) => v.event_date === today), [visits, today]);
  const todayIdentified = todays.filter((v) => v.attendee_name).length;
  const pendingCount = visits.filter((v) => !v.attendee_name).length;
  const selected = selectedId ? visits.find((v) => v.id === selectedId) ?? null : null;

  function exportFiltered() {
    const suffix = date || 'todas';
    downloadCsv(visitsToCsv(filtered, settings.timeZone, settings.csvSeparator), csvFileName(settings.standId, suffix));
  }

  return (
    <section className="screen" aria-labelledby="history-title">
      <header className="screen-header">
        <h1 id="history-title">Historial</h1>
      </header>

      <div className="stat-row">
        <div className="stat-mini">
          <span className="stat-mini-value">{todays.length}</span>
          <span className="stat-mini-label">Registros hoy</span>
        </div>
        <div className="stat-mini">
          <span className="stat-mini-value">{todayIdentified}</span>
          <span className="stat-mini-label">Con nombre hoy</span>
        </div>
        <div className="stat-mini">
          <span className="stat-mini-value">{pendingCount}</span>
          <span className="stat-mini-label">Pendientes de nombre</span>
        </div>
      </div>

      <div className="filters">
        <input
          type="search"
          className="grow"
          placeholder="Buscar nombre o código"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          aria-label="Buscar por nombre o identificador"
        />
        <select value={date} onChange={(e) => setDate(e.target.value)} aria-label="Filtrar por fecha">
          <option value="">Todas las fechas</option>
          {!dates.includes(today) && <option value={today}>Hoy ({formatDateKey(today)})</option>}
          {dates.map((d) => (
            <option key={d} value={d}>
              {d === today ? `Hoy (${formatDateKey(d)})` : formatDateKey(d)}
            </option>
          ))}
        </select>
      </div>
      <div className="row space-between">
        <label className="check">
          <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
          Solo pendientes de nombre
        </label>
        <button type="button" className="btn btn-secondary btn-sm" onClick={exportFiltered} disabled={!filtered.length}>
          Exportar CSV ({filtered.length})
        </button>
      </div>

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <p>{visits.length ? 'No hay registros con estos filtros.' : 'Todavía no hay visitas registradas.'}</p>
        </div>
      ) : (
        <ul className="visit-list">
          {filtered.slice(0, limit).map((v) => (
            <li key={v.id}>
              <button type="button" className={`visit-item ${v.attendee_name ? '' : 'is-pending'}`} onClick={() => setSelectedId(v.id)}>
                <span className="visit-time">
                  {formatLocalTime(v.visited_at, settings.timeZone).slice(0, 5)}
                  {!date && <small>{formatDateKey(v.event_date).slice(0, 5)}</small>}
                </span>
                <span className="visit-main">
                  <span className="visit-name">{v.attendee_name ?? 'Pendiente de nombre'}</span>
                  <span className="visit-id mono">{v.qr_identifier ?? 'sin identificador'}</span>
                </span>
                <span className="visit-badges">
                  {!v.attendee_name && <span className="badge badge-warning">Pendiente</span>}
                  {v.sync_state === 'pending' && <span className="badge badge-muted" title="Pendiente de sincronizar">↑</span>}
                  {v.edits.length > 0 && <span className="badge badge-muted" title="Corregido">editado</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {filtered.length > limit && (
        <button type="button" className="btn btn-ghost full" onClick={() => setLimit((l) => l + PAGE)}>
          Mostrar más ({filtered.length - limit} restantes)
        </button>
      )}

      {selected && <VisitDetail visit={selected} onClose={() => setSelectedId(null)} />}
    </section>
  );
}
