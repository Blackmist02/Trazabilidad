import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { beep, vibrate } from '../lib/feedback';
import { parseQr } from '../lib/qr';
import { ScanGate } from '../lib/scanGate';
import { formatLocalTime, localDateKey } from '../lib/time';
import { createVisit, findPreviousVisits, knownNameFor } from '../lib/visits';
import { useApp } from '../state/store';
import { ConfirmVisit, type Candidate } from './ConfirmVisit';
import { QrCamera } from './QrCamera';

interface Toast {
  id: number;
  text: string;
  kind: 'success' | 'pending';
}

export function ScanScreen() {
  const { settings, visits, addVisit } = useApp();
  const gate = useMemo(() => new ScanGate(settings.cooldownSeconds * 1000), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const visitsRef = useRef(visits);
  visitsRef.current = visits;

  useEffect(() => gate.setCooldown(settings.cooldownSeconds * 1000), [gate, settings.cooldownSeconds]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const openCandidate = useCallback(
    (text: string | null, source: Candidate['source']) => {
      const scannedAt = new Date();
      const parsed = text ? parseQr(text) : null;
      const eventDate = localDateKey(scannedAt, settings.timeZone);
      const previous = findPreviousVisits(visitsRef.current, parsed?.identifier ?? null, eventDate);
      setCandidate({ parsed, manualIdentifier: null, scannedAt, previous, knownName: knownNameFor(previous), source });
    },
    [settings.timeZone],
  );

  const onDecode = useCallback(
    (text: string) => {
      if (!gate.accept(text)) return;
      if (settings.vibrate) vibrate(60);
      if (settings.sound) beep();
      setFlashKey((k) => k + 1);
      openCandidate(text, 'camera');
    },
    [gate, openCandidate, settings.vibrate, settings.sound],
  );

  function submitManual(e: FormEvent) {
    e.preventDefault();
    const text = manualText.trim();
    if (!text) return;
    gate.accept(text);
    openCandidate(text, 'manual');
    setManualText('');
    setManualOpen(false);
  }

  function registerWithoutCode() {
    gate.accept(`__manual__${Date.now()}`);
    openCandidate(null, 'manual');
    setManualOpen(false);
  }

  async function confirm({ name, notes }: { name: string | null; notes: string | null }) {
    if (!candidate) return;
    const visit = createVisit({
      parsed: candidate.parsed,
      manualIdentifier: candidate.manualIdentifier,
      attendeeName: name,
      notes,
      scannedAt: candidate.scannedAt,
      standId: settings.standId,
      timeZone: settings.timeZone,
      storePayload: settings.storePayload,
      syncMode: settings.mode === 'sync',
    });
    await addVisit(visit);
    setCandidate(null);
    gate.release();
    if (settings.vibrate) vibrate([40, 40, 40]);
    setToast({
      id: Date.now(),
      kind: visit.attendee_name ? 'success' : 'pending',
      text: visit.attendee_name
        ? `Registrado: ${visit.attendee_name} · ${formatLocalTime(visit.visited_at, settings.timeZone)}`
        : `Registrado sin nombre (pendiente) · ${formatLocalTime(visit.visited_at, settings.timeZone)}`,
    });
  }

  function cancel() {
    setCandidate(null);
    gate.release();
  }

  return (
    <section className="screen scan-screen" aria-labelledby="scan-title">
      <h1 id="scan-title" className="sr-only">Escanear</h1>
      <QrCamera onDecode={onDecode} paused={!!candidate} flashKey={flashKey} />

      {toast && (
        <div key={toast.id} className={`toast toast-${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}

      <div className="manual">
        {manualOpen ? (
          <form className="card" onSubmit={submitManual}>
            <label className="field">
              <span>Código de la credencial</span>
              <input
                type="text"
                value={manualText}
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="go"
                maxLength={2048}
                placeholder="Ej.: BDFFE48F81E448617430250Enp"
                onChange={(e) => setManualText(e.target.value)}
              />
            </label>
            <div className="row">
              <button type="button" className="btn btn-secondary" onClick={() => setManualOpen(false)}>
                Cerrar
              </button>
              <button type="submit" className="btn btn-primary grow" disabled={!manualText.trim()}>
                Continuar
              </button>
            </div>
            <button type="button" className="btn-link" onClick={registerWithoutCode}>
              Registrar visita sin código
            </button>
          </form>
        ) : (
          <button type="button" className="btn btn-ghost btn-lg full" onClick={() => setManualOpen(true)}>
            Introducir código manualmente
          </button>
        )}
      </div>

      {candidate && (
        <ConfirmVisit
          key={candidate.scannedAt.getTime()}
          candidate={candidate}
          timeZone={settings.timeZone}
          duplicatePolicy={settings.duplicatePolicy}
          privacyNotice={settings.privacyNotice}
          onConfirm={confirm}
          onCancel={cancel}
        />
      )}
    </section>
  );
}
