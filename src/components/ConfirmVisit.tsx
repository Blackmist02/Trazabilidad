import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_NAME_LENGTH, NAME_SOURCE_LABEL, QR_KIND_LABEL, type ParsedQr } from '../lib/qr';
import { formatLocalDate, formatLocalTime, formatLocalTimeShort } from '../lib/time';
import { MAX_NOTES_LENGTH, type PreviousVisits } from '../lib/visits';
import type { DuplicatePolicy } from '../lib/settings';

export interface Candidate {
  parsed: ParsedQr | null;
  manualIdentifier: string | null;
  scannedAt: Date;
  previous: PreviousVisits;
  knownName: string | null;
  source: 'camera' | 'manual';
}

interface Props {
  candidate: Candidate;
  timeZone: string;
  duplicatePolicy: DuplicatePolicy;
  privacyNotice: string;
  onConfirm: (data: { name: string | null; notes: string | null }) => Promise<void>;
  onCancel: () => void;
}

export function ConfirmVisit({ candidate, timeZone, duplicatePolicy, privacyNotice, onConfirm, onCancel }: Props) {
  const { parsed, previous } = candidate;
  const initialName = parsed?.suggestedName ?? candidate.knownName ?? '';
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!initialName) nameRef.current?.focus();
  }, [initialName]);

  const identifier = parsed?.identifier ?? candidate.manualIdentifier;
  const repeatedToday = previous.sameDay.length > 0;
  const trimmed = name.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Guarda síncrona: el estado de React no se actualiza a tiempo ante una doble pulsación.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onConfirm({ name: trimmed || null, notes: notes.trim() || null });
    } catch {
      setError('No se pudo guardar el registro. Inténtalo de nuevo.');
      submittingRef.current = false;
      setSaving(false);
    }
  }

  const nameHint = parsed?.suggestedName && parsed.nameSource
    ? `Nombre leído del ${NAME_SOURCE_LABEL[parsed.nameSource]}. Verifícalo.`
    : candidate.knownName
      ? 'Nombre tomado de una visita anterior con el mismo código. Verifícalo.'
      : 'El código no contiene un nombre. Pregúntalo al visitante.';

  return (
    <div className="sheet-backdrop" role="presentation">
      <form className="sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onSubmit={submit}>
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="confirm-title">Confirmar visita</h2>

        {repeatedToday && previous.last && (
          <div className={`notice ${duplicatePolicy === 'ask' ? 'notice-warning' : 'notice-info'}`} role="alert">
            <strong>
              Este código ya se registró hoy{previous.sameDay.length > 1 ? ` (${previous.sameDay.length} veces)` : ''}.
            </strong>
            <span>
              Última visita: {formatLocalTimeShort(previous.last.visited_at, timeZone)}
              {previous.last.attendee_name ? ` · ${previous.last.attendee_name}` : ' · sin nombre'}.
              {duplicatePolicy === 'ask' ? ' ¿Registrar una nueva visita?' : ' Se registrará como visita repetida.'}
            </span>
          </div>
        )}
        {!repeatedToday && previous.all.length > 0 && (
          <div className="notice notice-info">
            <span>
              Tiene {previous.all.length} {previous.all.length === 1 ? 'visita anterior' : 'visitas anteriores'} en otros días.
            </span>
          </div>
        )}
        {!identifier && (
          <div className="notice notice-info">
            <span>Sin identificador fiable: no es posible saber si esta persona ya fue registrada.</span>
          </div>
        )}
        {parsed?.warnings.filter((w) => !w.includes('identificador')).map((w) => (
          <div key={w} className="notice notice-info"><span>{w}</span></div>
        ))}

        <div className="field">
          <label htmlFor="attendee-name">Nombre del asistente</label>
          <input
            id="attendee-name"
            aria-describedby="attendee-name-hint"
            ref={nameRef}
            type="text"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="done"
            placeholder="Nombre y apellido"
            onChange={(e) => setName(e.target.value)}
          />
          <small id="attendee-name-hint" className="muted">{nameHint}</small>
        </div>

        <dl className="facts">
          <div>
            <dt>Identificador</dt>
            <dd className="mono break">{identifier ?? '—'}</dd>
          </div>
          <div>
            <dt>Tipo</dt>
            <dd>
              {parsed ? QR_KIND_LABEL[parsed.kind] : 'Manual'}
              {parsed?.urlHost ? ` · ${parsed.urlHost} (no se abre)` : ''}
            </dd>
          </div>
          <div>
            <dt>Fecha y hora</dt>
            <dd>
              {formatLocalDate(candidate.scannedAt, timeZone)} {formatLocalTime(candidate.scannedAt, timeZone)}
            </dd>
          </div>
        </dl>

        {showNotes ? (
          <label className="field">
            <span>Observaciones (opcional)</span>
            <textarea value={notes} maxLength={MAX_NOTES_LENGTH} rows={2} onChange={(e) => setNotes(e.target.value)} />
          </label>
        ) : (
          <button type="button" className="btn-link" onClick={() => setShowNotes(true)}>
            + Añadir observación
          </button>
        )}

        {privacyNotice && <p className="privacy-reminder">Recuerda informar: «{privacyNotice}»</p>}
        {error && <div className="notice notice-error" role="alert">{error}</div>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-secondary btn-lg" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className={`btn btn-lg grow ${trimmed ? 'btn-primary' : 'btn-warning'}`} disabled={saving}>
            {saving ? 'Guardando…' : trimmed ? (repeatedToday ? 'Registrar nueva visita' : 'Registrar visita') : 'Registrar sin nombre'}
          </button>
        </div>
        {!trimmed && <small className="muted center">Sin nombre quedará como «pendiente de completar».</small>}
      </form>
    </div>
  );
}
