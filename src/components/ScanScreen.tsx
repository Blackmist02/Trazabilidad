import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { beep, vibrate } from '../lib/feedback';
import { ocrSupported, prewarmOcr, recognizeLines } from '../lib/ocr';
import { extractNameCandidates } from '../lib/ocrName';
import { parseQr } from '../lib/qr';
import { ScanGate } from '../lib/scanGate';
import { formatLocalTime, localDateKey } from '../lib/time';
import { createVisit, findPreviousVisits, knownNameFor, type NameSource } from '../lib/visits';
import { useApp } from '../state/store';
import { ConfirmVisit, type Candidate, type OcrState } from './ConfirmVisit';
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
  const frameRef = useRef<(() => HTMLCanvasElement | null) | null>(null);
  const ocrRunRef = useRef(0);
  const [ocr, setOcr] = useState<OcrState>({ status: 'off', candidates: [] });
  const ocrEnabled = settings.ocrEnabled && ocrSupported();
  const eventNameRef = useRef(settings.eventName);
  eventNameRef.current = settings.eventName;

  /** OCR del fotograma en segundo plano; descarta resultados de lecturas anteriores. */
  const runOcr = useCallback((frame: HTMLCanvasElement | null) => {
    const run = ++ocrRunRef.current;
    if (!frame) {
      setOcr({ status: 'no-camera', candidates: [] });
      return;
    }
    setOcr({ status: 'running', candidates: [] });
    recognizeLines(frame)
      .then((lines) => {
        if (run !== ocrRunRef.current) return;
        const names = extractNameCandidates(lines, [eventNameRef.current]).map((c) => c.name);
        setOcr({ status: names.length ? 'done' : 'empty', candidates: names });
      })
      .catch(() => {
        if (run === ocrRunRef.current) setOcr({ status: 'error', candidates: [] });
      });
  }, []);

  const prewarm = useCallback(() => {
    if (ocrEnabled) prewarmOcr().catch(() => undefined);
  }, [ocrEnabled]);

  useEffect(() => gate.setCooldown(settings.cooldownSeconds * 1000), [gate, settings.cooldownSeconds]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const openCandidate = useCallback(
    (text: string | null, source: Candidate['source'], frame: HTMLCanvasElement | null = null) => {
      const scannedAt = new Date();
      const parsed = text ? parseQr(text) : null;
      const eventDate = localDateKey(scannedAt, settings.timeZone);
      const previous = findPreviousVisits(visitsRef.current, parsed?.identifier ?? null, eventDate);
      const knownName = knownNameFor(previous);
      setCandidate({ parsed, manualIdentifier: null, scannedAt, previous, knownName, source });
      ocrRunRef.current++;
      // Solo se lee la credencial si el QR no trae nombre ni hay uno confirmado antes para este código.
      if (ocrEnabled && frame && !parsed?.suggestedName && !knownName) runOcr(frame);
      else setOcr({ status: 'off', candidates: [] });
    },
    [settings.timeZone, ocrEnabled, runOcr],
  );

  const onDecode = useCallback(
    (text: string) => {
      if (!gate.accept(text)) return;
      // Se copia el fotograma de inmediato: es el que muestra la credencial completa.
      const frame = ocrEnabled ? (frameRef.current?.() ?? null) : null;
      if (settings.vibrate) vibrate(60);
      if (settings.sound) beep();
      setFlashKey((k) => k + 1);
      openCandidate(text, 'camera', frame);
    },
    [gate, openCandidate, settings.vibrate, settings.sound, ocrEnabled],
  );

  const retryOcr = useCallback(() => runOcr(frameRef.current?.() ?? null), [runOcr]);

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

  async function confirm({ name, nameSource, notes }: { name: string | null; nameSource: NameSource; notes: string | null }) {
    if (!candidate) return;
    const visit = createVisit({
      parsed: candidate.parsed,
      manualIdentifier: candidate.manualIdentifier,
      attendeeName: name,
      nameSource,
      notes,
      scannedAt: candidate.scannedAt,
      standId: settings.standId,
      timeZone: settings.timeZone,
      storePayload: settings.storePayload,
      syncMode: settings.mode === 'sync',
    });
    await addVisit(visit);
    setCandidate(null);
    ocrRunRef.current++;
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
    ocrRunRef.current++;
    gate.release();
  }

  return (
    <section className="screen scan-screen" aria-labelledby="scan-title">
      <h1 id="scan-title" className="sr-only">Escanear</h1>
      <QrCamera onDecode={onDecode} paused={!!candidate} flashKey={flashKey} frameRef={frameRef} onStarted={prewarm} />

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
          ocr={ocrEnabled ? ocr : null}
          onRetryOcr={retryOcr}
        />
      )}
    </section>
  );
}
