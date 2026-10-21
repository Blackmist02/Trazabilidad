import { useEffect, useState, type FormEvent } from 'react';
import { fetchAudit, type AuditEntry } from '../data/remote';
import { MAX_NAME_LENGTH, QR_KIND_LABEL, type QrKind } from '../lib/qr';
import { formatLocalDateTime } from '../lib/time';
import { MAX_NOTES_LENGTH, type Visit } from '../lib/visits';
import { useApp } from '../state/store';

const FIELD_LABEL: Record<string, string> = { attendee_name: 'Nombre', notes: 'Observaciones' };

export function VisitDetail({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const { settings, editVisit, supabase, session } = useApp();
  const [name, setName] = useState(visit.attendee_name ?? '');
  const [notes, setNotes] = useState(visit.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const tz = settings.timeZone;

  useEffect(() => {
    if (!supabase || !session || visit.sync_state === 'local') return;
    let active = true;
    fetchAudit(supabase, visit.id)
      .then((a) => active && setAudit(a))
      .catch(() => active && setAudit(null));
    return () => {
      active = false;
    };
  }, [supabase, session, visit.id, visit.sync_state, visit.updated_at]);

  const changed = (name.trim() || null) !== visit.attendee_name || (notes.trim() || null) !== visit.notes;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!changed || saving) return;
    setSaving(true);
    await editVisit(visit.id, { attendee_name: name, notes });
    setSaving(false);
    setMessage('Cambios guardados. El valor anterior queda en el historial de cambios.');
  }

  const history = audit && audit.length ? audit.map((a) => ({ at: a.changed_at, ...a })) : visit.edits;

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <form className="sheet" role="dialog" aria-modal="true" aria-labelledby="detail-title" onSubmit={save} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="row space-between">
          <h2 id="detail-title">Detalle de visita</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Cerrar">
            Cerrar
          </button>
        </div>
        {!visit.attendee_name && <div className="notice notice-warning">Pendiente de completar el nombre.</div>}

        <label className="field">
          <span>Nombre del asistente</span>
          <input type="text" value={name} maxLength={MAX_NAME_LENGTH} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Observaciones</span>
          <textarea value={notes} rows={2} maxLength={MAX_NOTES_LENGTH} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <dl className="facts">
          <div>
            <dt>Fecha y hora (Chile)</dt>
            <dd>{formatLocalDateTime(visit.visited_at, tz)}</dd>
          </div>
          <div>
            <dt>Timestamp UTC</dt>
            <dd className="mono">{visit.visited_at}</dd>
          </div>
          <div>
            <dt>Identificador</dt>
            <dd className="mono break">{visit.qr_identifier ?? '—'}</dd>
          </div>
          <div>
            <dt>Tipo</dt>
            <dd>{visit.qr_kind === 'manual' ? 'Manual' : QR_KIND_LABEL[visit.qr_kind as QrKind]}</dd>
          </div>
          {visit.qr_payload && (
            <div>
              <dt>Contenido original</dt>
              <dd className="mono break">{visit.qr_payload}</dd>
            </div>
          )}
          <div>
            <dt>Stand</dt>
            <dd>{visit.stand_id}</dd>
          </div>
          <div>
            <dt>Almacenamiento</dt>
            <dd>
              {visit.sync_state === 'local' && 'Solo en este dispositivo'}
              {visit.sync_state === 'pending' && 'Pendiente de sincronizar'}
              {visit.sync_state === 'synced' && 'Sincronizado con Supabase'}
            </dd>
          </div>
          <div>
            <dt>ID de registro</dt>
            <dd className="mono break">{visit.id}</dd>
          </div>
        </dl>

        {history.length > 0 && (
          <details className="history-log" open>
            <summary>Historial de cambios ({history.length})</summary>
            <ul>
              {history.map((h, i) => (
                <li key={i}>
                  <span className="muted">{formatLocalDateTime(h.at, tz)}</span> · {FIELD_LABEL[h.field] ?? h.field}:{' '}
                  <s>{h.old_value ?? '(vacío)'}</s> → {h.new_value ?? '(vacío)'}
                </li>
              ))}
            </ul>
          </details>
        )}

        {message && <div className="notice notice-success" role="status">{message}</div>}
        <div className="sheet-actions">
          <button type="submit" className="btn btn-primary btn-lg grow" disabled={!changed || saving}>
            {saving ? 'Guardando…' : 'Guardar corrección'}
          </button>
        </div>
      </form>
    </div>
  );
}
