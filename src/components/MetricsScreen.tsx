import { useMemo, useState } from 'react';
import { computeMetrics } from '../lib/metrics';
import { formatDateKey, formatLocalDateTime, localDateKey } from '../lib/time';
import { useApp } from '../state/store';
import { BarChart, LineChart } from './charts';

export function MetricsScreen() {
  const { visits, settings } = useApp();
  const tz = settings.timeZone;
  const today = localDateKey(new Date(), tz);
  const dates = useMemo(() => [...new Set(visits.map((v) => v.event_date))].sort(), [visits]);
  const [day, setDay] = useState<string>('');
  const scoped = useMemo(() => (day ? visits.filter((v) => v.event_date === day) : visits), [visits, day]);
  const m = useMemo(() => computeMetrics(scoped, tz), [scoped, tz]);

  // Horas a mostrar: rango con datos (mínimo 08–20 h para dar contexto).
  const hours = useMemo(() => {
    const withData = m.byHour.map((c, h) => (c ? h : -1)).filter((h) => h >= 0);
    const from = Math.min(8, ...withData);
    const to = Math.max(20, ...withData);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [m.byHour]);

  return (
    <section className="screen" aria-labelledby="metrics-title">
      <header className="screen-header row space-between">
        <h1 id="metrics-title">Métricas</h1>
        <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Periodo">
          <option value="">Todo el evento</option>
          {dates.map((d) => (
            <option key={d} value={d}>
              {d === today ? `Hoy (${formatDateKey(d)})` : formatDateKey(d)}
            </option>
          ))}
        </select>
      </header>

      {m.totalVisits === 0 ? (
        <div className="empty"><p>Aún no hay visitas en este periodo.</p></div>
      ) : (
        <>
          <div className="kpis">
            <Kpi value={m.totalVisits} label="Visitas registradas" hint="Cada registro confirmado cuenta como una visita." />
            <Kpi value={m.uniqueCodes} label="Códigos únicos" hint="Estimación de visitantes únicos: códigos QR distintos con identificador fiable." />
            <Kpi value={m.repeatVisits} label="Visitas repetidas" hint="Visitas de un código ya registrado antes en el periodo." />
            <Kpi value={m.identifiedVisits} label="Visitas con nombre" hint={`${m.distinctNames} nombres distintos (dos nombres iguales pueden ser personas diferentes).`} />
            <Kpi value={m.pendingName} label="Sin nombre" hint="Pendientes de completar en el historial." tone={m.pendingName ? 'warning' : undefined} />
            <Kpi value={m.withoutIdentifier} label="Sin identificador" hint="No se puede saber si corresponden a personas ya registradas." />
          </div>

          {m.lastVisit && (
            <p className="muted small">
              Última visita: {formatLocalDateTime(m.lastVisit.visited_at, tz)}
              {m.lastVisit.attendee_name ? ` · ${m.lastVisit.attendee_name}` : ' · sin nombre'}
            </p>
          )}

          <div className="card">
            <h2 className="card-title">Visitas por hora{day ? '' : ' (todos los días)'}</h2>
            <BarChart
              ariaLabel="Visitas por hora del día"
              data={hours.map((h) => ({
                key: String(h),
                label: String(h).padStart(2, '0'),
                value: m.byHour[h],
                title: `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59 · ${m.byHour[h]} ${m.byHour[h] === 1 ? 'visita' : 'visitas'}`,
              }))}
            />
          </div>

          {!day && m.byDay.length > 1 && (
            <div className="card">
              <h2 className="card-title">Visitas por día</h2>
              <BarChart
                ariaLabel="Visitas por día"
                data={m.byDay.map((d) => ({
                  key: d.date,
                  label: formatDateKey(d.date).slice(0, 5),
                  value: d.count,
                  title: `${formatDateKey(d.date)} · ${d.count} ${d.count === 1 ? 'visita' : 'visitas'}`,
                }))}
              />
            </div>
          )}

          <div className="card">
            <h2 className="card-title">Evolución de la afluencia (acumulado)</h2>
            <LineChart
              ariaLabel="Visitas acumuladas en el tiempo"
              data={m.timeline.map((t) => ({
                key: `${t.date}-${t.hour}`,
                label: t.label,
                value: t.cumulative,
                title: `${t.label} · +${t.count} en la hora · ${t.cumulative} acumuladas`,
              }))}
            />
          </div>

          {m.byInstitution.length > 0 && (
            <div className="card">
              <h2 className="card-title">Visitas por institución</h2>
              <ol className="rank">
                {m.byInstitution.slice(0, 10).map((it) => (
                  <li key={it.name}>
                    <span className="rank-name">{it.name}</span>
                    <span className="rank-bar" aria-hidden="true">
                      <span style={{ width: `${(it.visits / m.byInstitution[0].visits) * 100}%` }} />
                    </span>
                    <span className="rank-value">
                      {it.visits}
                      {it.codes !== it.visits && <small> · {it.codes} cód.</small>}
                    </span>
                  </li>
                ))}
              </ol>
              <small className="muted">
                {m.withInstitution} de {m.totalVisits} visitas tienen institución
                {m.byInstitution.length > 10 ? ` · ${m.byInstitution.length} instituciones en total` : ''}.
              </small>
            </div>
          )}

          <details className="card">
            <summary>Ver tabla por hora</summary>
            <table className="table">
              <thead>
                <tr><th>Fecha</th><th>Hora</th><th>Visitas</th><th>Acumulado</th></tr>
              </thead>
              <tbody>
                {m.timeline.map((t) => (
                  <tr key={`${t.date}-${t.hour}`}>
                    <td>{formatDateKey(t.date)}</td>
                    <td>{String(t.hour).padStart(2, '0')}:00</td>
                    <td>{t.count}</td>
                    <td>{t.cumulative}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

function Kpi({ value, label, hint, tone }: { value: number; label: string; hint: string; tone?: 'warning' }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`}>
      <span className="kpi-value">{value.toLocaleString('es-CL')}</span>
      <span className="kpi-label">{label}</span>
      <span className="kpi-hint">{hint}</span>
    </div>
  );
}
