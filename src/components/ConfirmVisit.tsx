import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_AFFILIATION_LENGTH } from '../lib/ocrName';
import { MAX_NAME_LENGTH, NAME_SOURCE_LABEL, QR_KIND_LABEL, type ParsedQr } from '../lib/qr';
import { formatLocalDate, formatLocalTime, formatLocalTimeShort } from '../lib/time';
import { MAX_NOTES_LENGTH, type NameSource, type PreviousVisits } from '../lib/visits';
import type { DuplicatePolicy } from '../lib/settings';

export type OcrStatus = 'off' | 'running' | 'done' | 'empty' | 'error' | 'no-camera';

export interface OcrState {
  status: OcrStatus;
  candidates: string[];
  institution: string | null;
  role: string | null;
  /** Miniatura de la zona leída (solo en memoria). */
  preview: string | null;
}

export const OCR_IDLE: OcrState = { status: 'off', candidates: [], institution: null, role: null, preview: null };

export interface Candidate {
  parsed: ParsedQr | null;
  manualIdentifier: string | null;
  scannedAt: Date;
  previous: PreviousVisits;
  knownName: string | null;
  knownInstitution: string | null;
  knownRole: string | null;
  source: 'camera' | 'manual';
}

export interface ConfirmData {
  name: string | null;
  nameSource: NameSource;
  institution: string | null;
  role: string | null;
  notes: string | null;
}

interface Props {
  candidate: Candidate;
  timeZone: string;
  duplicatePolicy: DuplicatePolicy;
  privacyNotice: string;
  /** Mostrar y guardar institución y cargo. */
  captureAffiliation: boolean;
  onConfirm: (data: ConfirmData) => Promise<void>;
  onCancel: () => void;
  /** Lectura de la credencial; null si el OCR está desactivado. */
  ocr: OcrState | null;
  onRetryOcr: () => void;
}

export function ConfirmVisit({ candidate, timeZone, duplicatePolicy, privacyNotice, captureAffiliation, onConfirm, onCancel, ocr, onRetryOcr }: Props) {
  const { parsed, previous } = candidate;
  const initialName = parsed?.suggestedName ?? candidate.knownName ?? '';
  const [name, setName] = useState(initialName);
  const [nameOrigin, setNameOrigin] = useState<NameSource>(
    parsed?.suggestedName ? 'qr' : candidate.knownName ? 'previous' : 'manual',
  );
  const [institution, setInstitution] = useState(candidate.knownInstitution ?? '');
  const [role, setRole] = useState(candidate.knownRole ?? '');
  const touchedRef = useRef({ name: false, institution: false, role: false });
  const ocrStatus = ocr?.status ?? 'off';
  const ocrCandidates = ocr?.candidates ?? [];

  // Autocompleta con la lectura de la credencial los campos que el operador aún no tocó.
  useEffect(() => {
    if (!ocr || ocrStatus !== 'done') return;
    const touched = touchedRef.current;
    if (ocrCandidates.length && !touched.name && !name.trim()) {
      setName(ocrCandidates[0]);
      setNameOrigin('ocr');
    }
    if (ocr.institution && !touched.institution && !institution.trim()) setInstitution(ocr.institution);
    if (ocr.role && !touched.role && !role.trim()) setRole(ocr.role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocr]);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  // Sin OCR en curso se enfoca el nombre para escribirlo; con OCR se espera para no tapar la pantalla con el teclado.
  useEffect(() => {
    if (!initialName && ocrStatus === 'off') nameRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await onConfirm({
        name: trimmed || null,
        nameSource: nameOrigin,
        institution: captureAffiliation ? institution.trim() || null : null,
        role: captureAffiliation ? role.trim() || null : null,
        notes: notes.trim() || null,
      });
    } catch {
      setError('No se pudo guardar el registro. Inténtalo de nuevo.');
      submittingRef.current = false;
      setSaving(false);
    }
  }

  const nameHint =
    nameOrigin === 'ocr' && trimmed
      ? 'Leído del texto impreso en la credencial. Verifica que esté bien escrito.'
      : nameOrigin === 'qr' && parsed?.nameSource
        ? `Nombre leído del ${NAME_SOURCE_LABEL[parsed.nameSource]}. Verifícalo.`
        : nameOrigin === 'previous' && trimmed
          ? 'Nombre tomado de una visita anterior con el mismo código. Verifícalo.'
          : ocrStatus === 'running'
            ? 'Leyendo el nombre impreso en la credencial…'
            : 'El código no contiene un nombre. Escríbelo o léelo de la credencial.';

  function pickName(value: string) {
    touchedRef.current.name = true;
    setName(value);
    setNameOrigin('ocr');
  }

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
            onChange={(e) => {
              touchedRef.current.name = true;
              setName(e.target.value);
              setNameOrigin('manual');
            }}
          />
          <small id="attendee-name-hint" className="muted" aria-live="polite">{nameHint}</small>
        </div>

        {ocr && (
          <div className="ocr-box">
            {ocrStatus === 'running' && (
              <span className="ocr-status">
                <span className="spinner" aria-hidden="true" /> Leyendo la credencial…
              </span>
            )}
            {ocrStatus === 'done' && ocrCandidates.length > 1 && (
              <div className="chips" role="group" aria-label="Nombres leídos en la credencial">
                {ocrCandidates.map((c) => (
                  <button key={c} type="button" className={`chip ${c === trimmed ? 'is-on' : ''}`} onClick={() => pickName(c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}
            {ocr.preview && (ocrStatus === 'done' || ocrStatus === 'empty') && (
              <figure className="ocr-preview">
                <img src={ocr.preview} alt="Zona de la credencial que leyó la app" />
                <figcaption>Zona leída (no se guarda)</figcaption>
              </figure>
            )}
            {ocrStatus === 'empty' && <span className="ocr-status">No se encontró un nombre legible. Acerca la credencial y vuelve a leer.</span>}
            {ocrStatus === 'error' && <span className="ocr-status">No se pudo usar el lector de texto en este dispositivo.</span>}
            {ocrStatus === 'no-camera' && <span className="ocr-status">Inicia la cámara para leer el nombre de la credencial.</span>}
            {ocrStatus !== 'running' && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRetryOcr}>
                {ocrStatus === 'off' ? 'Leer nombre de la credencial' : 'Volver a leer'}
              </button>
            )}
          </div>
        )}

        {captureAffiliation && (
          <div className="field-pair">
            <label className="field">
              <span>Institución</span>
              <input
                type="text"
                value={institution}
                maxLength={MAX_AFFILIATION_LENGTH}
                autoComplete="off"
                autoCapitalize="words"
                placeholder="Opcional"
                onChange={(e) => {
                  touchedRef.current.institution = true;
                  setInstitution(e.target.value);
                }}
              />
            </label>
            <label className="field">
              <span>Cargo</span>
              <input
                type="text"
                value={role}
                maxLength={MAX_AFFILIATION_LENGTH}
                autoComplete="off"
                autoCapitalize="sentences"
                placeholder="Opcional"
                onChange={(e) => {
                  touchedRef.current.role = true;
                  setRole(e.target.value);
                }}
              />
            </label>
          </div>
        )}

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
